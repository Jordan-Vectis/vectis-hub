import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isCronRequest } from "@/lib/cron-auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { DOUBLE_CHECK_INSTRUCTION } from "@/lib/double-check-instruction"
import { parseModelJson, extractJsonField } from "@/lib/model-json"
import { getToolModel } from "@/lib/ai-models"
import { auditCodes } from "@/lib/product-codes"
import { cleanBearsDescription, isBearsPreset } from "@/lib/description-cleanup"

export const maxDuration = 60

// POST /api/auction-ai/double-check
// Checks a single lot — label, description, optional images.
// Returns { verdict, contradictions, unsupported } or { error }.
// Always returns HTTP 200 — inspect the body for errors.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session && !isCronRequest(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  try {
    const { label, description, images, model, keyPoints, presetKey } = await req.json() as {
      label:       string
      description: string
      images?:     { data: string; mimeType: string }[]
      model?:      string
      keyPoints?:  string
      // Which instruction the run is using — only so the Dolls/Bears clean-up can be
      // scoped. The INSTRUCTION TEXT is never posted; this stage has its own system prompt.
      presetKey?:  string
    }
    if (!label || !description) return NextResponse.json({ error: "Missing label or description" }, { status: 400 })

    const genAI = new GoogleGenerativeAI(apiKey)
    const ai = genAI.getGenerativeModel({
      model: await getToolModel("catalogue_doublecheck", model),
      systemInstruction: DOUBLE_CHECK_INSTRUCTION,
    })

    const imageParts = (images ?? []).map(img => ({
      inlineData: { data: img.data, mimeType: img.mimeType },
    }))

    // When key points are supplied (pipeline runs Double Check AFTER Key Points),
    // they are cataloguer-verified facts. Tell the model to KEEP them, and to focus
    // on removing any duplication/contradiction the key-point insertion may have caused.
    const kpBlock = keyPoints?.trim()
      ? `\n\nCATALOGUER KEY POINTS — verified facts recorded by a human. Every one of these MUST remain in the description exactly once. This includes any CONDITION words here (e.g. "Sealed Mint", "Mint", "Sealed") — those are NOT AI guesses, do NOT remove them; your condition-removal rule does NOT apply to anything in this list. Your only job is to remove DUPLICATION or contradiction where the same fact has been stated more than once. If a key point is missing from the description, ADD it back:\n${keyPoints.trim()}`
      : ""

    const textPart = { text: `Lot: ${label}\n\nDescription:\n${description}${kpBlock}` }
    const contents = imageParts.length > 0 ? [...imageParts, textPart] : [textPart]

    // Check for prompt block before calling .text()
    const result = await ai.generateContent(contents)
    const response = result.response

    if (response.promptFeedback?.blockReason) {
      throw new Error(`BLOCKED: ${response.promptFeedback.blockReason}`)
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`BLOCKED: ${finishReason}`)
    }

    const rawResponse = response.text()
    const raw = rawResponse.trim().replace(/^```json\s*/i, "").replace(/```$/, "")

    let contradictions = ""
    let unsupported    = ""
    let revised        = ""
    let verdict: "ok" | "issues" = "ok"

    const parsed = parseModelJson(raw)
    if (parsed && typeof parsed === "object") {
      contradictions = (parsed.contradictions ?? "").toString().trim()
      unsupported    = (parsed.unsupported ?? "").toString().trim()
      revised        = (parsed.revised ?? "").toString().trim()
      verdict        = contradictions || unsupported ? "issues" : "ok"
    } else {
      // Couldn't parse the JSON (e.g. an invalid \' escape from the model). Salvage the
      // revised description if we can; NEVER dump the raw JSON into the contradictions field.
      revised = extractJsonField(raw, "revised") ?? ""
      verdict = revised ? "issues" : "ok"
    }

    // ── It may not rewrite a product code the cataloguer recorded ────────────
    // ⚠ Unlike the Key Points stage, this one CAN see the photos, so a discrepancy it
    // reports may be perfectly real — on F109109 it read the swing tag as CB104670 where the
    // cataloguer had recorded CB252575 (the 2010 Anniversary edition, which the cataloguer
    // had right). But reading a tag in a photograph is not grounds to overwrite the person
    // who held the item.
    //
    // ⚠ Jordan's rule (2026-08-14): flag it as a POSSIBLE CATALOGUER MISTAKE, never let the
    // pipeline change the code. So the cataloguer's value goes back and the doubt is
    // reported — which is also what the batch route's FLAG line does for the same situation.
    let flag = ""
    if (revised && keyPoints?.trim()) {
      const audit = auditCodes(keyPoints, description, revised)
      if (audit.invented.length > 0) {
        const listed = audit.invented.map(c => c.asWritten).join(", ")
        if (audit.invented.length === 1 && audit.lost.length === 1) {
          const seen = audit.invented[0], recorded = audit.lost[0]
          revised = revised.split(seen.asWritten).join(recorded.asWritten)
          flag = `Double Check read the photo as product code ${seen.asWritten}, but the key points record `
               + `${recorded.asWritten}. The cataloguer's code has been kept — check it against the item, `
               + `and correct the key points if the photo is right.`
        } else {
          // Too tangled to repair a code at a time — keep what came in.
          revised = ""
          flag = `Double Check introduced product code${audit.invented.length === 1 ? "" : "s"} ${listed}, which `
               + `${audit.invented.length === 1 ? "does" : "do"} not appear in the key points. Its rewrite of this `
               + `lot was not applied. Check the codes against the item.`
        }
      }
    }

    // ⚠ The Dolls/Bears mechanical clean-up runs HERE, as the last thing to touch the text.
    // Batch cleans its own output, but Double Check is the FINAL stage of the pipeline — a
    // rewrite it produces was reaching the catalogue uncleaned (measured 2026-08-19).
    // ⚠ It must stay AFTER the code audit above: the repair puts the cataloguer's own spelling
    // back with a literal string replace, so cleaning first would reintroduce the spaced code
    // it had just closed. cleanBearsDescription is idempotent — re-running it is harmless.
    if (revised && isBearsPreset(presetKey)) revised = cleanBearsDescription(revised)

    return NextResponse.json({ verdict, contradictions, unsupported, revised, flag,
      debug: { prompt: textPart.text, response: rawResponse, imageCount: imageParts.length } })
  } catch (e: any) {
    const msg: string = e.message ?? "Unknown error"
    // Prefix rate limit errors so the client can apply the correct backoff
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` })
    }
    return NextResponse.json({ error: msg })
  }
}
