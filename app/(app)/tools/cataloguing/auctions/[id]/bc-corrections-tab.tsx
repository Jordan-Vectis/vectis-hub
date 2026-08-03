"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import type { BcCorrectionGroup, BcCorrectionRow } from "@/app/api/catalogue/bc-corrections/route"
import { setBcCorrectionDone } from "@/lib/actions/catalogue"

// The BC to-do list. BC is correct and our data was wrong, so the wrong
// vendor/receipt is most likely what got pushed INTO BC — each row says "this
// barcode is on the wrong receipt/vendor in BC, and here's where it belongs".
//
// ⚠ LIVE, not a leftover of the Match BC button: the list shows today's
// mismatches straight away so BC can be put right FIRST and checked back on
// afterwards. Ticks persist, and rows survive the Hub being corrected (at which
// point they simply stop saying "Hub still wrong").
//
// Grouped by the move itself (from → to), so a whole group can be dealt with in
// BC in one go.

type Data = { groups: BcCorrectionGroup[]; total: number; done: number; notReady?: boolean }

export default function BcCorrectionsTab({ auctionId }: { auctionId: string }) {
  const [data,    setData]    = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [hideDone, setHideDone] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)   // "<groupKey>:ids" | "<groupKey>:receipt"
  const [, startSave] = useTransition()

  // BC's Transfer/Copy Receipt Line dialog takes the unique IDs pipe-separated
  // in its UniqueID filter, and the destination in Target Receipt No. — so the
  // two things worth copying are exactly those.
  async function copy(text: string, token: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API needs a secure context / permission; fall back so the
      // button still works rather than silently doing nothing.
      const el = document.createElement("textarea")
      el.value = text
      el.style.position = "fixed"
      el.style.opacity = "0"
      document.body.appendChild(el)
      el.select()
      try { document.execCommand("copy") } catch { /* nothing more to try */ }
      document.body.removeChild(el)
    }
    setCopied(token)
    setTimeout(() => setCopied(c => (c === token ? null : c)), 1800)
  }

  // The ones still to do — ticked-off rows have already been transferred.
  // Falls back to the whole group once everything is ticked, so the button
  // never copies an empty string.
  function idsFor(g: BcCorrectionGroup): string[] {
    const left = g.rows.filter(r => !r.done)
    const use  = left.length > 0 ? left : g.rows
    return use.map(r => (r.receiptUniqueId ?? "").trim()).filter(Boolean)
  }

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

  // Tick optimistically — a worklist has to feel instant on a tablet; a failed
  // save puts the tick back and says why.
  function toggle(row: BcCorrectionRow, done: boolean) {
    const flip = (want: boolean) => setData(d => d && ({
      ...d,
      done: d.done + (want ? 1 : -1),
      groups: d.groups.map(g => ({ ...g, rows: g.rows.map(r => r.lotId === row.lotId ? { ...r, done: want } : r) })),
    }))
    flip(done)
    startSave(async () => {
      const res = await setBcCorrectionDone({
        auctionId, lotId: row.lotId, done,
        // Only used when this lot has no saved row yet — ticking a live
        // mismatch is what first records what BC is holding.
        snapshot: {
          barcode: row.barcode, receiptUniqueId: row.receiptUniqueId, title: row.title, tote: row.tote,
          oldVendor: row.oldVendor, oldReceipt: row.oldReceipt,
          newVendor: row.newVendor, newReceipt: row.newReceipt,
        },
      })
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that tick")
        flip(!done)
      }
    })
  }

  function toggleGroup(g: BcCorrectionGroup, done: boolean) {
    for (const r of g.rows) if (r.done !== done) toggle(r, done)
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
                  <span className="font-bold text-amber-500">{outstanding}</span> to correct in BC
                  {data.done > 0 && <span className="text-green-500"> · {data.done} ticked off</span>}
                </>}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5 max-w-3xl">
            Each of these lots is on the wrong receipt or vendor. BC is right, so the wrong value is most likely what
            went into BC — fix these there, ticking them off as you go. The list stays put after Tote Check → Match BC
            tidies the Hub, so you can come back to it.
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
              Hide ticked off
            </button>
          )}
          <button onClick={load} disabled={loading}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 transition-colors disabled:opacity-50">
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {data.notReady && (
        <p className="text-xs text-amber-500">
          Ticking these off isn&apos;t available on this environment yet — the list still shows what needs correcting.
        </p>
      )}

      {data.total === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-1">Nothing waiting on BC</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No lot is on a different receipt or vendor from the tote it was catalogued from.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => {
            const left = g.rows.filter(r => !r.done).length
            const ids  = idsFor(g)
            // Lots with no unique ID can't go in the BC filter — say so rather
            // than quietly copying a short list.
            const noId = (left > 0 ? g.rows.filter(r => !r.done) : g.rows).length - ids.length
            return (
              <div key={g.key} className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">

                {/* Group header — the move to make in BC */}
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#141416] flex items-center gap-3 flex-wrap">
                  <div className="text-sm">
                    <span className="text-gray-500 dark:text-gray-500">On </span>
                    <span className="font-mono font-bold text-red-500">{g.oldReceipt ?? "—"}</span>
                    <span className="text-gray-500 dark:text-gray-500"> / </span>
                    <span className="font-mono font-bold text-red-500">{g.oldVendor ?? "—"}</span>
                    <span className="mx-2 text-gray-400">→</span>
                    <span className="text-gray-500 dark:text-gray-500">should be </span>
                    <span className="font-mono font-bold text-green-500">{g.newReceipt ?? "—"}</span>
                    <span className="text-gray-500 dark:text-gray-500"> / </span>
                    <span className="font-mono font-bold text-green-500">{g.newVendor ?? "—"}</span>
                    {g.newVendorName && <span className="text-gray-500"> · {g.newVendorName}</span>}
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    left === 0
                      ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                      : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                  }`}>
                    {left === 0 ? "✓ all done" : `${left} of ${g.rows.length} left`}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {/* Straight into BC's Transfer/Copy dialog: the UniqueID
                        filter takes them pipe-separated, and Target Receipt No.
                        is the receipt they should be on. */}
                    <button
                      onClick={() => copy(ids.join("|"), `${g.key}:ids`)}
                      disabled={ids.length === 0}
                      title="Copies the unique IDs still to do, pipe-separated, ready for the UniqueID filter in BC's Transfer/Copy Receipt Line dialog."
                      className="text-xs font-semibold px-2.5 py-1 rounded border transition-colors disabled:opacity-40 border-[#2AB4A6]/60 text-[#2AB4A6] hover:bg-[#2AB4A6]/10">
                      {copied === `${g.key}:ids` ? "✓ Copied" : `⧉ Copy ${ids.length} ID${ids.length === 1 ? "" : "s"}`}
                    </button>
                    <button
                      onClick={() => copy(g.newReceipt ?? "", `${g.key}:receipt`)}
                      disabled={!g.newReceipt}
                      title="Copies the receipt these should be moved to, for Target Receipt No."
                      className="text-xs font-semibold px-2.5 py-1 rounded border transition-colors disabled:opacity-40 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400">
                      {copied === `${g.key}:receipt` ? "✓ Copied" : `⧉ ${g.newReceipt ?? "—"}`}
                    </button>
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
                  {noId > 0 && (
                    <p className="w-full text-xs text-amber-500">
                      ⚠ {noId} of these {noId === 1 ? "has" : "have"} no unique ID, so {noId === 1 ? "it isn't" : "they aren't"} in the copied list — those need doing by barcode.
                    </p>
                  )}
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
                      <tr key={r.lotId} className={`border-b border-gray-200 dark:border-gray-800 last:border-0 transition-colors ${r.done ? "opacity-50" : ""}`}>
                        <td className="px-4 py-2.5 w-16">
                          <label className="flex items-center cursor-pointer">
                            <input type="checkbox" checked={r.done} onChange={e => toggle(r, e.target.checked)}
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
                          {!r.stillWrong && (
                            <span className="text-gray-500" title="Tote Check → Match BC has already put the Hub right for this lot.">
                              {" "}· Hub corrected
                            </span>
                          )}
                          {r.done && r.doneBy && <span className="text-gray-500"> · ticked by {r.doneBy}</span>}
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
