"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { removeOrphanedTimingLogs, inspectOrphanedTimingLogs, getSaveAttempts } from "@/lib/actions/catalogue"

type Inspect = Awaited<ReturnType<typeof inspectOrphanedTimingLogs>>

function fmtMs(ms: number | null) {
  if (!ms || ms <= 0) return "0s"
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

// Admin-only — inspect + clean up cataloguing timing logs whose lot no longer
// exists (the "deleted lot" phantom rows inflating the reports).
export default function CleanupOrphanLogsButton() {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [data, setData] = useState<Inspect | null>(null)
  const [attempts, setAttempts] = useState<any[] | null>(null)

  function inspect() {
    setResult(null); setAttempts(null)
    start(async () => {
      try { setData(await inspectOrphanedTimingLogs()) }
      catch (e: any) { setResult(e?.message ?? "Something went wrong") }
    })
  }

  function loadAttempts() {
    setResult(null); setData(null)
    start(async () => {
      try { setAttempts(await getSaveAttempts()) }
      catch (e: any) { setResult(e?.message ?? "Something went wrong") }
    })
  }

  function run() {
    if (!confirm("Remove cataloguing timing-logs whose lot no longer exists?\n\nThese are the “deleted lot” phantom rows inflating everyone's counts. Safe and idempotent.")) return
    setResult(null)
    start(async () => {
      try {
        const { count } = await removeOrphanedTimingLogs()
        setResult(count === 0 ? "✓ Nothing to clean up." : `✓ Removed ${count.toLocaleString()} phantom log${count === 1 ? "" : "s"}.`)
        setData(null)
        router.refresh()
      } catch (e: any) { setResult(e?.message ?? "Something went wrong") }
    })
  }

  const btn = "px-3 py-2 rounded-lg border text-sm font-semibold disabled:opacity-40 transition-colors"

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={inspect} disabled={busy} className={`${btn} border-gray-400 text-gray-600 dark:text-gray-300 hover:bg-gray-500/10`}>
          {busy ? "Working…" : "🔍 Inspect phantom logs"}
        </button>
        <button onClick={run} disabled={busy} className={`${btn} border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10`}>
          🧹 Remove phantom logs
        </button>
        <button onClick={loadAttempts} disabled={busy} className={`${btn} border-gray-400 text-gray-600 dark:text-gray-300 hover:bg-gray-500/10`}>
          🛰 Activation log
        </button>
        {result && <span className="text-sm text-gray-600 dark:text-gray-300">{result}</span>}
      </div>

      {attempts && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] p-4 text-sm overflow-x-auto">
          <p className="font-semibold text-gray-900 dark:text-white mb-2">Last {attempts.length} Save-button activation{attempts.length === 1 ? "" : "s"} <span className="font-normal text-gray-500">(newest first — resets on each deploy)</span></p>
          {attempts.length === 0 ? (
            <p className="text-gray-500">No activations recorded yet since the last deploy.</p>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 text-left">
                <th className="py-1 pr-3">When</th><th className="pr-3">User</th><th className="pr-3">Auction</th><th className="pr-3">Step</th><th className="pr-3">Trusted</th><th className="pr-3">detail</th><th className="pr-3">pointer</th><th className="pr-3">barcode</th><th className="pr-3">est</th><th>parcel</th>
              </tr></thead>
              <tbody className="font-mono text-gray-600 dark:text-gray-300">
                {attempts.map((a, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-3 whitespace-nowrap">{a.at ? new Date(a.at).toLocaleString("en-GB") : "—"}</td>
                    <td className="pr-3 whitespace-nowrap">{a.user ?? "—"}</td>
                    <td className="pr-3 whitespace-nowrap">{a.auctionId ?? "—"}</td>
                    <td className="pr-3">{a.step ?? "—"}</td>
                    <td className="pr-3">{String(a.isTrusted)}</td>
                    <td className="pr-3">{String(a.detail)}</td>
                    <td className="pr-3">{a.pointerType ?? "—"}</td>
                    <td className="pr-3">{a.hasBarcode ? "yes" : "no"}</td>
                    <td className="pr-3">{a.hasEstimate ? "yes" : "no"}</td>
                    <td>{a.hasParcel ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] p-4 text-sm overflow-x-auto">
          <p className="font-semibold text-gray-900 dark:text-white mb-2">{data.total.toLocaleString()} phantom (deleted-lot) timing logs across {data.byAuction.length} auction{data.byAuction.length === 1 ? "" : "s"}</p>
          {data.byAuction.length === 0 ? (
            <p className="text-gray-500">None — nothing to inspect.</p>
          ) : data.byAuction.map(g => (
            <div key={g.auctionId} className="mb-4 last:mb-0 border-t border-gray-200 dark:border-gray-800 pt-3">
              <p className="font-mono font-bold text-[#2AB4A6]">{g.auctionCode ?? "(no auction)"} <span className="font-sans font-normal text-gray-500">— {g.count.toLocaleString()} logs · {g.users.length} user{g.users.length === 1 ? "" : "s"} · {g.zeroKeyPoints} with 0 key-points</span></p>
              <p className="text-xs text-gray-500 mt-0.5">auctionId <span className="font-mono">{g.auctionId}</span> · users: {g.users.join(", ")}</p>
              <table className="w-full mt-2 text-xs">
                <thead><tr className="text-gray-500 text-left">
                  <th className="py-1 pr-3">Saved</th><th className="pr-3">User</th><th className="pr-3">Method</th><th className="pr-3">Duration</th><th className="pr-3">KeyPts</th><th className="pr-3">lotId</th><th>log id</th>
                </tr></thead>
                <tbody className="font-mono text-gray-600 dark:text-gray-300">
                  {g.samples.map(s => (
                    <tr key={s.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 whitespace-nowrap">{new Date(s.savedAt).toLocaleString("en-GB")}</td>
                      <td className="pr-3 whitespace-nowrap">{s.userName}</td>
                      <td className="pr-3">{s.method}</td>
                      <td className="pr-3">{fmtMs(s.durationMs)}</td>
                      <td className="pr-3">{fmtMs(s.keyPointsMs)}</td>
                      <td className="pr-3">{s.lotId ?? "—"}</td>
                      <td>{s.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
