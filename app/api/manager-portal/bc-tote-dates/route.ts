import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 120

// GET /api/manager-portal/bc-tote-dates
//
// Powers the Manager Portal → Departments "Using totes from — Business Central
// categories" table: how far behind cataloguing is, per BC category.
//
// ⚠ THIS IS DELIBERATELY SIMPLE — it mirrors exactly what Jordan does in BC by
// hand (Receipt Totes, filter Article Category + Location BENCH*, sort by
// Created At desc). Verified 2026-07-30 to reproduce his view row for row.
//
//   Receipt_Totes_Excel
//     → group by EVA_TOT_ArticleCategory   (BC's own category, on the tote)
//     → keep totes whose EVA_TOT_ToteLocation contains BENCH  (on a bench = being
//       or has been catalogued — Jordan: use the LOCATION, it's the reliable
//       signal and catches more than the PTE_Benched flag: TRAINS 74 vs 42)
//     → sort by SystemCreatedAt (the tote's CHECK-IN date) newest first
//     → take the newest 10, median their check-in = "using totes from"
//
// ⚠⚠ KNOWN LIMITATION OF THE WEB SERVICE (measured 2026-07-30, don't re-diagnose).
// The published `Receipt_Totes_Excel` OData service returns only ~1,776 rows and
// every one of them is UNCATALOGUED. Totes already ticked Catalogued in BC are
// absent entirely — not a paging problem: a $skip walk collects all 1,776
// distinct rows, and direct lookups of catalogued totes (T026013, T025980 …
// visible on BC's Receipt Totes page) return NOTHING. So a category whose recent
// work is already ticked off looks thin here: SPORTS shows 3 totes on a bench
// while BC's page shows ~30. `$filter` on EVA_TOT_Catalogued is also ignored by
// BC (true and false both return all 1,776 — another flow field).
// FIX = publish an UNFILTERED Receipt Totes web service in BC, then point
// FEED_ENDPOINT below at it. No alternative endpoint name exists today (11
// plausible names probed, all 404; the service root lists nothing).
// Until then the diagnostics block in the response explains the shortfall
// instead of the table silently under-reporting.
//
// ⚠ DO NOT reintroduce any of these — all tried, all wrong (2026-07-29/30):
//   • Grouping by WarehouseItem/receipts. Items are NOT the source here; that
//     road led to receipt numbers in the UI and needed date estimation.
//   • WarehouseItem.goodsReceivedDate — populated on 0 of ~208k rows, dead.
//   • Concluding a category "isn't toted" because items lack a source tote
//     (EVA_CFA_TOT_CreatedFromToteNo is blank for TRAINS items) — the TOTE side
//     has the TRAINS totes regardless. Always look at the tote feed.
//   • $filter on PTE_Benched (BC flow field → wrong subset) or per-category
//     $filter (under-returns). Pull the WHOLE feed, group in code.

const SAMPLE = 10                 // newest N benched totes per category
// Swap this the moment an unfiltered Receipt Totes web service exists in BC —
// it's the single change needed to see catalogued totes too (see above).
const FEED_ENDPOINT = "Receipt_Totes_Excel"
const CAT_COL     = "EVA_TOT_ArticleCategory"
const TOTE_COL    = "EVA_TOT_ToteNo"
const LOC_COL     = "EVA_TOT_ToteLocation"
const CREATED_COL = "SystemCreatedAt"

// ⚠ BC sends an empty date as 0001-01-01 — a valid Date. Anything before 1990 is
// "no date".
function bcMs(v: unknown): number | null {
  if (!v) return null
  const d = new Date(String(v))
  if (isNaN(d.getTime()) || d.getUTCFullYear() < 1990) return null
  return d.getTime()
}

// On a cataloguing bench — locations look like "BENCH5", "BENCH41".
const onBench = (v: unknown) => String(v ?? "").toUpperCase().includes("BENCH")

// Median — robust on a small sample (some categories only have a few totes on a
// bench right now). A trimmed mean needs enough points to trim; this doesn't.
function median(msSorted: number[]): number | null {
  if (msSorted.length === 0) return null
  const mid = Math.floor(msSorted.length / 2)
  return msSorted.length % 2 === 0
    ? Math.round((msSorted[mid - 1] + msSorted[mid]) / 2)
    : msSorted[mid]
}

// Join key between the tote feed's category and our WarehouseItem counts —
// case/punctuation-insensitive so "DOLLS & BEARS" still lines up.
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")

