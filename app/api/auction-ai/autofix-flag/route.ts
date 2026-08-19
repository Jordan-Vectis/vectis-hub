import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { parseModelJson, extractJsonField } from "@/lib/model-json"

export const maxDuration = 60

// POST /api/auction-ai/autofix-flag
// { keyPoints, description, flagNote, model? } → { description, keyPoints, where, note }
//
// Takes a lot's key points + current description + the AI flag note (which describes a likely
// error and what is probably correct) and returns the corrected text, applying ONLY that fix.
// Used by the Cataloguing → Review tab's per-lot "Auto-fix" and the bulk "Fix all AI-flagged".
// ⚠ The caller ALWAYS reviews the result before saving — nothing here writes to a lot.
//
// ⚠⚠ Why it returns KEY POINTS as well (2026-08-17). Correcting only the description leaves the
// wrong fact in the cataloguer's key points, and the Key Points stage exists to force every key
// point back INTO the description — so the next pipeline run undoes the fix, and the Review tab
// reports the corrected description as missing a key point in the meantime. The description is
// downstream; where the flagged error lives in the key points, that is what has to change.
const PROMPT = `You are correcting a catalogue lot for a British auction house.

You are given:
- Key points: the cataloguer's raw notes, taken with the item in hand.
- Description: the catalogue description written from those notes.
- Flag: an AI review note identifying a likely factual error (e.g. a wrong catalogue / set / model
  number, running number or product name) and what is probably correct.

Work out WHERE the flagged error actually is, then correct it — and only it.

- If the wrong fact appears in the KEY POINTS, correct it there as well as in the description.
  This is common: a mistyped catalogue number in the notes is copied into the description.
- If the key points are already right and only the description is wrong, return the key points
  completely unchanged.
- Never "tidy", reformat, reorder or reword the key points. They are the cataloguer's own record.
  Change the single wrong value and nothing else, keeping one key point per line exactly as given.

Rules for the description:
- Change only what the Flag identifies as wrong. Keep everything else identical: wording,
  structure, order, and line breaks.
- Keep the SAME lines and paragraphs. Join lines with newlines, never collapse them to spaces.
- British English throughout.
- Do NOT add a condition statement — condition is recorded separately and must not appear.
- Do NOT invent facts or add new claims; only apply the correction the Flag describes.
- If the Flag is too vague to apply confidently, make the smallest sensible correction.

Reply with raw JSON only:
{"description":"<the corrected description>",
 "keyPoints":"<the corrected key points, or exactly the key points you were given if they were right>",
 "where":"key-points"|"description"|"both",
 "note":"<one short sentence naming what you changed, e.g. 'R4328 corrected to R3428'>"}`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { keyPoints = "", description = "", flagNote = "", model: modelId = "" } = await req.json()
    if (!description?.trim() || !flagNote?.trim()) {
      return NextResponse.json({ error: "Missing description or flag note" }, { status: 400 })
    }

    const kpIn   = String(keyPoints).trim()
    const descIn = String(description).trim()

    const model = await getToolModel("catalogue_flags", modelId)
    const raw = await generateAiText({
      model,
      system: PROMPT,
      prompt: `Key points:\n${kpIn || "(none)"}\n\nDescription:\n${descIn}\n\nFlag:\n${String(flagNote).trim()}`,
      json: true,
      // ⚠ The reply carries TWO whole documents — the corrected description AND the
      // corrected key points — so it needs real room. This was 2000, which was fine for the
      // short descriptions of the time but is exceeded by a long multi-bullet lot, and a
      // truncated reply surfaces to the user as "the AI's answer could not be read".
      // A cap is not a spend: only tokens actually generated are billed.
      maxOutputTokens: 8192,
    })

    // ⚠ Salvage before giving up — the Key Points and Double Check routes already do this and
    // this one was the odd one out. lib/ai-provider.ts treats a MAX_TOKENS finish as acceptable
    // (per RULES.md) and returns the text anyway, so a reply cut off mid-object arrives here
    // looking perfectly normal and only fails at JSON.parse. "description" is the FIRST field
    // in the shape we ask for, so it usually survives a truncated tail intact.
    const parsed  = parseModelJson(raw)
    const obj     = parsed && typeof parsed === "object" ? parsed : null
    const fixedDesc = (obj ? String(obj.description ?? "") : extractJsonField(raw, "description") ?? "").trim()

    if (!fixedDesc) {
      // Don't say "try again" when trying again cannot help — an over-long lot truncates every
      // time. extractJsonField needs a closing quote, so a reply cut off inside the description
      // itself lands here.
      const looksTruncated = !!raw?.trim() && !raw.trim().endsWith("}")
      return NextResponse.json({
        error: looksTruncated
          ? "The AI's answer was cut off before it finished — this lot is too long to correct in one pass. Use the per-lot Auto-fix on it, or shorten the description first."
          : "The AI's answer could not be read — try again.",
      }, { status: 502 })
    }
    // ⚠ Only ever report key points as changed when they REALLY differ. A model that echoes them
    // back with a stray space would otherwise rewrite the cataloguer's notes for no reason, and
    // the caller would show a "correction" that corrects nothing.
    const fixedKp   = (obj ? String(obj.keyPoints ?? "") : extractJsonField(raw, "keyPoints") ?? "").trim()
    const kpChanged = !!fixedKp && fixedKp !== kpIn

    return NextResponse.json({
      model,
      description: fixedDesc,
      keyPoints:   kpChanged ? fixedKp : null,
      descChanged: fixedDesc !== descIn,
      where:       kpChanged ? (fixedDesc !== descIn ? "both" : "key-points") : "description",
      note:        (obj ? String(obj.note ?? "") : extractJsonField(raw, "note") ?? "").trim().slice(0, 300),
    })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const msg: string = e?.message ?? "Unknown error"
    // The client backs off on this prefix — keep it (see RULES.md, batch retry loop).
    if (/429|resource.?exhausted|quota|rate.?limit/i.test(msg)) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` }, { status: 429 })
    }
    console.error("auction-ai/autofix-flag error:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
