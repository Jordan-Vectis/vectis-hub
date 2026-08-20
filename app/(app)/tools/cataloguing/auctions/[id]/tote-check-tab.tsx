"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import type { ToteCheckIssue, ToteCheckRow } from "@/app/api/catalogue/tote-check/route"
import { autocorrectLotsFromTotes } from "@/lib/actions/catalogue"

// Checks every lot's Vendor / Receipt / Tote against the BC-synced tote data —
// the same source the lot wizard's tote box reads, so this is "does the lot
// still agree with what the tote said when it was catalogued?".
//
// Read-only by design: it reports, it never edits a lot. Fixing is done in the
// lot itself (click a row) or with Manage Lots → Pull Vendor/Receipt from Totes.

type CheckResult = {
  checked:  number
  clean:    number
  rows:     ToteCheckRow[]
  lastSync: string | null
}

// Order matters — this is the order the summary chips appear in, worst first.
const ISSUES: { key: ToteCheckIssue; label: string; hint: string; tone: "bad" | "warn" | "info" }[] = [
  { key: "tote_receipt_mismatch", label: "Tote belongs to another receipt", tone: "warn",
    hint: "The lot's receipt is confirmed by BC's own unique ID, so the RECEIPT is right and the TOTE is the odd one out. Either this lot was catalogued from the wrong tote, or the item moved after it was toted. Do NOT correct the receipt from the tote - that would put the lot out of step with BC." },
  { key: "receipt_mismatch",   label: "Receipt doesn't match the tote", tone: "bad",
    hint: "The tote belongs to a different receipt in BC. Either the wrong receipt was typed, or the item is in the wrong tote." },
  { key: "vendor_mismatch",    label: "Vendor doesn't match the tote",  tone: "bad",
    hint: "The tote belongs to a different vendor in BC — often the previous batch's vendor left in place." },
  { key: "unique_id_mismatch", label: "Unique ID against a different receipt", tone: "bad",
    hint: "The unique ID starts with one receipt (R008729-38) but the lot's receipt field says another. One of the two is wrong." },
  { key: "receipt_missing",    label: "No receipt on the lot",          tone: "warn",
    hint: "The tote has a receipt in BC but the lot doesn't. Manage Lots → Pull Vendor/Receipt from Totes fills these." },
  { key: "vendor_missing",     label: "No vendor on the lot",           tone: "warn",
    hint: "The tote has a vendor in BC but the lot doesn't." },
  { key: "tote_unknown",       label: "Tote not in the BC data",        tone: "warn",
    hint: "No tote with this number came back from BC — either a typo, or the tote hasn't synced yet. Check the sync date above before treating these as mistakes." },
  { key: "no_tote",            label: "No tote on the lot",             tone: "info",
    hint: "Nothing to check this lot against." },
]

