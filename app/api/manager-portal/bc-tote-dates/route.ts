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
// "Using totes from" = the median check-in month of the newest 10 benched totes
// per category.
//
// ⚠ PTE_Benched is a BC FLOW/calculated field — an OData `$filter=PTE_Benched eq
// true` silently returns the WRONG subset (it gave only 4 MILITARY totes when BC
// shows many). So we DON'T filter on it server-side: we page the whole
// Receipt_Totes_Excel feed and test PTE_Benched in code instead.

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

async function inBatches<T>(items: T[], concurrency: number, fn: (t: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn))
  }
}

// Median — robust to a stray old/new tote even on a tiny sample (a category may
// only have a few totes benched right now). A trimmed mean needs enough points
// to trim; the median doesn't, so MILITARY's [9 Feb, 18 Feb, 17 Apr, 21 Jul]
// gives ~mid-March instead of being dragged to April by the 21 Jul outlier.
function median(msSorted: number[]): number | null {
  if (msSorted.length === 0) return null
  const mid = Math.floor(msSorted.length / 2)
  return msSorted.length % 2 === 0
    ? Math.round((msSorted[mid - 1] + msSorted[mid]) / 2)
    : msSorted[mid]
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

    // ── Live: ONE query PER CATEGORY, filtered by category, benched in code ──
    // ⚠ Filtering the whole feed and relying on paging failed — BC didn't emit a
    // nextLink on the unfiltered feed, so only the first 500 rows came back and a
    // category got whatever crumbs were in that slice (GAMING got 1). Category IS
    // a real filterable field (EVA_TOT_ArticleCategory), so query each category
    // directly, page THAT (small) result to completion, and keep benched in code.
    const catList = [...new Set(totals.map(t => t.category))]
    const benchedByCategory = new Map<string, { tote: string; ms: number | null }[]>()

    await inBatches(catList, 4, async (category) => {
      const filter = `${CAT_COL} eq '${category.replace(/'/g, "''")}'`
      const collected: { tote: string; ms: number | null }[] = []
      let url: string | null = null
      let firstParams: Record<string, string | number> | undefined = {
        $filter: filter,
        $select: `${CAT_COL},${TOTE_COL},${CREATED_COL},${BENCHED_COL}`,
        $top: 500,
      }
      let page = 0
      while (page < 30) {   // a single category is small; cap is a backstop
        let res: { rows: any[]; nextLink: string | null }
        try {
          res = await bcPageWithNext(token, url ?? "Receipt_Totes_Excel", url ? undefined : firstParams)
        } catch { break }
        firstParams = undefined
        for (const r of res.rows) {
          if (!isBenched((r as any)[BENCHED_COL])) continue   // benched filter — in code
          collected.push({
            tote: String((r as any)[TOTE_COL] ?? "").trim() || "(no tote no)",
            ms:   bcMs((r as any)[CREATED_COL]),
          })
        }
        page++
        if (!res.nextLink) break
        url = res.nextLink
      }
      benchedByCategory.set(category, collected)
    })

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
        monthMs:  median(dated),
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
