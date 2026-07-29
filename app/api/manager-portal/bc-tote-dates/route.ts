import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCToken, bcPageWithNext } from "@/lib/bc"

export const maxDuration = 120

// GET /api/manager-portal/bc-tote-dates
//
// Powers the Manager Portal → Departments "Using totes from — Business Central
// categories" table, LIVE from BC. Everything comes from one feed —
// Receipt_Totes_Excel — which holds, per tote: the category
// (EVA_TOT_ArticleCategory), the CHECK-IN date (SystemCreatedAt), and
// PTE_Benched — the reliable "this tote has been catalogued" signal (Jordan:
// EVA_TOT_Catalogued is unreliable; a tote is catalogued when it's benched).
//
// Our synced WarehouseTote can't be used here — BC drops a tote from the feed's
// default view once catalogued, so catalogued totes aren't in our copy. Hence
// the live pull.
//
// "Using totes from" = the average month of the newest 10 benched totes per
// category (by check-in date), trimmed to drop stray old/new outliers.

const SAMPLE = 10                 // newest N benched totes per category
const CAT_COL     = "EVA_TOT_ArticleCategory"
const TOTE_COL    = "EVA_TOT_ToteNo"
const BENCHED_COL = "PTE_Benched"
const CREATED_COL = "SystemCreatedAt"

// ⚠ BC sends an empty date as 0001-01-01 — a valid Date. Anything before 1990 is
// "no date".
function bcMs(v: unknown): number | null {
  if (!v) return null
  const d = new Date(String(v))
  if (isNaN(d.getTime()) || d.getUTCFullYear() < 1990) return null
  return d.getTime()
}

const isBenched = (v: unknown) => v === true || v === 1 || v === "true" || v === "Yes" || v === "1"

// Trimmed mean: drop ~20% off each end (kills stray old/new outliers), mean the
// middle.
function trimmedMean(msSorted: number[]): number | null {
  if (msSorted.length === 0) return null
  const trim = Math.min(Math.floor(msSorted.length * 0.2), Math.floor((msSorted.length - 1) / 2))
  const mid  = msSorted.slice(trim, msSorted.length - trim)
  return Math.round(mid.reduce((s, d) => s + d, 0) / mid.length)
}

type CategoryOut = {
  category: string
  monthMs: number | null
  oldestMs: number | null
  newestMs: number | null
  sampled: number
  dated: number
  totes: { tote: string; dateMs: number | null }[]
  catalogued: number
  outstanding: number
  lastCataloguedMs: number | null
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ connected: false, categories: [] })

    // ── Counts + last-worked from our own data (reliable, WarehouseItem) ──
    // Kept from the Hub side so the "Catalogued / Still to do / Last worked"
    // columns are unchanged; only the dates go live.
    const totals = await prisma.$queryRaw<{ category: string; catalogued: number; outstanding: number; lastAt: Date | null }[]>`
      SELECT btrim(w."category")                                            AS "category",
             COUNT(*) FILTER (WHERE w."catalogued" = true)::int             AS "catalogued",
             COUNT(*) FILTER (WHERE w."catalogued" IS DISTINCT FROM true)::int AS "outstanding",
             MAX(w."cataloguedAt") FILTER (WHERE w."cataloguedAt" >= DATE '1990-01-01') AS "lastAt"
      FROM "WarehouseItem" w
      WHERE w."category" IS NOT NULL AND btrim(w."category") <> ''
      GROUP BY 1`

    // ── Live: all BENCHED totes from Receipt_Totes_Excel, paginated by nextLink ──
    const benchedByCategory = new Map<string, { tote: string; ms: number | null }[]>()
    const startedAt = Date.now()
    let url: string | null = null
    let firstParams: Record<string, string | number> | undefined = {
      $filter: `${BENCHED_COL} eq true`,
      $select: `${CAT_COL},${TOTE_COL},${CREATED_COL},${BENCHED_COL}`,
      $top: 500,
    }
    let pages = 0
    while (pages < 300) {
      if (Date.now() - startedAt > 100_000) break   // wall-clock budget
      const { rows, nextLink } = await bcPageWithNext(token, url ?? "Receipt_Totes_Excel", url ? undefined : firstParams)
      firstParams = undefined
      for (const r of rows) {
        // Belt-and-braces: BC honours the $filter, but re-check the flag.
        if (!isBenched((r as any)[BENCHED_COL])) continue
        const category = String((r as any)[CAT_COL] ?? "").trim()
        if (!category) continue
        const tote = String((r as any)[TOTE_COL] ?? "").trim() || "(no tote no)"
        const arr = benchedByCategory.get(category) ?? []
        arr.push({ tote, ms: bcMs((r as any)[CREATED_COL]) })
        benchedByCategory.set(category, arr)
      }
      pages++
      if (!nextLink) break
      url = nextLink
    }

    // ── Per category: newest SAMPLE benched totes, trimmed-mean month ──
    const totalsByCat = new Map(totals.map(t => [t.category, t]))
    const allCats = new Set<string>([...totals.map(t => t.category), ...benchedByCategory.keys()])
    const categories: CategoryOut[] = []
    for (const category of allCats) {
      // Newest-first by check-in; undated totes sort to the end.
      const benched = (benchedByCategory.get(category) ?? [])
        .slice()
        .sort((a, b) => (b.ms ?? -Infinity) - (a.ms ?? -Infinity))
      const sample = benched.slice(0, SAMPLE)
      const dated  = sample.map(t => t.ms).filter((d): d is number => d != null).sort((a, b) => a - b)
      const t = totalsByCat.get(category)
      categories.push({
        category,
        monthMs:  trimmedMean(dated),
        oldestMs: dated.length > 0 ? dated[0] : null,
        newestMs: dated.length > 0 ? dated[dated.length - 1] : null,
        sampled:  sample.length,
        dated:    dated.length,
        totes:    sample.map(t => ({ tote: t.tote, dateMs: t.ms })),
        catalogued:  Number(t?.catalogued ?? 0),
        outstanding: Number(t?.outstanding ?? 0),
        lastCataloguedMs: t?.lastAt ? new Date(t.lastAt).getTime() : null,
      })
    }

    // Furthest behind first; undated categories sink to the bottom.
    categories.sort((a, b) => {
      if (a.monthMs == null && b.monthMs == null) return a.category.localeCompare(b.category)
      if (a.monthMs == null) return 1
      if (b.monthMs == null) return -1
      return a.monthMs - b.monthMs
    })

    return NextResponse.json({ connected: true, categories })
  } catch (e: any) {
    console.error("manager-portal/bc-tote-dates error:", e)
    return NextResponse.json({ error: e?.message ?? "BC query failed" }, { status: 500 })
  }
}
