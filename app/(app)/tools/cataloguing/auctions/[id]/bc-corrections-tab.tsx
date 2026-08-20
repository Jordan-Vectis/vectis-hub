"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import * as XLSX from "xlsx"
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

// ── Verifying against a BC export ────────────────────────────────────────────
// A "Lines" export from BC is what things look like in BC *now*, so it settles
// whether a transfer actually landed.
//
// ⚠ Matched on INTERNAL BARCODE, never on UniqueID: a transferred item is
// re-sequenced under its new receipt (R008300-677 becomes R008584-something),
// so matching on the unique ID would fail for exactly the rows that succeeded.
// The unique ID is only a fallback for a lot that has no barcode.
type VerifyStatus = "done" | "not_done" | "different" | "missing"

type Verify = {
  fileName: string
  rows:     number
  byLot:    Record<string, { status: VerifyStatus; bcReceipt: string; bcVendor: string }>
  counts:   Record<VerifyStatus, number>
}

const VERIFY_LABEL: Record<VerifyStatus, string> = {
  done:      "✓ done in BC",
  not_done:  "✗ still on the old receipt",
  different: "⚠ on something else",
  missing:   "? not in the export",
}

const VERIFY_TONE: Record<VerifyStatus, string> = {
  done:      "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800/60",
  not_done:  "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60",
  different: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60",
  missing:   "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700",
}

const nrm = (v: unknown) => String(v ?? "").trim().toLowerCase()

// BC's column headings vary between exports, so take the first one that's there.
function col(row: Record<string, unknown>, ...names: string[]): string {
  for (const n of names) {
    const hit = Object.keys(row).find(k => k.trim().toLowerCase() === n.toLowerCase())
    if (hit !== undefined && String(row[hit] ?? "").trim() !== "") return String(row[hit]).trim()
  }
  return ""
}

