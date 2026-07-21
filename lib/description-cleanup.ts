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
