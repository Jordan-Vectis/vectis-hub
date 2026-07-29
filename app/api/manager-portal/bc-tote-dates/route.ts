import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 300

// GET /api/manager-portal/bc-tote-dates
//
// Powers the Manager Portal → Departments "Using totes from — Business Central
// categories" table, LIVE from BC. Everything about the DATES comes from one
// feed — Receipt_Totes_Excel — which holds, per tote: the category
// (EVA_TOT_ArticleCategory), the CHECK-IN date (SystemCreatedAt), and
// PTE_Benched — the reliable "this tote has been catalogued" signal (Jordan:
// EVA_TOT_Catalogued is unreliable; a tote is catalogued when it's benched).
//
// "Using totes from" = the median check-in month of the newest 10 benched totes
// per category.
//
// ⚠ HOW WE FETCH — the proven pattern from the working BC Warehouse tab.
// The BC Warehouse report (app/api/bc/warehouse/route.ts) pulls the WHOLE
// Receipt_Totes_Excel feed in one call — `bcFetchAll(token, "Receipt_Totes_Excel")`
// with NO $filter and NO $select — then groups by EVA_TOT_ArticleCategory in
// code. We do exactly the same here. Two earlier approaches under-fetched and are
// deliberately NOT used again:
//   1. Filtering the whole feed and relying on server paging — BC didn't emit a
//      nextLink, so only the first 500 rows came back (GAMING got 1).
//   2. One filtered query PER CATEGORY (`EVA_TOT_ArticleCategory eq '<cat>'`) —
//      still under-returned (GAMING got 5), and the category list came from a
//      DIFFERENT table (WarehouseItem), so names could miss entirely.
// The unfiltered full pull is the only pattern proven to return every tote, so
// we page the lot once and do BOTH the benched filter and the category grouping
// in code. PTE_Benched is a BC flow/calculated field — an OData `$filter` on it
// silently returns the wrong subset, another reason to keep it in code.

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

// BC returns booleans as strings sometimes ("Yes"/"true").
const isBenched = (v: unknown) => v === true || v === 1 || v === "true" || v === "Yes" || v === "1"

// Join key between the feed's category and our WarehouseItem counts — case- and
// punctuation-insensitive so "TV & Film" / "TV_FILM" still line up.
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")

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

    // ── Counts + last-worked from our own data (WarehouseItem), joined onto the
    // BC categories by normalised name. These populate the Catalogued / Still to
    // do / Last worked columns; the DATES come purely from the live feed below.
    const totals = await prisma.$queryRaw<{ category: string; catalogued: number; outstanding: number; lastAt: Date | null }[]>`
      SELECT btrim(w."category")                                            AS "category",
             COUNT(*) FILTER (WHERE w."catalogued" = true)::int             AS "catalogued",
             COUNT(*) FILTER (WHERE w."catalogued" IS DISTINCT FROM true)::int AS "outstanding",
             MAX(w."cataloguedAt") FILTER (WHERE w."cataloguedAt" >= DATE '1990-01-01') AS "lastAt"
      FROM "WarehouseItem" w
      WHERE w."category" IS NOT NULL AND btrim(w."category") <> ''
      GROUP BY 1`
    const totalsByNorm = new Map(totals.map(t => [norm(t.category), t]))

    // ── Live: ONE unfiltered pull of the whole feed, grouped + benched in code ──
    const allRows = await bcFetchAll(token, "Receipt_Totes_Excel")

    // Group BENCHED totes by the feed's own category.
    const benchedByCategory = new Map<string, { tote: string; ms: number | null }[]>()
    // Every category the feed holds (benched or not), so a category with nothing
    // benched yet still shows a row ("nothing benched yet").
    const feedCategories = new Set<string>()
    for (const r of allRows as any[]) {
      const category = String(r[CAT_COL] ?? "").trim()
      if (!category) continue
      feedCategories.add(category)
      if (!isBenched(r[BENCHED_COL])) continue
      const arr = benchedByCategory.get(category) ?? []
      arr.push({
        tote: String(r[TOTE_COL] ?? "").trim() || "(no tote no)",
        ms:   bcMs(r[CREATED_COL]),
      })
      benchedByCategory.set(category, arr)
    }

    // ── Per category: newest SAMPLE benched totes, median month ──
    const categories: CategoryOut[] = []
    for (const category of feedCategories) {
      // Newest-first by check-in; undated totes sort to the end.
      const benched = (benchedByCategory.get(category) ?? [])
        .slice()
        .sort((a, b) => (b.ms ?? -Infinity) - (a.ms ?? -Infinity))
      const sample = benched.slice(0, SAMPLE)
      const dated  = sample.map(t => t.ms).filter((d): d is number => d != null).sort((a, b) => a - b)
      const t = totalsByNorm.get(norm(category))
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
