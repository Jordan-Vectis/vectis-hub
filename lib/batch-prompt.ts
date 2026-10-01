// The prompt the Batch description route sends — in ONE place, so anything that must give a
// model "exactly what Gemini gets" (the office PC trial, lib/local-ai.ts) builds it here rather
// than keeping a drifting copy. Moved out of app/api/auction-ai/batch/route.ts on 2026-10-01
// with the text unchanged.

import { MEASUREMENT_FLAG_RULE, NAME_FLAG_RULE } from "@/lib/flag-rules"
import { DESCRIPTION_RULES } from "@/lib/description-rules"

// Vectis catalogues in British English. Model railway and similar lots often have
// German/French/other foreign-language packaging in the photos (Märklin, Fleischmann,
// Roco, etc.), and Gemini will otherwise mirror that language in its description.
// This is appended to every batch generation so output is always English.
export const LANGUAGE_RULE =
  "IMPORTANT: Write the entire description in British English only, using UK spelling. " +
  "Ignore the language of any text, packaging, labelling or markings shown in the photos — " +
  "foreign-language items (e.g. German Märklin/Fleischmann/Roco, French or any other) must still " +
  "be described in British English. Never output any other language. Proper names and catalogue " +
  "numbers printed on the item may be quoted verbatim, but all surrounding description must be English."

/**
 * The system instruction: the chosen preset plus the house rules that ride on EVERY preset —
 * English only, no counts the cataloguer didn't give, names keep their capitals
 * (lib/description-rules.ts). A preset is data and cannot switch them off.
 */
export function buildBatchSystemInstruction(presetInstruction: string): string {
  return [presetInstruction, LANGUAGE_RULE, DESCRIPTION_RULES].filter(Boolean).join("\n\n")
}

/**
 * The user turn. `existingContext` is the cataloguer's key points (contextType "keyPoints") or an
 * existing description to improve; null = "just describe it". `grounded` adds the Google Search
 * verification line, which only means anything to a model that HAS Google Search.
 */
export function buildBatchUserPrompt(opts: { existingContext: string | null; contextType: string | null; grounded: boolean }): string {
  const { existingContext, contextType, grounded } = opts
  let userPrompt: string
  if (!existingContext) {
    userPrompt = "Please describe this auction lot."
  } else if (contextType === "keyPoints") {
    userPrompt = `The following key points were recorded about this lot. ALL of them must appear in your description — do not omit a single one.

CRITICAL: Only use the information in the key points and what you can directly observe in the photos. Do NOT add product history, specifications, piece counts, features, or any other details from your training data that are not explicitly stated in the key points. If a detail is not in the key points and cannot be seen in the photos, leave it out entirely.

EXCEPTION: If a key point contains a set or catalogue number (e.g. a LEGO set number like #42110, a Playmobil set number, etc.), you MUST resolve it to its full product name and include both the name and number in the description. This is the only permitted use of training knowledge.

PRESERVE EXACT MEANING — do not soften or paraphrase factual key points. Short condition, completeness or packaging notes (e.g. "Sealed Mint", "Sealed", "Mint", "Boxed", "Unboxed", "Complete", measurements like "55\\"x39\\"") carry a precise meaning and MUST appear with that meaning intact, using the cataloguer's own wording. For example: "Sealed Mint" means factory sealed AND mint condition — do NOT weaken it to "in original boxes" or "remains sealed". If you cannot fit the exact term naturally, state it plainly rather than dropping or rewording it. Losing or softening any such key point is a failure.

KEY POINTS ARE AUTHORITATIVE — the cataloguer had the item in hand. Any CLASS, model type, catalogue number, running number or livery stated in the key points (e.g. "Loadhaul Class 56", "Virgin Trains Class 47") MUST be used EXACTLY as given. NEVER replace it with a different class/number/livery you infer from the photos or recall from training — even if you believe the photo shows something else. If you are highly confident a stated value is wrong, KEEP the cataloguer's value in the description and raise it on the FLAG line below — never silently change it.

Write a single, concise catalogue description that naturally incorporates every key point. Do not list them separately and do not repeat the same information twice — but keep the precise factual wording of condition/completeness/measurement key points exactly as given.
${grounded ? `\nVERIFY NUMBERS: Before finalising, ALWAYS use Google Search to verify any catalogue number, set number, model number or product code in the key points — do not rely on memory for these. Confirm the number matches the named product.\n` : ""}
FLAG POSSIBLE MISTAKES: The key points are the cataloguer's record and the description must stay faithful to them — keep their numbers/wording in the description even if you doubt them. BUT if you are HIGHLY confident (ideally confirmed by search) that a catalogue/set/model number or other hard fact in the key points is WRONG, add ONE extra line at the very end in exactly this format:
FLAG: <which key point looks wrong, what you believe is correct, and why>
${MEASUREMENT_FLAG_RULE}
${NAME_FLAG_RULE}
CRITICAL RULE FOR FLAGS: NEVER flag a set number, catalogue number, or product code simply because it is not in your training data. Your knowledge has a cutoff date — products released in 2024 or later may not be known to you, and their absence from your training data does NOT mean they do not exist. Only flag a number if you have strong positive evidence it is wrong (e.g. it belongs to a completely different product, the number format is impossible for that brand, or a search result directly contradicts it). If you are not certain, do NOT add a FLAG line.

Key points:
${existingContext}

After the description (and optional FLAG line), include the estimate on its own line exactly as your instructions specify.`
  } else {
    userPrompt = `Existing description: ${existingContext}\n\nImprove and enhance this description based on the photos. Only use information present in the existing description or directly visible in the photos — do not add details from training data. Keep the same output format. Do not repeat the same information twice.\n\nAfter the description, include the estimate on its own line exactly as your instructions specify.`
  }

  // Reinforce in the user turn too — foreign-language packaging in the photos is a
  // strong cue and the system instruction alone doesn't always win.
  userPrompt += "\n\n(Write the description in British English only — ignore any foreign-language text on the item or its packaging.)"
  return userPrompt
}
