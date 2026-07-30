// Shared computation behind the Manager Portal → Departments "Using totes from —
// Business Central categories" table: how far behind cataloguing is per BC
// category.
//
// ⚠ ONE SOURCE OF TRUTH. Both the on-screen table
// (/api/manager-portal/bc-tote-dates) and the PDF export (…/pdf) call
// computeBcToteDates, so the export can never disagree with the screen. Do not
// reimplement any of this in a route.
//
// ── WHICH BC ENDPOINTS, AND WHY (settled 2026-07-30 — do not "simplify") ──
// Two are needed because neither alone is enough:
//
//  1. FULL_ENDPOINT `Receipt_ExcelEVA_TOT_ReceiptTotesSubpage` — the WHOLE tote
//     table (20,418 rows = BC table 76800 EVA_TOT_ReceiptTote, matching BC's own
//     record count). Has category, tote no, location, receipt, PTE_Benched and
//     EVA_TOT_Catalogued; `$filter`/`$orderby`/`$count` all work. ⚠ It has NO
//     date property (asking for SystemCreatedAt/SystemModifiedAt 400s), and its
//     only ordering is by tote number where "T…" sorts above "P…" — so each tote
//     prefix must be queried separately or pallets get buried entirely.
//  2. `ChangeLogEntries` — the REAL check-in dates, from a different table.
//     BC logs an Insertion per tote with Table_No = 76800,
//     Field_Caption = 'Tote No.', New_Value = the tote number and Date_and_Time =
//     when it was created. Verified against BC's own screen: 10 of 10 EXACT.
//     ~7,100 totes are logged (change logging wasn't on for older ones), which
//     covers the recent end — all a "newest 10" sample needs.
//
// DATED_ENDPOINT `Receipt_Totes_Excel` is only a secondary date source: it
// publishes ONLY totes NOT ticked Catalogued (1,776 of 20,418), which is why the
// table once showed SPORTS with 2 totes against BC's ~30.
//
// ⚠ FILTER ON `EVA_TOT_Catalogued eq true`, NOT on bench location. 16,833 of
// 20,418 totes carry a BENCH* LAST-KNOWN location, so bench-filtering admits
// brand-new uncatalogued stock — TRAINS' newest bench totes (T026621, T026613)
// aren't catalogued and made TRAINS look bang up to date.
//
// ⚠ DEAD ENDS, do not retry: grouping by WarehouseItem/receipts;
// `goodsReceivedDate` (0 of ~208k rows); deciding a category "isn't toted" from
// blank item source-totes (TRAINS); `$filter` on PTE_Benched/EVA_TOT_Catalogued
// against Receipt_Totes_Excel (ignored there — both true and false return all
// 1,776). To discover endpoints, read `$metadata` — the OData service root lists
// nothing.

import { prisma } from "@/lib/prisma"

const SAMPLE = 10                  // newest N catalogued totes per category
const CANDIDATES_PER_PREFIX = 15   // pulled per tote prefix before date-sorting
const FULL_ENDPOINT  = "Receipt_ExcelEVA_TOT_ReceiptTotesSubpage"
const DATED_ENDPOINT = "Receipt_Totes_Excel"
const TOTE_TABLE_NO  = 76800       // BC table EVA_TOT_ReceiptTote

const BC_BASE =
  "https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/ODataV4/Company('{company}')/"
const baseUrl = () =>
  BC_BASE
    .replace("{tenantId}",    process.env.BC_TENANT_ID ?? "")
    .replace("{environment}", process.env.BC_ENVIRONMENT ?? "production")
    .replace("{company}",     encodeURIComponent(process.env.BC_COMPANY ?? "Vectis"))

