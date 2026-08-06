// What WE have actually made on the same thing before.
//
// Lifted out of /api/catalogue/lens so the Valuations tool uses the SAME search
// rather than a second copy that drifts — the scoring below was arrived at by
// measurement (see the notes on each rule) and is easy to get subtly wrong.
//
// Source is WarehouseItem: 192k+ synced BC rows carrying a real hammerPrice and
// an auction date. That is our own sold archive, not a guess.

import { prisma } from "@/lib/prisma"

export type Comparable = {
  description: string
  hammerPrice: number
  auctionDate: string | null
  auctionName: string | null
  category: string | null
  grouped: boolean
}

/** Whatever the AI worked out about an item — enough to go looking for it. */
export type ComparableQuery = {
  maker?: string | null
  model?: string | null
  catalogueNumber?: string | null
  variant?: string | null
  searchTerms?: string[] | null
}

// ⚠ Group lots are the accuracy trap here. A lot of our archive reads
// "Corgi Unboxed Group Of Cars to include 261 James Bond…" — that £150 is for six
// cars, not for the one item. We flag them so callers can separate them out
// rather than averaging nonsense.
const GROUPED = /\bgroup\b|\bto include\b|\bcollection of\b|\bquantity\b|\b\(\d+\)\s*$/i

// ⚠ Catalogue numbers must match as WHOLE words — a plain "contains" for Hornby
// R351 also matches R3514, a different train, which showed up at £190 in testing.
// ⚠ But apply it ONLY to number-bearing terms: forcing whole words on ordinary
// vocabulary breaks plurals, and "Steiff bear" then missed every "teddy bears"
// lot. So catalogue numbers are matched precisely and plain words stay fuzzy.
const looksLikeCatalogueNumber = (term: string) => /\d/.test(term)

function wholeWord(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i")
}

