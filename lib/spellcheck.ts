// Lightweight, client-side spell FLAGGING (no auto-fix, no suggestions) for the
// cataloguing text fields. Lazy-loads a British/English word list once, then lists
// the ordinary words that aren't recognised. Domain tokens are deliberately NOT
// flagged: brand names (passed in), all-caps codes (LNER, GWR, BR), anything with a
// digit (catalogue numbers, scales like 1:76 / R2290) and very short tokens.

// Common cataloguing terms not in the general dictionary. Kept tiny on purpose —
// most brand words already come through BRANDS_LIST. Add to this if real words get
// wrongly flagged.
const VECTIS_TERMS = new Set([
  "diecast", "playworn", "approx", "vgc", "nm", "nr", "ex", "unboxed",
  "loco", "locos", "railcar", "railcars", "repaint", "repaints", "unrestored", "unmade",
])

let dict: Set<string> | null = null
let loading: Promise<Set<string>> | null = null

// Fetch the word list once and cache it. Fails "open" (empty set → no flags) so a
// network hiccup never blocks cataloguing.
export function loadSpellDict(): Promise<Set<string>> {
  if (dict) return Promise.resolve(dict)
  if (loading) return loading
  loading = fetch("/dict/en-words.txt")
    .then((r) => (r.ok ? r.text() : ""))
    .then((text) => {
      const s = new Set<string>()
      for (const w of text.split("\n")) { const t = w.trim(); if (t) s.add(t) }
      dict = s
      return s
    })
    .catch(() => { dict = new Set<string>(); return dict })
  return loading
}

// Tokens we should never spell-check.
function skippable(tok: string): boolean {
  if (tok.length < 3) return true             // a, an, to, OO, HO…
  if (/\d/.test(tok)) return true              // catalogue numbers / scales
  if (tok === tok.toUpperCase()) return true   // all-caps codes / initialisms (LNER, GWR)
  return false
}

// Distinct words (original case, first appearance) that aren't recognised. `known`
// holds extra allowed lowercased tokens (e.g. brand-name words).
export function findMisspellings(text: string, dictSet: Set<string>, known: Set<string>): string[] {
  if (!text.trim() || dictSet.size === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  const tokens = text.match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g) ?? []
  const isKnown = (w: string) => dictSet.has(w) || VECTIS_TERMS.has(w) || known.has(w)
  for (const raw of tokens) {
    if (skippable(raw)) continue
    const base = raw.toLowerCase().replace(/’/g, "'").replace(/'s$/, "").replace(/'$/, "")
    if (!base || seen.has(base)) continue
    seen.add(base)
    const parts = base.split("-").filter(Boolean)       // die-cast → die + cast
    const ok = parts.length > 1 ? parts.every(isKnown) : isKnown(base)
    if (!ok) out.push(raw)
    if (out.length >= 30) break
  }
  return out
}
