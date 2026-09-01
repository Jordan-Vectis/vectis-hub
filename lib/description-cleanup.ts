// Deterministic clean-up for Dolls & Bears AI descriptions.
//
// The model keeps making the same mechanical mistakes no matter how the
// instruction is worded, so these are fixed in code after generation. Safe,
// targeted transforms only — each fires on a specific Dolls/Bears pattern, so it
// leaves everything else alone. Applied server-side in the batch + upgrade routes
// (scoped to the Dolls/Bears preset).
export function cleanBearsDescription(input: string): string {
  if (!input) return input
  let out = input

  // 1. De-duplicate the item name repeated right after the bold name in a bullet:
  //    "**Charlie Bears Xena** – Xena panda bear" → "**Charlie Bears Xena** – panda bear"
  //    "**Charlie Bears Mercedes** – Mercedes, CB…" → "**Charlie Bears Mercedes** – CB…"
  //    (Runs before the ** are stripped, so the bold name is still identifiable.)
  out = out.replace(/(\*\*(.+?)\*\*\s*[–-]\s*)([A-Za-z][\w'’]*)(\s*,?\s*)/g, (m, pre: string, boldName: string, firstWord: string) => {
    const lastWord = boldName.trim().split(/\s+/).pop() ?? ""
    return lastWord && firstWord.toLowerCase() === lastWord.toLowerCase() ? pre : m
  })

  // 2. Remove the cataloguer's "plumo means …" reminder note, keeping the material
  //    word "plumo". Handles "plumo means…", "plumo plumo means…", "plumo (plumo means…)".
  out = out.replace(/plumo(?:\s*\(?\s*plumo)?\s+means\s+plush\s+with\s+mohair\s*[/&]?\s*(?:and\s+|or\s+)?\/?\s*alpaca\s+accents\s*\)?/gi, "plumo")

  // 2b. Drop any EXPANSION of "plumo" — the buyers are collectors who know the
  //     term. "plush with mohair … alpaca accents" only ever appears as this
  //     expansion, so remove it (with its leading comma/paren): "plumo (plush
  //     with mohair and alpaca accents)" → "plumo".
  out = out.replace(/\s*[(,]\s*(?:plumo\s+being\s+)?(?:a\s+)?(?:mix\s+of\s+)?plush\s+with\s+mohair\s*[/&]?\s*(?:and\s+|or\s+)?\/?\s*alpaca\s+accents\s*\)?/gi, "")

  // 3. "LE 6000" / "LE 1176 of 4000" → "limited edition …" (never the LE shorthand).
  out = out.replace(/\bLE\s+(\d)/g, "limited edition $1")

  // 4. Close a stray space inside a Charlie Bears product code: "CB 114790" → "CB114790".
  out = out.replace(/\bCB\s+(\d)/g, "CB$1")

  // 5. Strip markdown bold — nothing that shows the description (app / website / BC)
  //    renders it, so the asterisks appear literally on every lot.
  out = out.replace(/\*\*/g, "")

  // 6. Tidy leftovers from the removals: doubled spaces and stray commas.
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/([–-])\s*,\s*/g, "$1 ")
    .replace(/[ \t]+$/gm, "")

  return out
}

// Whether a preset key is a Dolls/Bears one (so the clean-up applies). Preset keys
// are e.g. "Vectis Free: Dolls & Bears", "Vectis Strict: Teddy Bears".
export function isBearsPreset(presetKey: string | null | undefined): boolean {
  const k = (presetKey ?? "").toLowerCase()
  return k.includes("bear") || k.includes("doll")
}

// ── Leaked tool-call scaffolding ────────────────────────────────────────────
//
// ⚠⚠ THIS IS NOT A DESCRIPTION, EVEN THOUGH IT ARRIVES AS ONE. Gemini sometimes
// answers by WRITING OUT the search it wanted to run instead of running it, e.g.
//
//     Unboxed Sony PlayStation 1 with Games Includes. tool_code
//     print(google_search.search(queries=["Sony PlayStation 1 with Games"]))
//
// Measured on a live pipeline run (Jordan, 2026-09-01) — that exact text reached
// the catalogue, because the batch route only ever removed the "Estimate:" and
// "FLAG:" lines and passed everything else straight through. Double Check then
// tried to rewrite the mess, invented a game code doing it, and the lot surfaced
// in Review as a CATALOGUER mistake — which it never was.
//
// It is the model's internal agent format, not English, so there is nothing to
// salvage: the description always stops dead at the point it went to "search".
// Strip it, and let the caller treat a reply that contained one as a failed
// generation (the runner retries on the other model, same as an empty answer).
const TOOL_CALL_LINE =
  /^\s*(?:```+\s*)?(?:tool_code|tool_call|tool_outputs?|tool_use)\s*(?:```+\s*)?$/i

/** Strip leaked tool-call scaffolding. `leaked` says whether any was found. */
export function stripToolCallLeak(input: string): { text: string; leaked: boolean } {
  if (!input) return { text: input, leaked: false }
  let out = input

  // 1. Fenced blocks: ```tool_code … ``` (also tool_call / tool_outputs / tool_use).
  out = out.replace(/```+\s*(?:tool_code|tool_call|tool_outputs?|tool_use)\b[\s\S]*?(?:```+|$)/gi, "")

  // 2. XML-ish form: <tool_code> … </tool_code>.
  out = out.replace(/<\s*(tool_code|tool_call|tool_outputs?|tool_use)\s*>[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi, "")

  // 3. The bare marker as a word — it appears mid-sentence, on the end of the last
  //    real line ("… with Games Includes. tool_code"), not only on its own line.
  //    ⚠ [ \t] not \s — \s eats the NEWLINE after the marker, which glues the last real
  //    sentence onto the print() line and loses it with it (measured while writing this).
  out = out.replace(/(?:^|[ \t])(?:tool_code|tool_outputs?)\b[ \t]*:?/gi, " ")

  // 4. Any remaining line that is a call rather than a sentence: the search helpers
  //    Gemini names (google_search / default_api / concise_search) and a print() of one.
  out = out
    .split("\n")
    .filter((l) => {
      if (TOOL_CALL_LINE.test(l)) return false
      return !/(?:google_search|default_api|concise_search)\s*[.(]|print\s*\(\s*(?:google_search|default_api|concise_search)/i.test(l)
    })
    .join("\n")

  // 5. Tidy what the removals left: stray fences, doubled blanks, trailing space.
  out = out
    .replace(/^\s*```+\s*$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return { text: out, leaked: out !== input.trim() }
}

/** True when a reply contains leaked tool-call scaffolding. */
export function hasToolCallLeak(input: string): boolean {
  return stripToolCallLeak(input).leaked
}
