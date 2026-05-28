"use client"

import { useMemo } from "react"

interface Lot {
  id: string; barcode: string | null; receiptUniqueId: string | null; title: string; description: string; keyPoints: string
  estimateLow: number | null; estimateHigh: number | null; startingBid: number | null
  reserve: number | null; hammerPrice: number | null
  condition: string | null; vendor: string | null; tote: string | null
  receipt: string | null; receiptUniqueId: string | null
  category: string | null; subCategory: string | null; brand: string | null
  status: string; aiUpgraded: boolean; createdByName: string | null; imageUrls: string[]
}

interface Auction {
  code: string; name: string; auctionDate: Date | null; auctionType: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString("en-GB") }
function pct(n: number, total: number) { return total === 0 ? 0 : Math.round((n / total) * 100) }

function top<T extends string>(arr: (T | null | undefined)[], limit = 8): { key: T; count: number }[] {
  const map = new Map<T, number>()
  for (const v of arr) { if (v) map.set(v, (map.get(v) ?? 0) + 1) }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BigStat({ label, value, sub, colour = "text-gray-900 dark:text-white" }: {
  label: string; value: string | number; sub?: string; colour?: string
}) {
  return (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl px-5 py-4">
      <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colour}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function ProgressBar({ label, count, total, colour = "#2AB4A6" }: {
  label: string; count: number; total: number; colour?: string
}) {
  const p = pct(count, total)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className="text-gray-600 dark:text-gray-300 font-medium">{count} <span className="text-gray-600">/ {total}</span> <span className="text-gray-600 dark:text-gray-500">({p}%)</span></span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${p}%`, backgroundColor: colour }} />
      </div>
    </div>
  )
}

function BreakdownBar({ items, total }: { items: { key: string; count: number; colour?: string }[]; total: number }) {
  if (!items.length) return <p className="text-xs text-gray-600 italic">No data</p>
  const max = Math.max(...items.map(i => i.count))
  return (
    <div className="space-y-2">
      {items.map(({ key, count, colour }) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-xs text-gray-600 dark:text-gray-400 w-32 flex-shrink-0 truncate" title={key}>{key}</span>
          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full"
              style={{ width: `${(count / max) * 100}%`, backgroundColor: colour ?? "#2AB4A6" }} />
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-300 w-8 text-right flex-shrink-0">{count}</span>
          <span className="text-xs text-gray-600 w-10 text-right flex-shrink-0">{pct(count, total)}%</span>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {children}
    </div>
  )
}

// ── Condition colours ─────────────────────────────────────────────────────────

const CONDITION_COLOURS: Record<string, string> = {
  Mint:       "#22c55e",
  "Near Mint":"#84cc16",
  Excellent:  "#2AB4A6",
  Good:       "#3b82f6",
  Fair:       "#f59e0b",
  Poor:       "#ef4444",
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsTab({ lots, auction }: { lots: Lot[]; auction: Auction }) {
  const stats = useMemo(() => {
    const total = lots.length
    if (total === 0) return null

    // ── Estimates ──────────────────────────────────────────────────────────
    const withEstimate    = lots.filter(l => l.estimateLow != null && l.estimateHigh != null)
    const totalEstLow     = withEstimate.reduce((s, l) => s + (l.estimateLow  ?? 0), 0)
    const totalEstHigh    = withEstimate.reduce((s, l) => s + (l.estimateHigh ?? 0), 0)
    const avgEstLow       = withEstimate.length ? Math.round(totalEstLow  / withEstimate.length) : 0
    const avgEstHigh      = withEstimate.length ? Math.round(totalEstHigh / withEstimate.length) : 0
    const highestLot      = [...withEstimate].sort((a, b) => (b.estimateHigh ?? 0) - (a.estimateHigh ?? 0))[0]
    const lowestLot       = [...withEstimate].sort((a, b) => (a.estimateLow  ?? 0) - (b.estimateLow  ?? 0))[0]

    // Hammer prices (if auction has results)
    const withHammer      = lots.filter(l => l.hammerPrice != null)
    const totalHammer     = withHammer.reduce((s, l) => s + (l.hammerPrice ?? 0), 0)
    const avgHammer       = withHammer.length ? Math.round(totalHammer / withHammer.length) : 0

    // ── Completion ────────────────────────────────────────────────────────
    const withDesc        = lots.filter(l => l.description?.trim())
    const withKeyPoints   = lots.filter(l => l.keyPoints?.trim())
    const withPhotos      = lots.filter(l => l.imageUrls.length > 0)
    const missingPhotos   = lots.filter(l => l.imageUrls.length === 0)
    const withTitle       = lots.filter(l => l.title?.trim())
    const aiUpgraded      = lots.filter(l => l.aiUpgraded)
    const totalPhotos     = lots.reduce((s, l) => s + l.imageUrls.length, 0)
    const avgPhotos       = total ? (totalPhotos / total).toFixed(1) : "0"

    // ── Breakdowns ────────────────────────────────────────────────────────
    const byCondition     = top(lots.map(l => l.condition))
    const byCategory      = top(lots.map(l => l.category))
    const bySubCat        = top(lots.map(l => l.subCategory))
    const byVendor        = top(lots.map(l => l.vendor))
    const byTote          = top(lots.map(l => l.tote))
    const byReceipt       = top(lots.map(l => l.receipt))
    const byStatus        = top(lots.map(l => l.status))
    const byCataloguer    = top(lots.map(l => l.createdByName))
    const byBrand         = top(lots.map(l => l.brand))

    // Unique counts
    const uniqueVendors   = new Set(lots.map(l => l.vendor).filter(Boolean)).size
    const uniqueTotes     = new Set(lots.map(l => l.tote).filter(Boolean)).size
    const uniqueReceipts  = new Set(lots.map(l => l.receipt).filter(Boolean)).size
    const uniqueCategories = new Set(lots.map(l => l.category).filter(Boolean)).size

    // Photo distribution
    const photoDistrib = [0, 1, 2, 3].map(n => ({
      key:   n === 3 ? "3+" : String(n),
      count: n === 3 ? lots.filter(l => l.imageUrls.length >= 3).length : lots.filter(l => l.imageUrls.length === n).length,
    }))

    // Estimate by category
    const catEstimates: { key: string; low: number; high: number; count: number }[] = []
    const catMap = new Map<string, { low: number; high: number; count: number }>()
    for (const l of lots) {
      if (!l.category || l.estimateLow == null) continue
      const e = catMap.get(l.category) ?? { low: 0, high: 0, count: 0 }
      e.low += l.estimateLow ?? 0; e.high += l.estimateHigh ?? 0; e.count++
      catMap.set(l.category, e)
    }
    catMap.forEach((v, k) => catEstimates.push({ key: k, ...v }))
    catEstimates.sort((a, b) => b.high - a.high)

    return {
      total, withEstimate: withEstimate.length, totalEstLow, totalEstHigh,
      avgEstLow, avgEstHigh, highestLot, lowestLot,
      withHammer: withHammer.length, totalHammer, avgHammer,
      withDesc: withDesc.length, withKeyPoints: withKeyPoints.length,
      withPhotos: withPhotos.length, missingPhotos: missingPhotos.length,
      withTitle: withTitle.length,
      aiUpgraded: aiUpgraded.length, totalPhotos, avgPhotos,
      byCondition, byCategory, bySubCat, byVendor, byTote,
      byReceipt, byStatus, byCataloguer, byBrand,
      uniqueVendors, uniqueTotes, uniqueReceipts, uniqueCategories,
      photoDistrib, catEstimates,
    }
  }, [lots])

  if (lots.length === 0) {
    return (
      <div className="p-8 text-center text-gray-600">
        <p className="text-3xl mb-3">📊</p>
        <p className="text-sm">No lots yet — statistics will appear once lots are added.</p>
      </div>
    )
  }

  if (!stats) return null

  const total = stats.total

  return (
    <div className="space-y-6 pb-8">

      {/* ── Headline numbers ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <BigStat label="Total Lots"        value={stats.total} />
        <BigStat label="Estimate Low (total)"  value={`£${fmt(stats.totalEstLow)}`}  colour="text-[#2AB4A6]"
          sub={`${stats.withEstimate} of ${total} lots have estimates`} />
        <BigStat label="Estimate High (total)" value={`£${fmt(stats.totalEstHigh)}`} colour="text-[#2AB4A6]"
          sub={`Avg £${fmt(stats.avgEstLow)}–£${fmt(stats.avgEstHigh)} per lot`} />
        <BigStat label="Total Photos"      value={stats.totalPhotos}
          sub={`${stats.avgPhotos} avg per lot`} />
        <BigStat label="Lots Missing Photos"
          value={stats.missingPhotos}
          colour={stats.missingPhotos > 0 ? 'text-red-500 dark:text-red-400' : 'text-emerald-500 dark:text-emerald-400'}
          sub={stats.missingPhotos > 0
            ? `${pct(stats.missingPhotos, total)}% of lots have no photos`
            : 'All lots have photos ✓'} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <BigStat label="Unique Vendors"    value={stats.uniqueVendors} />
        <BigStat label="Unique Totes"      value={stats.uniqueTotes} />
        <BigStat label="Unique Receipts"   value={stats.uniqueReceipts} />
        <BigStat label="Unique Categories" value={stats.uniqueCategories} />
      </div>

      {/* Highest / lowest lots */}
      {(stats.highestLot || stats.lowestLot) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {stats.highestLot && (
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl px-5 py-4">
              <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-2">Highest Estimate Lot</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{stats.highestLot.title || "Uncatalogued"}</p>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Lot {stats.highestLot.barcode ?? stats.highestLot.receiptUniqueId ?? ""} ·<span className="text-[#2AB4A6] font-semibold">£{fmt(stats.highestLot.estimateLow ?? 0)}–£{fmt(stats.highestLot.estimateHigh ?? 0)}</span></p>
            </div>
          )}
          {stats.lowestLot && (
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl px-5 py-4">
              <p className="text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-2">Lowest Estimate Lot</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{stats.lowestLot.title || "Uncatalogued"}</p>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Lot {stats.lowestLot.barcode ?? stats.lowestLot.receiptUniqueId ?? ""} ·<span className="text-yellow-400 font-semibold">£{fmt(stats.lowestLot.estimateLow ?? 0)}–£{fmt(stats.lowestLot.estimateHigh ?? 0)}</span></p>
            </div>
          )}
        </div>
      )}

      {/* Hammer prices (if any results) */}
      {stats.withHammer > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <BigStat label="Lots Sold"      value={stats.withHammer} sub={`of ${total} lots`} />
          <BigStat label="Total Hammer"   value={`£${fmt(stats.totalHammer)}`} colour="text-emerald-400" />
          <BigStat label="Avg Hammer"     value={`£${fmt(stats.avgHammer)}`}   colour="text-emerald-400" />
        </div>
      )}

      {/* ── Completion progress ── */}
      <Section title="Cataloguing Completion">
        <div className="space-y-3">
          <ProgressBar label="Has description"  count={stats.withDesc}       total={total} colour="#2AB4A6" />
          <ProgressBar label="Has key points"   count={stats.withKeyPoints}  total={total} colour="#3b82f6" />
          <ProgressBar label="Has photos"       count={stats.withPhotos}     total={total} colour="#a855f7" />
          <ProgressBar label="Has estimates"    count={stats.withEstimate}   total={total} colour="#f59e0b" />
          <ProgressBar label="Has title"        count={stats.withTitle}      total={total} colour="#6366f1" />
          <ProgressBar label="AI upgraded"      count={stats.aiUpgraded}     total={total} colour="#ec4899" />
        </div>
      </Section>

      {/* ── Photo distribution + status ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Photos per Lot">
          <BreakdownBar total={total}
            items={stats.photoDistrib.map(p => ({ key: `${p.key} photo${p.key === "1" ? "" : "s"}`, count: p.count }))} />
        </Section>

        <Section title="Lot Status">
          <BreakdownBar total={total}
            items={stats.byStatus.map(s => ({ key: s.key, count: s.count }))} />
        </Section>
      </div>

      {/* ── Category breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="By Category">
          <BreakdownBar total={total} items={stats.byCategory.map(c => ({ key: c.key, count: c.count }))} />
        </Section>
        <Section title="By Sub-Category">
          <BreakdownBar total={total} items={stats.bySubCat.map(c => ({ key: c.key, count: c.count }))} />
        </Section>
      </div>

      {/* Category estimates table */}
      {stats.catEstimates.length > 0 && (
        <Section title="Estimate by Category">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-600 dark:text-gray-500 border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left py-2 pr-4">Category</th>
                  <th className="text-right py-2 pr-4">Lots</th>
                  <th className="text-right py-2 pr-4">Est. Low</th>
                  <th className="text-right py-2 pr-4">Est. High</th>
                  <th className="text-right py-2">Avg per Lot</th>
                </tr>
              </thead>
              <tbody>
                {stats.catEstimates.map(c => (
                  <tr key={c.key} className="border-b border-gray-200/50 dark:border-gray-800/50 hover:bg-gray-100/50 dark:hover:bg-gray-800/20">
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-300 font-medium">{c.key}</td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400 text-right">{c.count}</td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400 text-right">£{fmt(c.low)}</td>
                    <td className="py-2 pr-4 text-[#2AB4A6] text-right font-semibold">£{fmt(c.high)}</td>
                    <td className="py-2 text-gray-600 dark:text-gray-500 text-right">£{fmt(Math.round(c.high / c.count))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── Condition breakdown ── */}
      <Section title="By Condition">
        <BreakdownBar total={total}
          items={stats.byCondition.map(c => ({
            key: c.key, count: c.count,
            colour: CONDITION_COLOURS[c.key] ?? "#6b7280",
          }))} />
        {lots.filter(l => !l.condition).length > 0 && (
          <p className="text-xs text-gray-600 mt-2">
            {lots.filter(l => !l.condition).length} lots have no condition recorded
          </p>
        )}
      </Section>

      {/* ── Vendor / tote / receipt ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title={`Top Vendors (${stats.uniqueVendors} total)`}>
          <BreakdownBar total={total} items={stats.byVendor.map(v => ({ key: v.key, count: v.count }))} />
        </Section>
        <Section title={`Top Totes (${stats.uniqueTotes} total)`}>
          <BreakdownBar total={total} items={stats.byTote.map(v => ({ key: v.key, count: v.count }))} />
        </Section>
        <Section title={`Top Receipts (${stats.uniqueReceipts} total)`}>
          <BreakdownBar total={total} items={stats.byReceipt.map(v => ({ key: v.key, count: v.count }))} />
        </Section>
      </div>

      {/* ── Brand + cataloguer ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Top Brands">
          <BreakdownBar total={total} items={stats.byBrand.map(b => ({ key: b.key, count: b.count }))} />
        </Section>
        <Section title="By Cataloguer">
          <BreakdownBar total={total} items={stats.byCataloguer.map(c => ({ key: c.key, count: c.count, colour: "#a855f7" }))} />
        </Section>
      </div>

    </div>
  )
}