const TONE: Record<"bad" | "warn" | "info", string> = {
  bad:  "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60",
  warn: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60",
  info: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700",
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "never"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "unknown"
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1)    return "just now"
  if (mins < 60)   return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24)    return `${hrs} hour${hrs === 1 ? "" : "s"} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

export default function ToteCheckTab({
  auctionId,
  onOpenLot,
}: {
  auctionId: string
  onOpenLot: (id: string) => void
}) {
  const [result,  setResult]  = useState<CheckResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [filter,  setFilter]  = useState<ToteCheckIssue | null>(null)
  const [confirmFix, setConfirmFix] = useState(false)
  const [fixResult,  setFixResult]  = useState<string | null>(null)
  const [fixing, startFix] = useTransition()

  const run = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/catalogue/tote-check?auctionId=${encodeURIComponent(auctionId)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setResult(d) })
      .catch(e => setError(e?.message ?? "Check failed"))
      .finally(() => setLoading(false))
  }, [auctionId])

  useEffect(() => { run() }, [run])

  function applyFix() {
    setConfirmFix(false)
    setError(null)
    setFixResult(null)
    startFix(async () => {
      const res = await autocorrectLotsFromTotes(auctionId)
      if (!res.ok) { setError(res.error ?? "Couldn't correct the lots"); return }
      setFixResult(
        `Corrected ${res.updated ?? 0} lot${res.updated === 1 ? "" : "s"} to match BC.` +
        ((res.corrections ?? 0) > 0
          ? ` ${res.corrections} had a wrong value that has most likely gone into BC — see the BC Corrections tab.`
          : "") +
        ((res.skipped ?? 0) > 0 ? ` ${res.skipped} couldn't be checked (no tote, or the tote isn't in BC).` : ""),
      )
      run()
    })
  }

  // Only mismatches and blanks with a known tote can be corrected — an unknown
  // tote has nothing to correct against.
  const fixable = (result?.rows ?? []).filter(r =>
    r.issues.some(i => i === "receipt_mismatch" || i === "tote_receipt_mismatch" || i === "vendor_mismatch" || i === "receipt_missing" || i === "vendor_missing"),
  ).length

  if (loading && !result) return <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Checking lots against the BC tote data…</p>
  if (error)   return <p className="text-sm text-red-500 py-8 text-center">{error}</p>
  if (!result) return null

  const counts = Object.fromEntries(
    ISSUES.map(i => [i.key, result.rows.filter(r => r.issues.includes(i.key)).length]),
  ) as Record<ToteCheckIssue, number>

  const shown = filter ? result.rows.filter(r => r.issues.includes(filter)) : result.rows

  return (
    <div className="space-y-4 pb-10">

      {/* Summary */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Checked <span className="font-bold text-gray-900 dark:text-white">{result.checked}</span> lots against the BC tote data —{" "}
            {result.rows.length === 0
              ? <span className="font-semibold text-green-500">everything matches</span>
              : <><span className="font-bold text-amber-500">{result.rows.length}</span> to look at, <span className="text-green-500">{result.clean} fine</span></>}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
            Tote data last pulled from BC {fmtWhen(result.lastSync)} · refresh it on BC Warehouse → Data Sync
          </p>
        </div>
        <div className="flex items-center gap-2">
          {fixable > 0 && (
            <button
              onClick={() => setConfirmFix(true)}
              disabled={fixing || loading}
              title="Rewrites the vendor and receipt on these lots to whatever BC has for their tote."
              className="px-3 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
              style={{ background: "#2AB4A6", color: "#1C1C1E" }}
            >
              {fixing ? "Correcting…" : `✓ Match BC (${fixable})`}
            </button>
          )}
          <button
            onClick={run}
            disabled={loading || fixing}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 transition-colors disabled:opacity-50"
          >
            {loading ? "Checking…" : "↻ Check again"}
          </button>
        </div>
      </div>

      {fixResult && (
        <div className="rounded-xl border border-green-600/50 bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm text-green-800 dark:text-green-300">
          {fixResult}
        </div>
      )}

      {/* Confirm — this rewrites lot data, so it says exactly what will happen */}
      {confirmFix && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmFix(false)}>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">Correct {fixable} lot{fixable === 1 ? "" : "s"} to match BC?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              The vendor and receipt on these lots will be set to whatever BC has for their tote. BC is treated as correct.
            </p>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1.5 mb-4 list-disc pl-4">
              <li>Any lot that held a <span className="font-semibold">wrong</span> value is saved to the <span className="font-semibold">BC Corrections</span> tab first — that wrong value most likely went into BC, and this is the only record of it afterwards.</li>
              <li>Unique IDs are <span className="font-semibold">not</span> changed, so a corrected lot may still show &ldquo;unique ID against a different receipt&rdquo;.</li>
              <li>Lots with no tote, or a tote BC doesn&apos;t have, are left alone.</li>
              <li>Every change is recorded in the Lot Change Log.</li>
            </ul>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setConfirmFix(false)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400">Cancel</button>
              <button type="button" onClick={applyFix}
                className="px-4 py-2 text-sm font-semibold rounded-lg" style={{ background: "#2AB4A6", color: "#1C1C1E" }}>
                Correct them
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issue chips — click one to see only those lots */}
      {result.rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ISSUES.filter(i => counts[i.key] > 0).map(i => (
            <button
              key={i.key}
              onClick={() => setFilter(f => (f === i.key ? null : i.key))}
              title={i.hint}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${TONE[i.tone]} ${
                filter === i.key ? "ring-2 ring-offset-1 ring-offset-transparent ring-current" : "opacity-90 hover:opacity-100"
              }`}
            >
              {counts[i.key]} · {i.label}
            </button>
          ))}
          {filter && (
            <button onClick={() => setFilter(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              Show all
            </button>
          )}
        </div>
      )}

      {result.rows.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-1">Every lot agrees with its tote</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Vendor, receipt and unique ID all match what BC has for the tote each lot was catalogued from.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#141416] text-left">
                {/* "BC says" was untrue: this column is what the TOTE is filed under in BC, not BC's
                    record for the lot. On F109 it read "BC says R006447" while BC's Receipt Lines had
                    those lots on R006956 - and someone acting on it would have corrupted them. */}
                {["Barcode", "Unique ID", "Tote", "What's wrong", "The tote is on", "On the lot", "Added by"].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id}
                  onClick={() => onOpenLot(r.id)}
                  className="border-b border-gray-200 dark:border-gray-800 last:border-0 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer align-top">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.barcode ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-cyan-500 whitespace-nowrap">{r.receiptUniqueId ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.tote ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1 items-start">
                      {ISSUES.filter(i => r.issues.includes(i.key)).map(i => (
                        <span key={i.key} title={i.hint}
                          className={`px-2 py-0.5 rounded text-xs font-semibold border whitespace-nowrap ${TONE[i.tone]}`}>
                          {i.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {r.bcReceipt || r.bcVendor ? (
                      <>
                        <div>Receipt <span className="font-mono text-gray-700 dark:text-gray-200">{r.bcReceipt ?? "—"}</span></div>
                        <div>Vendor <span className="font-mono text-gray-700 dark:text-gray-200">{r.bcVendor ?? "—"}</span>
                          {r.bcVendorName && <span className="text-gray-500"> · {r.bcVendorName}</span>}
                        </div>
                      </>
                    ) : <span className="text-gray-500 italic">no tote data</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    <div>Receipt <span className={`font-mono ${r.issues.includes("receipt_mismatch") ? "text-red-500 font-semibold" : "text-gray-700 dark:text-gray-200"}`}>{r.receipt ?? "—"}</span></div>
                    <div>Vendor <span className={`font-mono ${r.issues.includes("vendor_mismatch") ? "text-red-500 font-semibold" : "text-gray-700 dark:text-gray-200"}`}>{r.vendor ?? "—"}</span></div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">{r.createdByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