// OData keys must stay unencoded; values encoded.
async function bcQuery(
  token: string,
  endpoint: string,
  params: Record<string, string | number>,
): Promise<{ rows: Record<string, unknown>[]; count?: number }> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&")
  const res = await fetch(`${baseUrl()}${endpoint}?${qs}`, {
    headers: {
      Accept:             "application/json",
      "OData-MaxVersion": "4.0",
      Authorization:      `Bearer ${token}`,
      Prefer:             'odata.include-annotations="*"',
    },
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new Error(`BC ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  return { rows: json.value ?? [], count: json["@odata.count"] }
}

async function inBatches<T>(items: T[], concurrency: number, fn: (t: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn))
  }
}

// ⚠ BC sends an empty date as 0001-01-01 — a valid Date. Before 1990 = no date.
function bcMs(v: unknown): number | null {
  if (!v) return null
  const d = new Date(String(v))
  if (isNaN(d.getTime()) || d.getUTCFullYear() < 1990) return null
  return d.getTime()
}

// ── Dating a tote BC never logged ──
// Tote numbers are issued in sequence, so an unlogged tote sits between two
// numbered neighbours that DO have dates — read across. Cross-validated
// hold-one-out: median 0d error, p90 0.6d, 99% in the correct month; and against
// 11 known dates from BC's screen, every estimate was within 0.6 days. T and P
// are separate sequences.
type Anchor = { n: number; ms: number }

function buildAnchors(rows: { key: string; ms: number }[]): Map<string, Anchor[]> {
  const earliest = new Map<string, Map<number, number>>()
  for (const r of rows) {
    const m = /^([A-Z])0*(\d+)$/.exec(r.key)
    if (!m) continue
    const seq = earliest.get(m[1]) ?? new Map<number, number>()
    const n = parseInt(m[2], 10)
    const prev = seq.get(n)
    if (prev == null || r.ms < prev) seq.set(n, r.ms)
    earliest.set(m[1], seq)
  }
  const out = new Map<string, Anchor[]>()
  for (const [prefix, seq] of earliest) {
    out.set(prefix, [...seq.entries()].map(([n, ms]) => ({ n, ms })).sort((a, b) => a.n - b.n))
  }
  return out
}

function estimateMs(anchors: Map<string, Anchor[]>, key: string): number | null {
  const m = /^([A-Z])0*(\d+)$/.exec(key)
  if (!m) return null
  const arr = anchors.get(m[1])
  if (!arr || arr.length === 0) return null
  const n = parseInt(m[2], 10)
  let lo = -1, a = 0, b = arr.length - 1
  while (a <= b) {
    const mid = (a + b) >> 1
    if (arr[mid].n <= n) { lo = mid; a = mid + 1 } else { b = mid - 1 }
  }
  const below = lo >= 0 ? arr[lo] : null
  let ai = lo + 1
  while (ai < arr.length && arr[ai].n < n) ai++
  const above = ai < arr.length ? arr[ai] : null
  if (below && above) {
    if (above.n === below.n) return below.ms
    // A recreated/out-of-order tote can invert the pair — use the closer anchor
    // rather than interpolating backwards.
    if (above.ms < below.ms) return (n - below.n) <= (above.n - n) ? below.ms : above.ms
    return Math.round(below.ms + ((above.ms - below.ms) * (n - below.n)) / (above.n - below.n))
  }
  return below?.ms ?? above?.ms ?? null
}

function median(msSorted: number[]): number | null {
  if (msSorted.length === 0) return null
  const mid = Math.floor(msSorted.length / 2)
  return msSorted.length % 2 === 0
    ? Math.round((msSorted[mid - 1] + msSorted[mid]) / 2)
    : msSorted[mid]
}

// Join key between BC's category and our WarehouseItem counts.
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")

export type BcTote = {
  tote: string
  dateMs: number | null
  location: string | null
  estimated: boolean
}

export type BcCategory = {
  category: string
  monthMs: number | null
  oldestMs: number | null
  newestMs: number | null
  sampled: number
  dated: number
  estimatedCount: number
  poolTotes: number            // catalogued totes BC holds for this category
  totes: BcTote[]
  catalogued: number
  outstanding: number
  lastCataloguedMs: number | null
}

export type BcDiagnostics = {
  endpoint: string
  anchors: number
  loggedTotes: number
  sampled: number
  estimated: number
  shortfall: number
  note: string
}

export type BcToteDatesResult = {
  categories: BcCategory[]
  diagnostics: BcDiagnostics
}

/** How far behind, in the roundest sensible unit — shared by screen and PDF. */
export function fmtLag(fromMs: number, nowMs: number): string {
  const days = Math.round((nowMs - fromMs) / 86_400_000)
  if (days <= 0) return "today"
  if (days < 14) return `${days}d`
  if (days < 70) return `${Math.round(days / 7)}w`
  return `${(days / 30.44).toFixed(1)}m`
}

export const LAG_RED   = 90   // days behind → red
export const LAG_AMBER = 42

export async function computeBcToteDates(
  token: string,
  hiddenCategories: Set<string> = new Set(),
): Promise<BcToteDatesResult> {
  // ── Count columns + part of the category list, from our own WarehouseItem ──
  const totals = await prisma.$queryRaw<{ category: string; catalogued: number; outstanding: number; lastAt: Date | null }[]>`
    SELECT btrim(w."category")                                               AS "category",
           COUNT(*) FILTER (WHERE w."catalogued" = true)::int                AS "catalogued",
           COUNT(*) FILTER (WHERE w."catalogued" IS DISTINCT FROM true)::int AS "outstanding",
           MAX(w."cataloguedAt") FILTER (WHERE w."cataloguedAt" >= DATE '1990-01-01') AS "lastAt"
    FROM "WarehouseItem" w
    WHERE w."category" IS NOT NULL AND btrim(w."category") <> ''
    GROUP BY 1`
  const totalsByNorm = new Map(totals.map(t => [norm(t.category), t]))

  // ── Real dates, best source first: BC's change log ──
  const anchorRows: { key: string; ms: number }[] = []
  let loggedTotes = 0
  try {
    let clSkip = 0
    for (;;) {
      const { rows } = await bcQuery(token, "ChangeLogEntries", {
        $filter: `Table_No eq ${TOTE_TABLE_NO} and Field_Caption eq 'Tote No.' and Type_of_Change eq 'Insertion'`,
        $select: "New_Value,Date_and_Time",
        $top:    500,
        $skip:   clSkip,
      })
      for (const r of rows) {
        const key = String(r.New_Value ?? "").trim().toUpperCase()
        const ms  = bcMs(r.Date_and_Time)
        if (key && ms != null) { anchorRows.push({ key, ms }); loggedTotes++ }
      }
      if (rows.length < 500) break
      clSkip += 500
      if (clSkip > 40_000) break        // guard: BC's ~38k $skip ceiling
    }
  } catch { /* change log unavailable — the sources below still work */ }

  // ── Then the dated feed (un-ticked totes only) and our own records ──
  const feedCategories = new Set<string>()
  let skip = 0
  for (;;) {
    const { rows } = await bcQuery(token, DATED_ENDPOINT, {
      $top: 500, $skip: skip,
      $select: "EVA_TOT_ToteNo,EVA_TOT_ArticleCategory,SystemCreatedAt",
    })
    for (const r of rows) {
      const cat = String(r.EVA_TOT_ArticleCategory ?? "").trim()
      if (cat) feedCategories.add(cat)
      const key = String(r.EVA_TOT_ToteNo ?? "").trim().toUpperCase()
      const ms  = bcMs(r.SystemCreatedAt)
      if (key && ms != null) anchorRows.push({ key, ms })
    }
    if (rows.length < 500) break
    skip += 500
  }
  try {
    const own = await prisma.$queryRaw<{ toteNo: string; d: Date }[]>`
      SELECT upper(btrim("toteNo")) AS "toteNo", MIN("bcCreatedAt") AS d
      FROM "WarehouseTote"
      WHERE "bcCreatedAt" >= DATE '1990-01-01' AND "toteNo" IS NOT NULL
      GROUP BY 1`
    for (const r of own) anchorRows.push({ key: r.toteNo, ms: new Date(r.d).getTime() })
  } catch { /* bcCreatedAt arrives with Run Migrations — BC anchors still work */ }

  const anchors  = buildAnchors(anchorRows)
  const realDate = new Map(anchorRows.map(a => [a.key, a.ms]))

  // ── The sample: newest catalogued totes per category, from the FULL table ──
  const catList = [...new Set([...feedCategories, ...totals.map(t => t.category)])]
    .filter(c => c && !hiddenCategories.has(c))
  const candidatesByCat = new Map<string, { tote: string; location: string }[]>()
  const poolByCat = new Map<string, number>()

  await inBatches(catList, 5, async (category) => {
    const esc = category.replace(/'/g, "''")
    const found: { tote: string; location: string }[] = []
    let pool = 0
    for (const prefix of ["T", "P"]) {
      try {
        const { rows, count } = await bcQuery(token, FULL_ENDPOINT, {
          $filter:  `EVA_TOT_ArticleCategory eq '${esc}' and EVA_TOT_Catalogued eq true and startswith(EVA_TOT_ToteNo,'${prefix}')`,
          $orderby: "EVA_TOT_ToteNo desc",
          $top:     CANDIDATES_PER_PREFIX,
          $count:   "true",
          $select:  "EVA_TOT_ToteNo,EVA_TOT_ToteLocation",
        })
        pool += count ?? rows.length
        for (const r of rows) {
          const tote = String(r.EVA_TOT_ToteNo ?? "").trim().toUpperCase()
          if (tote) found.push({ tote, location: String(r.EVA_TOT_ToteLocation ?? "").trim() })
        }
      } catch { /* one prefix failing shouldn't lose the other */ }
    }
    candidatesByCat.set(category, found)
    poolByCat.set(category, pool)
  })

  // ── Date the candidates, keep the newest SAMPLE, take the median month ──
  const categories: BcCategory[] = []
  for (const category of catList) {
    const candidates = candidatesByCat.get(category) ?? []
    const dated: BcTote[] = candidates.map(c => {
      const real = realDate.get(c.tote)
      if (real != null) return { tote: c.tote, dateMs: real, location: c.location || null, estimated: false }
      const est = estimateMs(anchors, c.tote)
      return { tote: c.tote, dateMs: est, location: c.location || null, estimated: est != null }
    })
    // Newest first by check-in; undated totes sort to the end.
    dated.sort((a, b) => (b.dateMs ?? -Infinity) - (a.dateMs ?? -Infinity))
    const sample = dated.slice(0, SAMPLE)
    const days   = sample.map(s => s.dateMs).filter((d): d is number => d != null).sort((a, b) => a - b)
    const t = totalsByNorm.get(norm(category))
    categories.push({
      category,
      monthMs:  median(days),
      oldestMs: days.length > 0 ? days[0] : null,
      newestMs: days.length > 0 ? days[days.length - 1] : null,
      sampled:  sample.length,
      dated:    days.length,
      estimatedCount: sample.filter(s => s.estimated).length,
      poolTotes: poolByCat.get(category) ?? 0,
      totes:     sample,
      catalogued:  Number(t?.catalogued ?? 0),
      outstanding: Number(t?.outstanding ?? 0),
      lastCataloguedMs: t?.lastAt ? new Date(t.lastAt).getTime() : null,
    })
  }

  // Furthest behind first; categories with no dated sample sink to the bottom.
  categories.sort((a, b) => {
    if (a.monthMs == null && b.monthMs == null) return a.category.localeCompare(b.category)
    if (a.monthMs == null) return 1
    if (b.monthMs == null) return -1
    return a.monthMs - b.monthMs
  })

  const estimatedTotal = categories.reduce((n, c) => n + c.estimatedCount, 0)
  const sampledTotal   = categories.reduce((n, c) => n + c.sampled, 0)
  const diagnostics: BcDiagnostics = {
    endpoint:  FULL_ENDPOINT,
    anchors:   realDate.size,
    loggedTotes,
    sampled:   sampledTotal,
    estimated: estimatedTotal,
    shortfall: categories.filter(c => c.sampled < SAMPLE).length,
    note:
      `Totes come from BC's full receipt-tote table (every tote, including ones ticked ` +
      `Catalogued): the newest ${SAMPLE} catalogued totes per category. Check-in dates are the ` +
      `real ones from BC's change log (${loggedTotes.toLocaleString("en-GB")} tote creations ` +
      `logged) — spot-checked against BC's own screen, 10 of 10 exact. ` +
      (estimatedTotal > 0
        ? `${estimatedTotal} of ${sampledTotal} totes predate change logging, so their date is ` +
          `estimated from the tote-number sequence and shown with a ~ (accurate to about a day ` +
          `when tested).`
        : `Every date shown is a real logged date — none estimated.`),
  }

  return { categories, diagnostics }
}
