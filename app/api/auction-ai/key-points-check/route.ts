import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isCronRequest } from "@/lib/cron-auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { KEY_POINTS_INSTRUCTION, KEY_POINTS_INSTRUCTION_RELAXED } from "@/lib/key-points-instruction"
import { parseModelJson, extractJsonField } from "@/lib/model-json"
import { getToolModel } from "@/lib/ai-models"
import { auditCodes } from "@/lib/product-codes"
import { cleanBearsDescription, isBearsPreset } from "@/lib/description-cleanup"

export const maxDuration = 60

// POST /api/auction-ai/key-points-check
// Checks a single lot — label, keyPoints, description.
// mode: "strict" (default — cataloguer's exact wording is authoritative) or
// "relaxed" (facts must appear but may be reworded to keep sentences flowing).
// Returns { revised, changed, missing, added } or { error }.
// Always returns HTTP 200 — inspect the body for errors.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session && !isCronRequest(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  try {
    const { label, keyPoints, description, model, mode, presetKey } = await req.json() as {
      label:       string
      keyPoints:   string
      description: string
      model?:      string
      mode?:       "strict" | "relaxed"
      // Which instruction the run is using — only so the Dolls/Bears clean-up can be
      // scoped. The INSTRUCTION TEXT is never posted; this stage has its own system
      // prompt and does not resolve the preset.
      presetKey?:  string
    }
    if (!label || !keyPoints || !description) {
      return NextResponse.json({ error: "Missing label, keyPoints or description" }, { status: 400 })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const ai = genAI.getGenerativeModel({
      model: await getToolModel("catalogue_kpcheck", model),
      systemInstruction: mode === "relaxed" ? KEY_POINTS_INSTRUCTION_RELAXED : KEY_POINTS_INSTRUCTION,
    })

    const prompt =
      `Lot: ${label}\n\n` +
      `Key points (all must appear in the description):\n${keyPoints}\n\n` +
      `Current description:\n${description}`

    const result   = await ai.generateContent(prompt)
    const response = result.response

    if (response.promptFeedback?.blockReason) {
      throw new Error(`BLOCKED: ${response.promptFeedback.blockReason}`)
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`BLOCKED: ${finishReason}`)
    }

    const rawResponse = response.text()
    const raw     = rawResponse.trim().replace(/^```json\s*/i, "").replace(/```$/, "")
    let revised   = description.trim()
    let missing   = ""
    let added     = ""
    let found     = ""
    let modelFlag = ""

    const parsed = parseModelJson(raw)
    if (parsed && typeof parsed === "object") {
      revised   = parsed.description?.trim() || revised
      missing   = parsed.missing?.trim()     || ""
      added     = parsed.added?.trim()       || ""
      found     = parsed.found?.trim()       || ""
      // Its sanctioned outlet for "I think this key point is wrong" — instead of quietly
      // editing the cataloguer's code, which is what it used to do.
      modelFlag = parsed.flag?.trim()        || ""
    } else {
      // Could not parse the JSON (e.g. an invalid \' escape from the model). Pull the
      // description out directly if we can; otherwise KEEP the original description.
      // Never write the raw JSON blob — that corrupted a lot (2026-06-25).
      const extracted = extractJsonField(raw, "description")
      if (extracted) revised = extracted
    }

    // ── The stage may not invent a product code ──────────────────────────────
    // ⚠ This route sends NO images (see the body above — label, keyPoints, description).
    // So a code in the output that was in neither input was not read off a tag; it came from
    // training data. On F109109 it swapped the cataloguer's CB252575 for CB104670 and
    // justified it as "the tags in the photo clearly identify it as…". The instruction already
    // forbids this; the model did it anyway, so it is enforced here.
    //
    // ⚠ Jordan's call (2026-08-14): FLAG it as a possible cataloguer mistake — never let the
    // pipeline overwrite the cataloguer's code. So the cataloguer's value is put back and the
    // doubt is reported for a human, which is what the batch route's FLAG line already does.
    let flag = ""
    const audit = auditCodes(keyPoints, description, revised)
    if (audit.invented.length > 0) {
      const invented = audit.invented.map(c => c.asWritten).join(", ")
      if (audit.invented.length === 1 && audit.lost.length === 1) {
        // One code went missing, one appeared: an unambiguous substitution. Put the
        // cataloguer's own spelling back and keep the rest of the stage's edit.
        const wrong = audit.invented[0], right = audit.lost[0]
        revised = revised.split(wrong.asWritten).join(right.asWritten)
        flag = `The AI replaced product code ${right.asWritten} with ${wrong.asWritten}. `
             + `${right.asWritten} — the cataloguer's — has been kept. It cannot see the photos, so if `
             + `${right.asWritten} is wrong it needs checking against the item by hand.`
      } else {
        // Anything less clear-cut: don't guess which code replaced which — drop the whole
        // edit. An edit that invented a code has not earned the benefit of the doubt.
        revised = description.trim()
        flag = `The AI introduced product code${audit.invented.length === 1 ? "" : "s"} ${invented}, which `
             + `${audit.invented.length === 1 ? "is" : "are"} in neither the key points nor the description. `
             + `Its changes to this lot were not applied. Check the codes against the item.`
      }
    }

    // The check we enforced outranks what the model volunteered — it is the one backed by
    // evidence rather than by the model's confidence.
    if (!flag && modelFlag) flag = modelFlag

    // ⚠ The Dolls/Bears mechanical clean-up runs HERE, as the last thing to touch the text.
    // The Batch route cleans its own output, but this stage runs AFTER it in the pipeline and
    // its whole job is to restore the cataloguer's exact wording — and the cataloguer writes
    // the code spaced ("CB 165133"), so it put the space straight back and nothing cleaned up
    // behind it (measured on a live Charlie Bears trio, 2026-08-19).
    // ⚠ It must stay AFTER the code audit above: that repair puts the cataloguer's own
    // spelling back with a literal string replace, so cleaning first would simply reintroduce
    // the spaced code it had just closed. cleanBearsDescription is idempotent, so running it
    // again after Batch already did is harmless.
    if (isBearsPreset(presetKey)) revised = cleanBearsDescription(revised)

    const changed = revised !== description.trim()
    return NextResponse.json({ revised, changed, missing, added, found, flag,
      debug: { prompt, response: rawResponse } })
  } catch (e: any) {
    const msg: string = e.message ?? "Unknown error"
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` })
    }
    return NextResponse.json({ error: msg })
  }
}
