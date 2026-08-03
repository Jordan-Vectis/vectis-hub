"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import type { BcCorrectionGroup } from "@/app/api/catalogue/bc-corrections/route"
import { setBcCorrectionDone } from "@/lib/actions/catalogue"

// The BC to-do list: lots whose vendor/receipt were wrong in the Hub and have
// since been corrected to match BC (Tote Check → "Match BC"). Because the wrong
// values are most likely what got pushed INTO BC, each row says "this barcode
// is on the wrong receipt/vendor in BC, and here's where it belongs".
//
// Grouped by the move itself (from → to), so a whole group can be dealt with in
// BC in one go, and ticked off as it's done.

type Data = { groups: BcCorrectionGroup[]; total: number; done: number; notReady?: boolean }

export default function BcCorrectionsTab({ auctionId }: { auctionId: string }) {
  const [data,    setData]    = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [hideDone, setHideDone] = useState(false)
  const [, startSave] = useTransition()

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/catalogue/bc-corrections?auctionId=${encodeURIComponent(auctionId)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d) })
      .catch(e => setError(e?.message ?? "Couldn't load"))
      .finally(() => setLoading(false))
  }, [auctionId])

  useEffect(() => { load() }, [load])

  // Tick optimistically — the list is a worklist and must feel instant on a
  // tablet; a failed save puts the tick back and shows why.
  function toggle(id: string, done: boolean) {
    setData(d => d && ({
      ...d,
      done: d.done + (done ? 1 : -1),
      groups: d.groups.map(g => ({ ...g, rows: g.rows.map(r => r.id === id ? { ...r, done } : r) })),
    }))
    startSave(async () => {
      const res = await setBcCorrectionDone(id, done)
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that tick")
        setData(d => d && ({
          ...d,
          done: d.done + (done ? -1 : 1),
          groups: d.groups.map(g => ({ ...g, rows: g.rows.map(r => r.id === id ? { ...r, done: !done } : r) })),
        }))
      }
    })
  }

  function toggleGroup(g: BcCorrectionGroup, done: boolean) {
    for (const r of g.rows) if (r.done !== done) toggle(r.id, done)
  }

  if (loading && !data) return <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Loading…</p>
  if (!data) return error ? <p className="text-sm text-red-500 py-8 text-center">{error}</p> : null

  const groups = hideDone
    ? data.groups.map(g => ({ ...g, rows: g.rows.filter(r => !r.done) })).filter(g => g.rows.length > 0)
    : data.groups

  const outstanding = data.total - data.done

  return (
    <div className="space-y-4 pb-10">

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {data.total === 0
              ? "Nothing to correct in BC."
              : <>
                  <span className="font-bold text-amber-500">{outstanding}</span> still to correct in BC
                  {data.done > 0 && <span className="text-green-500"> · {data.done} done</span>}
                </>}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
            These lots held the wrong vendor or receipt in the Hub, so that is most likely what went into BC.
            The Hub has been put right — this is what BC still needs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.done > 0 && (
            <button onClick={() => setHideDone(v => !v)}
              className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                hideDone
                  ? "bg-[#2AB4A6]/15 border-[#2AB4A6] text-[#2AB4A6]"
                  : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
              }`}>
              Hide done
            </button>
          )}
          <button onClick={load} disabled={loading}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 transition-colors disabled:opacity-50">
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {data.notReady && (
        <p className="text-xs text-amber-500">The corrections list isn&apos;t available yet on this environment.</p>
      )}

      {data.total === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-1">Nothing waiting on BC</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This fills up when Tote Check → Match BC corrects a lot that held the wrong vendor or receipt.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => {
            const left = g.rows.filter(r => !r.done).length
            return (
              <div key={g.key} className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">

                {/* Group header — the move to make in BC */}
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#141416] flex items-center gap-3 flex-wrap">
                  <div className="text-sm">
                    <span className="text-gray-500 dark:text-gray-500">Currently on </span>
                    <span className="font-mono font-bold text-red-500">{g.oldReceipt ?? "—"}</span>
                    <span className="text-gray-500 dark:text-gray-500"> / vendor </span>
                    <span className="font-mono font-bold text-red-500">{g.oldVendor ?? "—"}</span>
                    <span className="mx-2 text-gray-400">→</span>
                    <span className="text-gray-500 dark:text-gray-500">should be </span>
                    <span className="font-mono font-bold text-green-500">{g.newReceipt ?? "—"}</span>
                    <span className="text-gray-500 dark:text-gray-500"> / vendor </span>
                    <span className="font-mono font-bold text-green-500">{g.newVendor ?? "—"}</span>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    left === 0
                      ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                      : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                  }`}>
                    {left === 0 ? "✓ all done" : `${left} of ${g.rows.length} left`}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => toggleGroup(g, true)} disabled={left === 0}
                      className="text-xs font-semibold px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 transition-colors disabled:opacity-40">
                      Tick all
                    </button>
                    {g.rows.some(r => r.done) && (
                      <button onClick={() => toggleGroup(g, false)}
                        className="text-xs font-medium px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-500 hover:border-gray-400 transition-colors">
                        Untick all
                      </button>
                    )}
                  </div>
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                      {["Done", "Barcode", "Unique ID", "Tote", "Item"].map(h => (
                        <th key={h} className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(r => (
                      <tr key={r.id} className={`border-b border-gray-200 dark:border-gray-800 last:border-0 transition-colors ${r.done ? "opacity-50" : ""}`}>
                        <td className="px-4 py-2.5 w-16">
                          <label className="flex items-center cursor-pointer">
                            <input type="checkbox" checked={r.done} onChange={e => toggle(r.id, e.target.checked)}
                              className="w-4 h-4 rounded border-gray-600 accent-[#2AB4A6] cursor-pointer" />
                          </label>
                        </td>
                        <td className={`px-4 py-2.5 font-mono text-xs whitespace-nowrap ${r.done ? "line-through text-gray-500" : "font-bold text-gray-800 dark:text-gray-100"}`}>
                          {r.barcode ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-cyan-500 whitespace-nowrap">{r.receiptUniqueId ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.tote ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400">
                          <span className="line-clamp-1">{r.title || "—"}</span>
                          {r.done && r.doneBy && (
                            <span className="text-gray-500"> · ticked by {r.doneBy}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
