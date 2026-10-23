"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { copyBcPage, stopBcCopy } from "@/lib/actions/goods-in-mirror"
import type { MirrorStatus } from "@/lib/goods-in/bc-mirror"
import { box, btn, btnDanger, btnGo, ErrorBox, mono, OkBox, ukDateTime } from "../_components/ui"

// Goods In → Settings → Business Central's receipts & totes. What the copy holds, when it last ran,
// and two buttons: Copy changes (what BC's copy has touched since the last complete run) and Copy
// everything. The browser drives the loop a page at a time, so the count moves and Stop works —
// never one long request (design rule 7b). The same copy runs by itself in the nightly BC sync.

type Status = Omit<MirrorStatus, "lastComplete" | "lastRun"> & {
  lastComplete: { startedAt: string; completedAt: string | null; totes: number } | null
  lastRun: { startedAt: string; status: string; error: string | null; totes: number } | null
}

type Progress = { full: boolean; runId: string | null; total: number | null; totes: number; receipts: number; skipped: number; clashes: string[]; pages: number }

export default function BcMirrorPanel({ status, hubOwns }: { status: Status; hubOwns: boolean }) {
  const router = useRouter()
  const [running, setRunning] = useState<Progress | null>(null)
  const [done, setDone] = useState<Progress | null>(null)
  const [stopped, setStopped] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stopRef = useRef(false)

  async function run(full: boolean) {
    stopRef.current = false
    setError(null); setDone(null); setStopped(false)
    const p: Progress = { full, runId: null, total: null, totes: 0, receipts: 0, skipped: 0, clashes: [], pages: 0 }
    setRunning({ ...p })
    let cursor: string | null = null
    let more = true
    let failures = 0
    while (more) {
      if (stopRef.current) {
        if (p.runId) await stopBcCopy(p.runId)
        setStopped(true)
        break
      }
      const res = await copyBcPage({ cursor, full, runId: p.runId })
      if (!res.ok) {
        // One blip is retried; the same failure three times stops the run with what was copied kept.
        if (++failures >= 3) { setError(res.error); if (p.runId) await stopBcCopy(p.runId); break }
        await new Promise(r => setTimeout(r, 1500))
        continue
      }
      failures = 0
      p.runId = res.runId
      if (res.total != null) p.total = res.total
      p.totes += res.totes; p.receipts += res.receipts; p.skipped += res.skippedNoReceipt; p.pages++
      for (const c of res.hubClashes) if (!p.clashes.includes(c)) p.clashes.push(c)
      cursor = res.cursor
      more = res.more
      setRunning({ ...p })
    }
    setRunning(null)
    setDone({ ...p })
    router.refresh()
  }

  const last = status.lastComplete
  const lastRun = status.lastRun
  const totesWord = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "tote or pallet" : "totes and pallets"}`

  return (
    <section className={`${box} p-4 sm:p-6 space-y-4`} aria-labelledby="bc-mirror-heading">
      <div>
        <h2 id="bc-mirror-heading" className="text-lg font-bold text-gray-900 dark:text-white">Business Central&apos;s receipts &amp; totes</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 max-w-3xl">
          BC&apos;s receipts and totes are copied into Goods In&apos;s own database every night (with the BC Warehouse Data Sync), so Receipts, Find and the customer pages show BC&apos;s and the Hub&apos;s together.
          {hubOwns
            ? " The Hub owns warehouse records now (WAREHOUSE_OWNER=hub): copied rows can be changed here."
            : " Until the Hub takes over, rows from BC are read-only here — changes are made in BC and follow at the next copy."}
        </p>
      </div>

      {!status.ready ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">The copy needs an admin to press Run Migrations first.</p>
      ) : (
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div className={`${box} p-3`}><dt className="text-xs text-gray-500 dark:text-gray-400">Receipts from BC</dt><dd className={`${mono} text-2xl font-bold text-gray-900 dark:text-white`}>{status.bcReceipts.toLocaleString("en-GB")}</dd></div>
          <div className={`${box} p-3`}><dt className="text-xs text-gray-500 dark:text-gray-400">Totes &amp; pallets from BC</dt><dd className={`${mono} text-2xl font-bold text-gray-900 dark:text-white`}>{status.bcTotes.toLocaleString("en-GB")}</dd></div>
          <div className={`${box} p-3 col-span-2`}>
            <dt className="text-xs text-gray-500 dark:text-gray-400">Last complete copy</dt>
            <dd className="text-gray-900 dark:text-white">{last ? <>{ukDateTime(new Date(last.completedAt ?? last.startedAt))} · {totesWord(last.totes)} looked at</> : "Never — press Copy everything to start."}</dd>
            {lastRun && lastRun.status !== "complete" && (
              <dd className={`mt-1 text-xs ${lastRun.status === "running" ? "text-gray-500 dark:text-gray-400" : "text-amber-800 dark:text-amber-200"}`}>
                Latest run ({ukDateTime(new Date(lastRun.startedAt))}): {lastRun.status === "running" ? "still going (or didn't record its end)" : lastRun.error ?? "failed"}
              </dd>
            )}
          </div>
        </dl>
      )}

      {running ? (
        <div className="rounded-lg border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 p-4 space-y-2" role="status" aria-live="polite">
          <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
            {running.full ? "Copying everything" : "Copying changes"} — {totesWord(running.totes)} on {running.receipts.toLocaleString("en-GB")} receipts so far
            {running.total != null && <> · {Math.min(running.pages * 1000, running.total).toLocaleString("en-GB")} of {running.total.toLocaleString("en-GB")} looked at</>}
          </p>
          {running.total != null && running.total > 0 && (
            <div className="h-2 rounded bg-indigo-200 dark:bg-indigo-900 overflow-hidden"><div className="h-full bg-indigo-600" style={{ width: `${Math.min(100, Math.round((Math.min(running.pages * 1000, running.total) / running.total) * 100))}%` }} /></div>
          )}
          <button type="button" className={btnDanger} onClick={() => { stopRef.current = true }}>Stop</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnGo} disabled={!status.ready} onClick={() => void run(false)}>Copy changes now</button>
          <button type="button" className={btn} disabled={!status.ready} onClick={() => void run(true)}>Copy everything</button>
        </div>
      )}

      {done && (
        <OkBox>
          {stopped ? "Stopped. " : "Done. "}
          {totesWord(done.totes)} on {done.receipts.toLocaleString("en-GB")} receipts copied
          {done.skipped > 0 && <> · {done.skipped.toLocaleString("en-GB")} totes skipped — on no receipt in BC</>}
          {done.clashes.length > 0 && <> · <b>{done.clashes.length} BC numbers already used by Hub rows, left alone:</b> <span className={mono}>{done.clashes.slice(0, 12).join(", ")}{done.clashes.length > 12 ? "…" : ""}</span> — a number series may be set too low</>}
          .
        </OkBox>
      )}
      {error && <ErrorBox onDismiss={() => setError(null)}>The copy stopped: {error}. What was copied so far is kept — try again in a moment.</ErrorBox>}

      <p className="text-xs text-gray-500 dark:text-gray-400 max-w-3xl">
        Reads the Hub&apos;s own BC copy (the BC Warehouse Data Sync&apos;s totes and receipt lines) — nothing is read from or written to BC itself. A row booked in the Hub is never written over. Nothing is deleted: a tote that disappears from BC keeps its row. Totes with no receipt in BC aren&apos;t copied.
      </p>
    </section>
  )
}
