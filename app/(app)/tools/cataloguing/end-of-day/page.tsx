"use client"

// End of Day → BC. One click at the end of the day: every lot catalogued in
// the Hub that hasn't yet reached Business Central, grouped by tote, exported
// as the hotkey sheet (ToteNumber,LotCount,Barcodes) the overnight "add to BC"
// macro works through. Same file shape as BC Import Check reads and writes, so
// a broken overnight run can be reconciled there and re-run.

import { useCallback, useEffect, useMemo, useState } from "react"

type ToteRow = { tote: string; count: number; barcodes: string[]; sales: string[] }
type SaleRow = { code: string; name: string; complete: boolean; count: number }
type Problem = { id: string; barcode?: string; uniqueId: string; tote?: string; sale: string; title: string; cataloguedBy: string }
type Data = {
  generatedAt: string
  totalLots: number
  alreadyInBc: number
  readyCount: number
  totes: ToteRow[]
  sales: SaleRow[]
  noBarcode: Problem[]
  noTote: Problem[]
}

export default function EndOfDayPage() {
  const [data, setData]       = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [includeComplete, setIncludeComplete] = useState(false)
  const [copied, setCopied]   = useState(false)
  const [openTote, setOpenTote] = useState<string | null>(null)

  const load = useCallback(async (withComplete: boolean) => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/catalogue/end-of-day${withComplete ? "?includeComplete=1" : ""}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      setData(d)
    } catch (e: any) { setError(e?.message ?? "Failed to load"); setData(null) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(includeComplete) }, [load, includeComplete])

  // Exactly the hotkey-sheet format the macro consumes (and BC Import Check
  // round-trips): header row + one line per tote, barcodes pipe-separated.
  const csv = useMemo(() => {
    if (!data || data.totes.length === 0) return ""
    const lines = ["ToteNumber,LotCount,Barcodes"]
    for (const t of data.totes) lines.push(`${t.tote},${t.count},${t.barcodes.join("|")}`)
    return lines.join("\r\n")
  }, [data])

  function download() {
    const stamp = new Date().toISOString().slice(0, 10)
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `bc-import-${stamp}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copy() {
    try { await navigator.clipboard.writeText(csv); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch {}
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🌙 End of Day → BC</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
            Every lot catalogued in the Hub that hasn&apos;t yet reached Business Central, grouped by tote and ready to
            download as the hotkey sheet the overnight import runs through. Checked against the synced BC data by
            barcode — so lots missed on a previous day are swept up automatically.
          </p>
        </div>
        <button
          onClick={() => load(includeComplete)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
        >
          ⟳ Refresh
        </button>
      </div>

      {error && (
        <p className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Checking the day&apos;s lots against BC…</p>
      ) : data && (
        <>
          {/* ── Headline numbers ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{data.readyCount.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Lots ready for tonight&apos;s sheet</div>
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{data.totes.length.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Totes</div>
            </div>
            <div className={`border rounded-xl p-4 text-center ${data.noTote.length || data.noBarcode.length ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/40" : "bg-white dark:bg-[#1C1C1E] border-gray-200 dark:border-gray-800"}`}>
              <div className={`text-2xl font-bold ${data.noTote.length || data.noBarcode.length ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>
                {(data.noTote.length + data.noBarcode.length).toLocaleString()}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Can&apos;t go on the sheet</div>
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{data.alreadyInBc.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Already in BC</div>
            </div>
          </div>

          {/* ── Export ── */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={download}
              disabled={!csv}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              ⬇ Download tonight&apos;s hotkey sheet{data.totes.length ? ` (${data.totes.length} totes)` : ""}
            </button>
            <button
              onClick={copy}
              disabled={!csv}
              className="px-4 py-2.5 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 hover:border-emerald-500 disabled:opacity-40 text-gray-700 dark:text-gray-300 text-sm rounded-lg transition-colors"
            >
              {copied ? "✓ Copied" : "Copy to clipboard"}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeComplete}
                onChange={e => setIncludeComplete(e.target.checked)}
                className="accent-blue-500"
              />
              Include completed sales
            </label>
          </div>

          {/* ── Problems that need fixing before tonight ── */}
          {data.noTote.length > 0 && (
            <ProblemList
              label={`⚠ ${data.noTote.length} lot${data.noTote.length === 1 ? "" : "s"} with no tote — fix the tote (Manage Lots → Change Vendor) or they stay off the sheet`}
              rows={data.noTote.map(p => ({ id: p.id, main: p.barcode ?? "", extra: [p.uniqueId, p.sale, p.cataloguedBy].filter(Boolean).join(" · "), title: p.title }))}
            />
          )}
          {data.noBarcode.length > 0 && (
            <ProblemList
              label={`⚠ ${data.noBarcode.length} lot${data.noBarcode.length === 1 ? "" : "s"} with no barcode — the macro is barcode-driven, so these can't be imported until one is set`}
              rows={data.noBarcode.map(p => ({ id: p.id, main: p.uniqueId, extra: [p.tote, p.sale, p.cataloguedBy].filter(Boolean).join(" · "), title: p.title }))}
            />
          )}

          {/* ── Per-sale summary ── */}
          {data.sales.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.sales.map(s => (
                <span key={s.code} className={`text-xs px-2.5 py-1 rounded-full border ${s.complete ? "border-amber-400 dark:border-amber-700 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20" : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-[#1C1C1E]"}`}>
                  <span className="font-mono font-semibold">{s.code}</span> · {s.count} lot{s.count === 1 ? "" : "s"}{s.complete ? " · completed sale" : ""}
                </span>
              ))}
            </div>
          )}

          {/* ── The sheet, on screen ── */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Tote</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Lots</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Sale</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Barcodes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
                {data.totes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      🎉 Nothing waiting — every catalogued lot is already in BC.
                    </td>
                  </tr>
                )}
                {data.totes.map(t => {
                  const open = openTote === t.tote
                  return (
                    <tr key={t.tote} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                      <td className="px-4 py-2.5 font-mono font-semibold text-cyan-700 dark:text-cyan-300 whitespace-nowrap">{t.tote}</td>
                      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{t.count}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{t.sales.join(", ") || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-gray-400">
                        {open ? t.barcodes.join(" | ") : `${t.barcodes.slice(0, 6).join(" | ")}${t.barcodes.length > 6 ? " …" : ""}`}
                        {t.barcodes.length > 6 && (
                          <button
                            onClick={() => setOpenTote(open ? null : t.tote)}
                            className="ml-2 text-blue-500 hover:text-blue-400"
                          >
                            {open ? "less" : `all ${t.barcodes.length}`}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-500">
            Checked against BC data synced {`at ${new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`} —
            if today&apos;s BC sync hasn&apos;t run recently, run Data Sync in BC Warehouse first or already-imported lots may reappear here.
            If the overnight run breaks part-way, reconcile with Auction AI → BC Import Check.
          </p>
        </>
      )}
    </div>
  )
}

function ProblemList({ label, rows }: { label: string; rows: { id: string; main: string; extra: string; title: string }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300 w-full text-left">
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        <span>{label}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
          {rows.map(r => (
            <div key={r.id} className="text-xs text-amber-900 dark:text-amber-200 flex flex-wrap gap-x-2">
              <span className="font-mono font-semibold">{r.main || "—"}</span>
              {r.extra && <span className="opacity-70">{r.extra}</span>}
              <span className="opacity-90 truncate max-w-md">{r.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
