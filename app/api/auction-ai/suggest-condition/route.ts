import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isCronRequest } from "@/lib/cron-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { parseModelJson, extractJsonField } from "@/lib/model-json"
import { CONDITION_GRADES } from "@/lib/condition"

export const maxDuration = 120
export const runtime = "nodejs"

// POST /api/auction-ai/suggest-condition
// { label, description, images: [{ data, mimeType }] } → { grade, box, reason, confidence }
//
// ⚠⚠ SUGGESTS ONLY. It never writes a condition to a lot, and nothing downstream should make
// it. RULES.md sets out that condition is added by a HUMAN and must not appear in AI
// descriptions; Jordan reversed that only as far as "the AI may propose a grade for a person
// to accept" (2026-08-14). A photograph cannot show a hairline crack, a missing part, wear
// under paint or the inside of a box — and a wrong "Excellent" is worse than a blank field,
// because a blank field gets queried and a confident wrong grade does not.

const SYSTEM = `You grade the condition of auction lots for Vectis Auctions, a UK toy and collectables auction house.

You will be given a lot's description and its photographs. Suggest the condition grade a
cataloguer would record.

THE GRADING SYSTEM — use these words EXACTLY, nothing else:
${CONDITION_GRADES.join(" · ")}

- A grade may be a single word ("Excellent") or a range, best first ("Near Mint to Excellent").
- Judge the ITEM. If the photographs clearly show the box or packaging as well, and it is in a
  visibly different state from the item, give that separately in "box".
- Grade ONLY what you can actually see. You cannot assess completeness, mechanical function,
  or anything hidden inside a box or packaging.

BE HONEST ABOUT DOUBT — this is the important part:
- "confidence" is "high" only when the item is clearly and fully visible and the grade is
  obvious. Use "low" whenever the photographs are unclear, partial, distant, or the item is
  sealed, boxed or wrapped so you are really grading the packaging.
- If you cannot see enough to grade it at all, return an empty grade and say why. That is a
  perfectly good answer and far better than a guess — a person is reading this.
- Never infer a grade from the description's wording alone. The description is context; the
  photographs are the evidence.

Reply with raw JSON only:
{"grade":"<one of the grades, or a 'X to Y' range, or empty string>",
 "box":"<a grade for the box/packaging if clearly different, else empty string>",
 "reason":"<one short sentence on what in the photographs led you there>",
 "confidence":"high"|"medium"|"low"}`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session && !isCronRequest(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { label, description, images, model: clientModel } = await req.json() as {
      label?: string
      description?: string
      images?: { data: string; mimeType: string }[]
      model?: string
    }

    const pics = (images ?? []).slice(0, 6)
    // ⚠ No photographs means no evidence. Refuse rather than let the model grade from the
    // description's adjectives, which is exactly the guess this must not make.
    if (pics.length === 0) {
      return NextResponse.json({ grade: "", box: "", confidence: "low", reason: "No photographs to grade from." })
    }

    const model = await getToolModel("condition_suggest", clientModel)
    const raw = await generateAiText({
      model,
      system: SYSTEM,
      prompt: `Lot: ${label ?? "(no reference)"}\n\nDescription (context only — grade from the photographs):\n${description || "(none)"}`,
      images: pics,
      json: true,
      // ⚠⚠ THIS WAS 400, and it is the likeliest reason every lot came back "the AI's
      // answer could not be read" (Jordan, 17 of 17 on 2026-08-28 — a 100% failure, so the
      // cause is structural, not something about particular lots). 400 is the smallest cap
      // in the codebase apart from two routes that ask only for numbers; this one asks for
      // a judgement from photographs, and a Gemini 3 model spends output budget REASONING
      // before it writes a character, so the allowance can be gone before any JSON exists.
      // lib/ai-provider.ts treats a MAX_TOKENS finish as acceptable (correctly, per
      // RULES.md) and returns what there is, so an empty or half-written reply arrives here
      // looking normal and only fails at the parse.
      // ⚠ NOT PROVEN by a live call — GEMINI_API_KEY exists only on Railway, so this could
      // not be reproduced locally. That is exactly why the failure below now names the
      // cause and the model: if it recurs, the message says which of the two it was.
      // A cap is not a spend — only tokens actually generated are billed.
      maxOutputTokens: 4096,
    })

    // ⚠ Only ever return words from OUR grading system. A model that invents "Very Good" or
    // "C8" would put a grade on a lot that no other part of the app can parse.
    const clean = (v: unknown): string => {
      const parts = String(v ?? "").split(/\s+to\s+/i).map(p => p.trim())
        .map(p => CONDITION_GRADES.find(g => g.toLowerCase() === p.toLowerCase()) ?? "")
        .filter(Boolean)
      return parts.slice(0, 2).join(" to ")
    }

    // Salvage before giving up — the same pattern as the Key Points, Double Check and
    // Fix-all-AI-flagged routes. "grade" is the FIRST field in the shape we ask for, so it
    // usually survives a tail cut off mid-object.
    const parsed = parseModelJson(raw)
    const obj    = parsed && typeof parsed === "object" ? parsed : null
    const grade  = clean(obj ? obj.grade : extractJsonField(raw, "grade"))

    if (!obj && !grade) {
      // ⚠ SAY WHICH FAILURE IT WAS. The old message was one line for two completely
      // different faults and named neither the cause nor the model, so a run of 17
      // failures told nobody anything. An empty reply and unreadable prose need
      // different answers, and the model id matters because this slot is switchable in
      // Admin → AI Models (a model that cannot return JSON fails every single lot).
      console.error("auction-ai/suggest-condition unreadable reply:", model, JSON.stringify(raw ?? "").slice(0, 300))
      return NextResponse.json({
        error: raw.trim()
          ? `${model} answered, but not in a form that could be read.`
          : `${model} returned nothing at all — it used its whole allowance before writing an answer.`,
      }, { status: 502 })
    }

    return NextResponse.json({
      model,
      grade,
      box:        clean(obj ? obj.box : extractJsonField(raw, "box")),
      reason:     String((obj ? obj.reason : extractJsonField(raw, "reason")) ?? "").trim().slice(0, 300),
      confidence: obj && ["high", "medium", "low"].includes(obj.confidence) ? obj.confidence : "low",
    })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const msg: string = e?.message ?? "Unknown error"
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) return NextResponse.json({ error: `RATE_LIMITED: ${msg}` })
    console.error("auction-ai/suggest-condition error:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