// Our archive writes the same reference several ways — "DB5", "D.B.5", "DB.5" —
// and drops apostrophes at random ("James Bond's" / "James Bonds"). Comparing
// with punctuation stripped from BOTH sides catches all of them: matching "DB5"
// against stripped descriptions finds 467 rows vs 449 raw.
const flatten = (s: string) => s.toLowerCase().replace(/[.'’\-\s]/g, "")

/**
 * ⚠⚠ SCORED, NOT ALL-OR-NOTHING. The first version required EVERY search term to
 * appear, which is why comparables "never worked": one over-specific term wiped
 * out the whole result. Measured 2026-07-30 —
 *   "Steiff + teddy bear + mohair + button in ear" → 0 matches; drop one → 436.
 *   "Hornby + OO gauge + Class 800 + GWR"          → 1 match;   drop two → 2,478.
 * Descriptive words (mohair, camouflage, "button in ear") rarely survive into a
 * lot description, so they must COUNT TOWARDS a match, never gate it.
 *
 * Shape: narrow in SQL on the maker plus ANY one strong term, then rank in code
 * by how much else lines up. Never return nothing just because one word missed.
 */
export async function findComparables(id: ComparableQuery): Promise<Comparable[]> {
  const terms = (id.searchTerms ?? [])
    .map(t => t.trim())
    .filter(t => t.length >= 2 && t.length <= 40)
  const maker  = id.maker?.trim() ?? ""
  const number = id.catalogueNumber?.trim() ?? ""

  // Strong signals worth narrowing on: the catalogue number, the model name, and
  // any term the model gave us. Weak/among-everything words are scored, not required.
  const strong = [number, id.model?.trim() ?? "", ...terms]
    .map(t => t.trim())
    .filter(t => t.length >= 2 && t.toLowerCase() !== maker.toLowerCase())
    .slice(0, 8)

  if (!maker && strong.length === 0) return []

  const anchor = maker
    ? { description: { contains: maker, mode: "insensitive" as const } }
    : null
  const anyStrong = strong.length > 0
    ? { OR: strong.map(t => ({ description: { contains: t, mode: "insensitive" as const } })) }
    : null

  const select = {
    uniqueId: true, description: true, hammerPrice: true,
    auctionDate: true, auctionName: true, category: true,
  }

  // ⚠ TWO queries, and the order matters. The broad query is capped at the most
  // RECENT rows, so on a common maker the genuine catalogue-number matches can be
  // truncated away before scoring ever sees them — "Dinky 741" ranked a Bedford
  // truck above the actual 741 Spitfires until this was split out. So when we have
  // a catalogue number, fetch those rows in their own right first.
  const numbered = number
    ? await prisma.warehouseItem.findMany({
        where: {
          hammerPrice: { gt: 0 },
          AND: [
            ...(anchor ? [anchor] : []),
            { description: { contains: number, mode: "insensitive" as const } },
          ],
        },
        select,
        orderBy: { auctionDate: "desc" },
        take: 120,
      })
    : []

  const broad = await prisma.warehouseItem.findMany({
    where: {
      hammerPrice: { gt: 0 },
      AND: [anchor, anyStrong].filter(Boolean) as object[],
    },
    select,
    orderBy: { auctionDate: "desc" },
    take: 300,
  })

  const byId = new Map<string, (typeof broad)[number]>()
  for (const r of [...numbered, ...broad]) byId.set(r.uniqueId, r)
  const rows = [...byId.values()]

  // Score: catalogue number is worth most (it's the definitive reference), then
  // each other term that turns up. Number matching stays whole-word so R351
  // never scores against R3514.
  const numberPattern = number && looksLikeCatalogueNumber(number) ? wholeWord(number) : null
  const scoreTerms = [...new Set([id.model?.trim() ?? "", id.variant?.trim() ?? "", ...terms].filter(t => t.length >= 2))]

  const scored = rows.map(r => {
    const desc = r.description ?? ""
    const flat = flatten(desc)
    let score = 0
    let numberHit = false
    if (number) {
      const hit = numberPattern ? numberPattern.test(desc) : flat.includes(flatten(number))
      if (hit) { score += 3; numberHit = true }
    }
    for (const t of scoreTerms) {
      if (looksLikeCatalogueNumber(t) ? wholeWord(t).test(desc) : flat.includes(flatten(t))) score += 1
    }
    return { r, score, numberHit }
  })

  // Keep anything with real overlap. A catalogue-number hit alone is plenty.
  const kept = scored
    .filter(s => s.numberHit || s.score >= 1)
    .sort((a, b) =>
      (b.numberHit ? 1 : 0) - (a.numberHit ? 1 : 0) ||
      b.score - a.score ||
      String(b.r.auctionDate ?? "").localeCompare(String(a.r.auctionDate ?? "")),
    )

  return kept.slice(0, 40).map(({ r }) => ({
    description: r.description ?? "",
    hammerPrice: r.hammerPrice ?? 0,
    auctionDate: r.auctionDate ?? null,
    auctionName: r.auctionName ?? null,
    category:    r.category ?? null,
    grouped:     GROUPED.test(r.description ?? ""),
  }))
}

export type ComparableSummary = {
  /** Single-item sales only — the ones a per-item figure can honestly rest on. */
  count: number
  median: number
  low: number
  high: number
  /** Group lots found and deliberately EXCLUDED from the figures above. */
  groupedExcluded: number
  mostRecent: string | null
}

/**
 * What our own archive says this is worth.
 *
 * ⚠ Group lots are excluded from every figure — a "group of six to include…"
 * price is for the group, so averaging it into a single-item valuation inflates
 * it. They're counted separately so the UI can say they were set aside.
 *
 * Median, not mean: one exceptional result (a mint boxed example among playworn
 * ones) drags a mean well above what a normal example makes, and this tool is
 * meant to come in UNDER the real figure, never over.
 */
export function summariseComparables(list: Comparable[]): ComparableSummary | null {
  const singles = list.filter(c => !c.grouped && c.hammerPrice > 0)
  if (singles.length === 0) return null

  const prices = singles.map(c => c.hammerPrice).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2

  // Trim the extremes so a single freak result doesn't become the "high".
  const pct = (p: number) => prices[Math.min(prices.length - 1, Math.max(0, Math.floor(prices.length * p)))]

  const dates = singles.map(c => c.auctionDate).filter((d): d is string => !!d).sort()

  return {
    count: singles.length,
    median,
    low:  prices.length >= 4 ? pct(0.25) : prices[0],
    high: prices.length >= 4 ? pct(0.75) : prices[prices.length - 1],
    groupedExcluded: list.length - singles.length,
    mostRecent: dates.length ? dates[dates.length - 1] : null,
  }
}