type CategoryOut = {
  category: string
  monthMs: number | null
  oldestMs: number | null
  newestMs: number | null
  sampled: number
  dated: number
  totes: { tote: string; dateMs: number | null; location: string | null }[]
  onBench: number      // totes in the feed for this category sat on a bench
  inFeed: number       // totes the feed returned for this category at all
  catalogued: number
  outstanding: number
  lastCataloguedMs: number | null
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const isAdmin = session.user.role === "ADMIN"

    // Categories an admin has hidden (display-only, restorable). ⚠ The table
    // arrives with Run Migrations while code deploys instantly, so a missing
    // table must simply mean "nothing hidden" — never a 500.
    let hidden: { category: string; hiddenByName: string }[] = []
    try {
      hidden = await prisma.managerPortalHiddenCategory.findMany({
        select:  { category: true, hiddenByName: true },
        orderBy: { category: "asc" },
      })
    } catch { hidden = [] }
    const hiddenSet = new Set(hidden.map(h => h.category))

    const token = await getBCToken()
    if (!token) return NextResponse.json({ connected: false, categories: [], hidden, isAdmin })

    // ── The dates: ONE unfiltered pull of the tote feed, grouped in code ──
    const allRows = await bcFetchAll(token, FEED_ENDPOINT)

    type Tote = { tote: string; location: string; ms: number | null }
    const benchedByCategory = new Map<string, Tote[]>()
    const feedCategories = new Set<string>()
    const inFeedByCategory = new Map<string, number>()
    for (const r of allRows as Record<string, unknown>[]) {
      const category = String(r[CAT_COL] ?? "").trim()
      if (!category) continue
      feedCategories.add(category)
      inFeedByCategory.set(category, (inFeedByCategory.get(category) ?? 0) + 1)
      if (!onBench(r[LOC_COL])) continue
      const arr = benchedByCategory.get(category) ?? []
      arr.push({
        tote:     String(r[TOTE_COL] ?? "").trim() || "(no tote no)",
        location: String(r[LOC_COL] ?? "").trim(),
        ms:       bcMs(r[CREATED_COL]),
      })
      benchedByCategory.set(category, arr)
    }

    // ── The count columns (Catalogued / Still to do / Last worked) stay on our
    // own WarehouseItem data, joined to the feed's categories by name. ──
    const totals = await prisma.$queryRaw<{ category: string; catalogued: number; outstanding: number; lastAt: Date | null }[]>`
      SELECT btrim(w."category")                                               AS "category",
             COUNT(*) FILTER (WHERE w."catalogued" = true)::int                AS "catalogued",
             COUNT(*) FILTER (WHERE w."catalogued" IS DISTINCT FROM true)::int AS "outstanding",
             MAX(w."cataloguedAt") FILTER (WHERE w."cataloguedAt" >= DATE '1990-01-01') AS "lastAt"
      FROM "WarehouseItem" w
      WHERE w."category" IS NOT NULL AND btrim(w."category") <> ''
      GROUP BY 1`
    const totalsByNorm = new Map(totals.map(t => [norm(t.category), t]))

    const categories: CategoryOut[] = []
    for (const category of feedCategories) {
      if (hiddenSet.has(category)) continue
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
        totes:    sample.map(x => ({ tote: x.tote, dateMs: x.ms, location: x.location || null })),
        onBench:  benched.length,
        inFeed:   inFeedByCategory.get(category) ?? 0,
        catalogued:  Number(t?.catalogued ?? 0),
        outstanding: Number(t?.outstanding ?? 0),
        lastCataloguedMs: t?.lastAt ? new Date(t.lastAt).getTime() : null,
      })
    }

    // Furthest behind first; categories with nothing on a bench sink to the bottom.
    categories.sort((a, b) => {
      if (a.monthMs == null && b.monthMs == null) return a.category.localeCompare(b.category)
      if (a.monthMs == null) return 1
      if (b.monthMs == null) return -1
      return a.monthMs - b.monthMs
    })

    // Diagnostics — so a thin category is explainable instead of mysterious.
    // `shortfall` counts categories sampling fewer than SAMPLE totes, which on
    // this web service almost always means "the rest are ticked catalogued in BC
    // and the feed doesn't expose them" (see the header note).
    const diagnostics = {
      endpoint:   FEED_ENDPOINT,
      feedRows:   allRows.length,
      categories: feedCategories.size,
      shortfall:  categories.filter(c => c.sampled < SAMPLE).length,
      note:
        `The ${FEED_ENDPOINT} web service only returns totes that are NOT ticked ` +
        `Catalogued in Business Central (${allRows.length} rows in total). Totes already ` +
        `ticked off are not available through it, so a category whose recent work is ` +
        `finished shows fewer than ${SAMPLE} totes here than on BC's own Receipt Totes page. ` +
        `Publishing an unfiltered Receipt Totes web service in BC would fix it.`,
    }

    return NextResponse.json({ connected: true, categories, hidden, isAdmin, diagnostics })
  } catch (e: unknown) {
    console.error("manager-portal/bc-tote-dates error:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "BC query failed" }, { status: 500 })
  }
}
