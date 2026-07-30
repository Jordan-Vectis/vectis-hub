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
  onBench: number
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

    // ── The dates: ONE unfiltered pull of the tote feed, grouped in code ──
    const allRows = await bcFetchAll(token, "Receipt_Totes_Excel")

    type Tote = { tote: string; location: string; ms: number | null }
    const benchedByCategory = new Map<string, Tote[]>()
    const feedCategories = new Set<string>()
    for (const r of allRows as Record<string, unknown>[]) {
      const category = String(r[CAT_COL] ?? "").trim()
      if (!category) continue
      feedCategories.add(category)
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

    return NextResponse.json({ connected: true, categories })
  } catch (e: unknown) {
    console.error("manager-portal/bc-tote-dates error:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "BC query failed" }, { status: 500 })
  }
}
