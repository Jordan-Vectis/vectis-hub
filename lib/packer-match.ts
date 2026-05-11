// Fuzzy-matching a raw staff string (typed or scanned into BC shipments)
// against the canonical Packer table. Packers are entered all sorts of
// ways — "P Czerwinski", "PIOTR  CZERWINSKI", "Czerwinski, Piotr",
// "Pioter" (typo), initials, or just the surname.
//
// Strategy:
//   1. Normalise both sides — lowercase, strip non-alphanumeric, collapse spaces
//   2. Exact normalised match → win
//   3. Match if just one packer's first OR last name appears as a token in raw
//   4. Levenshtein within threshold (≤3 chars, or ≤25% of length for shorter)
//   5. Otherwise → unmatched (raw string passes through)

export type Packer = { id: string; name: string; staffGroup: string; aliases?: string[] }

export type MatchResult = {
  canonical: string | null     // The matched packer name, or null if no match
  packerId:  string | null
  raw:       string
  reason:    "alias" | "exact" | "token" | "fuzzy" | "unmatched"
  distance?: number
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokens(s: string): string[] {
  return normalise(s).split(" ").filter(Boolean)
}

// Standard Levenshtein distance — number of single-char edits to turn a into b
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const n = a.length, m = b.length
  const dp = new Array(m + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= n; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[m]
}

// Returns a matcher closure that's been preheated with the canonical packers.
// Reuse the closure across many lookups in the same request — building it
// involves a few allocations per packer.
export function buildPackerMatcher(packers: Packer[]) {
  type Entry = {
    packer:        Packer
    normFull:      string
    normAliases:   string[]   // normalised aliases — checked as exact matches
    tokens:        string[]
    firstName:     string
    lastName:      string
  }
  const entries: Entry[] = packers.map(p => {
    const toks = tokens(p.name)
    return {
      packer:        p,
      normFull:      normalise(p.name),
      normAliases:   (p.aliases ?? []).map(a => normalise(a)).filter(Boolean),
      tokens:        toks,
      firstName:     toks[0] ?? "",
      lastName:      toks[toks.length - 1] ?? "",
    }
  })

  return function matchOne(raw: string): MatchResult {
    const r: MatchResult = { canonical: null, packerId: null, raw, reason: "unmatched" }
    const rawTrim = (raw ?? "").trim()
    if (!rawTrim) return r
    const rawNorm = normalise(rawTrim)
    if (!rawNorm) return r

    // 1a. Manual alias match (admin curated — overrides everything else).
    //     We check this BEFORE the canonical-name exact match so an
    //     intentional alias never gets out-ranked by fuzzy coincidence.
    for (const e of entries) {
      if (e.normAliases.includes(rawNorm)) {
        return { canonical: e.packer.name, packerId: e.packer.id, raw, reason: "alias" }
      }
    }

    // 1b. Exact normalised match against the canonical name
    for (const e of entries) {
      if (e.normFull === rawNorm) {
        return { canonical: e.packer.name, packerId: e.packer.id, raw, reason: "exact" }
      }
    }

    // 2. Token match — does any packer's first or last name appear?
    //    (e.g. raw "P Czerwinski" matches Piotr Czerwinski via lastName)
    const rawTokens = tokens(rawTrim)
    // Score each packer by how many of their name tokens appear in raw
    let bestTokenScore = 0
    let bestTokenEntry: Entry | null = null
    for (const e of entries) {
      if (e.tokens.length === 0) continue
      let hits = 0
      for (const t of e.tokens) {
        // Whole-token match only — and require token length > 1 so "p" doesn't
        // accidentally match every name starting with P
        if (t.length > 1 && rawTokens.includes(t)) hits++
      }
      if (hits > bestTokenScore) { bestTokenScore = hits; bestTokenEntry = e }
    }
    if (bestTokenEntry) {
      // A surname or first-name hit is enough to claim a match
      const e = bestTokenEntry
      return { canonical: e.packer.name, packerId: e.packer.id, raw, reason: "token" }
    }

    // 3. Levenshtein within a tight threshold for typos like "Pioter" vs "Piotr"
    let bestDist  = Infinity
    let bestEntry: Entry | null = null
    for (const e of entries) {
      const d = levenshtein(rawNorm, e.normFull)
      if (d < bestDist) { bestDist = d; bestEntry = e }
    }
    if (bestEntry) {
      // Threshold: ≤3 absolute, or ≤25% of name length for short names
      const limit = Math.max(3, Math.floor(bestEntry.normFull.length * 0.25))
      if (bestDist <= limit) {
        return { canonical: bestEntry.packer.name, packerId: bestEntry.packer.id, raw, reason: "fuzzy", distance: bestDist }
      }
    }

    return r
  }
}