export default function BcCorrectionsTab({ auctionId }: { auctionId: string }) {
  const [data,    setData]    = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [hideDone, setHideDone] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)   // "<groupKey>:ids" | "<groupKey>:receipt"
  const [verify, setVerify] = useState<Verify | null>(null)
  const [, startSave] = useTransition()

  // Read a BC "Lines" export and work out, per correction, whether the transfer
  // actually landed. Parsed in the browser — the file is never uploaded.
  function handleExport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !data) return
    setError(null)
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wb    = XLSX.read(ev.target?.result, { type: "array" })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows  = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
        if (rows.length === 0) { setError("That sheet has no rows in it."); return }

        const byBarcode = new Map<string, Record<string, unknown>>()
        const byUniqueId = new Map<string, Record<string, unknown>>()
        for (const r of rows) {
          const bc  = nrm(col(r, "Internal Barcode", "Barcode", "PTE_InternalBarcode"))
          const uid = nrm(col(r, "UniqueID", "Unique ID", "EVA_UniqueID"))
          if (bc)  byBarcode.set(bc, r)
          if (uid) byUniqueId.set(uid, r)
        }

        const byLot: Verify["byLot"] = {}
        const counts: Record<VerifyStatus, number> = { done: 0, not_done: 0, different: 0, missing: 0 }

        for (const g of data.groups) {
          for (const row of g.rows) {
            const hit = (row.barcode && byBarcode.get(nrm(row.barcode)))
              || (row.receiptUniqueId && byUniqueId.get(nrm(row.receiptUniqueId)))
            if (!hit) {
              byLot[row.lotId] = { status: "missing", bcReceipt: "", bcVendor: "" }
              counts.missing++
              continue
            }
            const bcReceipt = col(hit, "Receipt No.", "Receipt No", "EVA_ReceiptNo")
            const bcVendor  = col(hit, "Vendor No.", "Vendor No", "EVA_VendorNo")

            // Only compare the halves we actually asked to change.
            const receiptOk = !row.newReceipt || nrm(bcReceipt) === nrm(row.newReceipt)
            const vendorOk  = !row.newVendor  || nrm(bcVendor)  === nrm(row.newVendor)
            const stillOld  = (!!row.oldReceipt && nrm(bcReceipt) === nrm(row.oldReceipt))
                           || (!!row.oldVendor  && nrm(bcVendor)  === nrm(row.oldVendor))

            const status: VerifyStatus = receiptOk && vendorOk ? "done" : stillOld ? "not_done" : "different"
            byLot[row.lotId] = { status, bcReceipt, bcVendor }
            counts[status]++
          }
        }

        setVerify({ fileName: file.name, rows: rows.length, byLot, counts })
      } catch (err: any) {
        setError(err?.message ?? "Couldn't read that file — is it the BC Lines export?")
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ""
  }

  // Put right the ticks the export disproves — the whole point of checking.
  function untickUnfinished() {
    if (!verify || !data) return
    for (const g of data.groups) {
      for (const row of g.rows) {
        const v = verify.byLot[row.lotId]
        if (row.done && v && (v.status === "not_done" || v.status === "different")) toggle(row, false)
      }
    }
  }

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
            The same lots Tote Check finds — here as a job list for putting them right in BC. Copy the IDs and the
            receipt straight into BC, ticking each group off as you go. A lot leaves this list when BC is corrected
            and Data Sync has run, so the count always matches Tote Check.
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
          {data.total > 0 && (
            <label className="px-3 py-2 text-sm font-medium rounded-lg border border-[#2AB4A6]/60 text-[#2AB4A6] hover:bg-[#2AB4A6]/10 transition-colors cursor-pointer whitespace-nowrap"
              title="Upload a BC Lines export to check the transfers actually landed. The file is read in your browser — nothing is uploaded.">
              ⬆ Check against a BC export
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExport} className="hidden" />
            </label>
          )}
          <button onClick={load} disabled={loading}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 transition-colors disabled:opacity-50">
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* What the BC export says actually happened */}
      {verify && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] px-4 py-3 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Checked against {verify.fileName}</span>
            <span className="text-xs text-gray-500">{verify.rows.toLocaleString()} rows in the export</span>
            <button onClick={() => setVerify(null)}
              className="ml-auto text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["done", "not_done", "different", "missing"] as VerifyStatus[])
              .filter(s => verify.counts[s] > 0)
              .map(s => (
                <span key={s} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${VERIFY_TONE[s]}`}>
                  {verify.counts[s]} · {VERIFY_LABEL[s]}
                </span>
              ))}
          </div>
          {verify.counts.done === Object.values(verify.counts).reduce((a, b) => a + b, 0) ? (
            <p className="text-xs text-green-600 dark:text-green-400">Every one of them is on the right receipt and vendor in BC.</p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Matched on internal barcode — a transferred item gets a new unique ID, so the barcode is the only thing that survives the move.
              </p>
              {data.groups.some(g => g.rows.some(r => r.done && ["not_done", "different"].includes(verify.byLot[r.lotId]?.status ?? ""))) && (
                <button onClick={untickUnfinished}
                  className="text-xs font-semibold px-2.5 py-1 rounded border border-red-500/60 text-red-500 hover:bg-red-500/10 transition-colors">
                  Untick the ones BC says aren&apos;t done
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
                    {/* ⚠ Only colour what actually CHANGES. Painting an unchanged vendor red on the
                        left and green on the right says "move this too" when nothing needs moving —
                        on a long list that is a lot of imaginary work (Jordan, 2026-08-20: the vendor
                        was C023312 on both sides). */}
                    {(() => {
                      const receiptChanged = (g.oldReceipt ?? "") !== (g.newReceipt ?? "")
                      const vendorChanged  = (g.oldVendor ?? "")  !== (g.newVendor ?? "")
                      const was  = "font-mono font-bold text-red-500"
                      const will = "font-mono font-bold text-green-500"
                      const same = "font-mono text-gray-500 dark:text-gray-400"
                      return (
                        <>
                          <span className="text-gray-500 dark:text-gray-500">On </span>
                          <span className={receiptChanged ? was : same}>{g.oldReceipt ?? "—"}</span>
                          <span className="text-gray-500 dark:text-gray-500"> / </span>
                          <span className={vendorChanged ? was : same}>{g.oldVendor ?? "—"}</span>
                          <span className="mx-2 text-gray-400">→</span>
                          <span className="text-gray-500 dark:text-gray-500">should be </span>
                          <span className={receiptChanged ? will : same}>{g.newReceipt ?? "—"}</span>
                          <span className="text-gray-500 dark:text-gray-500"> / </span>
                          <span className={vendorChanged ? will : same}>{g.newVendor ?? "—"}</span>
                          {!vendorChanged && <span className="ml-2 text-xs text-gray-500">vendor unchanged</span>}
                        </>
                      )
                    })()}
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
                      {(verify ? ["Done", "Barcode", "Unique ID", "Tote", "In BC now", "Item"] : ["Done", "Barcode", "Unique ID", "Tote", "Item"]).map(h => (
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
                        {verify && (() => {
                          const v = verify.byLot[r.lotId]
                          return (
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              {v ? (
                                <div className="flex flex-col gap-0.5 items-start">
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${VERIFY_TONE[v.status]}`}>
                                    {VERIFY_LABEL[v.status]}
                                  </span>
                                  {v.status !== "done" && v.status !== "missing" && (
                                    <span className="font-mono text-[11px] text-gray-500">{v.bcReceipt || "—"} / {v.bcVendor || "—"}</span>
                                  )}
                                </div>
                              ) : <span className="text-xs text-gray-500">—</span>}
                            </td>
                          )
                        })()}
                        <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400">
                          <span className="line-clamp-1">{r.title || "—"}</span>

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
