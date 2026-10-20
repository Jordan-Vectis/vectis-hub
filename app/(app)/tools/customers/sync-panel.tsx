"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CUSTOMER_PHASES, PHASE_LABEL, type CustomerPhase } from "@/lib/customer-sync-phases"

// "Copy customers from BC" — the same page-at-a-time copy the nightly job runs, driven from here so
// the numbers move (RULES design rule 7b), with a Stop. Admins only (the route checks too).

type Tally = { rows: number; created: number; updated: number; merged: number; unmatched: number; failed: number }
const ZERO: Tally = { rows: 0, created: 0, updated: 0, merged: 0, unmatched: 0, failed: 0 }

export default function SyncPanel({ lastRun }: { lastRun: string | null }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<CustomerPhase | null>(null)
  const [tally, setTally] = useState<Record<string, Tally>>({})
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [firstError, setFirstError] = useState<string | null>(null)
  const [probe, setProbe] = useState<any>(null)
  const [probing, setProbing] = useState(false)
  const busy = useRef(false)
  // A heartbeat while it runs: one batch of up to 500 takes ~15 s, so the counts alone sit still long
  // enough to look frozen. This says how many batches are done and how long since the last one.
  const [batches, setBatches] = useState(0)
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  const stop = useRef(false)

  async function run() {
    if (busy.current) return
    busy.current = true
    stop.current = false
    setRunning(true); setResult(null); setFirstError(null); setTally({}); setBatches(0); setLastAt(Date.now())
    let p: CustomerPhase | null = "contacts"
    let next: string | null = null
    const t: Record<string, Tally> = {}
    try {
      while (p) {
        if (stop.current) { setResult({ ok: false, text: "Stopped. Everything copied up to this point is kept; press Copy again to run it from the start." }); return }
        setPhase(p)
        const res: Response = await fetch("/api/customers/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase: p, nextLink: next }) })
        const d: any = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
        const cur = t[p] ?? { ...ZERO }
        for (const k of Object.keys(ZERO) as (keyof Tally)[]) cur[k] += d[k] ?? 0
        t[p] = cur
        setTally({ ...t })
        setBatches(b => b + 1)
        setLastAt(Date.now())
        if (d.firstError) setFirstError(f => f ?? d.firstError)
        p = d.nextPhase ?? null
        next = d.nextLink ?? null
      }
      const people = t.contacts?.rows ?? 0
      const failed = Object.values(t).reduce((n, x) => n + x.failed, 0)
      setResult({ ok: failed === 0, text: `Finished: read ${people.toLocaleString()} people, ${(t.vendors?.rows ?? 0).toLocaleString()} sellers, ${(t.customers?.rows ?? 0).toLocaleString()} buyers, ${(t.webCustomers?.rows ?? 0).toLocaleString()} website accounts, ${(t.shipToAddresses?.rows ?? 0).toLocaleString()} delivery addresses, ${(t.contactCards?.updated ?? 0).toLocaleString()} ID-check cards and ${(t.vendorCards?.updated ?? 0).toLocaleString()} seller-terms cards.${failed ? ` ${failed} rows could not be saved — the first is shown below.` : ""}` })
      router.refresh()
    } catch (e: any) {
      setResult({ ok: false, text: `Stopped with an error: ${e?.message ?? e}. What was copied before it is kept.` })
    } finally {
      busy.current = false
      setRunning(false); setPhase(null)
    }
  }

  async function runProbe() {
    setProbing(true); setProbe(null)
    try {
      const r = await fetch("/api/customers/sync?probe=1")
      const d = await r.json()
      setProbe(r.ok ? d : { error: d.error ?? `HTTP ${r.status}` })
    } catch (e: any) { setProbe({ error: e?.message ?? "failed" }) }
    finally { setProbing(false) }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <p className="font-semibold text-gray-900 dark:text-white">Copy from Business Central</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Runs by itself every night at 5am. {lastRun ? `Last finished copy: ${lastRun}.` : "No copy has finished yet."} BC is still in charge, so anything copied is replaced by BC&apos;s version next time.
          </p>
        </div>
        {running
          ? <button onClick={() => { stop.current = true }} className="min-h-[44px] px-4 rounded-lg border border-red-400 text-red-600 dark:text-red-400 text-sm font-semibold">Stop</button>
          : <button onClick={run} className="min-h-[44px] px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">Copy customers now</button>}
        <button onClick={runProbe} disabled={probing} className="min-h-[44px] px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50">
          {probing ? "Asking BC…" : "What does BC publish?"}
        </button>
      </div>

      {(running || Object.keys(tally).length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-2">
          {CUSTOMER_PHASES.map(p => {
            const x = tally[p]
            const on = phase === p
            return (
              <div key={p} className={`rounded-lg border p-2 text-xs ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-gray-200 dark:border-gray-700"}`}>
                <p className="font-semibold text-gray-800 dark:text-gray-100">{on ? "▶ " : x ? "✓ " : ""}{PHASE_LABEL[p]}</p>
                {x ? (
                  <p className="text-gray-600 dark:text-gray-300 mt-0.5">
                    {x.rows.toLocaleString()} read · {x.created.toLocaleString()} new · {x.updated.toLocaleString()} updated
                    {x.merged ? ` · ${x.merged} merged` : ""}{x.unmatched ? ` · ${x.unmatched.toLocaleString()} with no match` : ""}
                    {x.failed ? <span className="text-red-600 dark:text-red-400"> · {x.failed} failed</span> : null}
                  </p>
                ) : <p className="text-gray-400 mt-0.5">{on ? "reading…" : "waiting"}</p>}
              </div>
            )
          })}
        </div>
      )}

      {running && lastAt && (() => {
        const secs = Math.max(0, Math.round((now - lastAt) / 1000))
        return (
          <p className={`text-xs ${secs > 90 ? "text-amber-600 dark:text-amber-400" : "text-gray-600 dark:text-gray-300"}`}>
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse mr-1.5 align-middle" />
            {batches.toLocaleString()} batches done · last batch {secs}s ago (each batch of up to 500 takes about 15 seconds)
            {secs > 90 ? " — this one is taking unusually long; it may have stalled. Stop and run it again if it doesn't move." : ""}
            {" "}The figures further down this page update when the copy finishes.
          </p>
        )
      })()}

      {result && <p className={`text-sm ${result.ok ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>{result.text}</p>}
      {firstError && <p className="text-xs text-red-600 dark:text-red-400">First failed row: {firstError}</p>}

      {probe && (
        <div className="text-xs space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
          {probe.error ? <p className="text-red-600 dark:text-red-400">{probe.error}</p> : (
            <>
              <p className="font-semibold text-gray-800 dark:text-gray-100">Evo feeds (what the copy reads)</p>
              {Object.entries(probe.feeds ?? {}).map(([k, v]: any) => (
                <p key={k} className="text-gray-600 dark:text-gray-300"><strong>{k}</strong>: {v.ok ? v.fields.join(", ") || "(no rows)" : <span className="text-red-600 dark:text-red-400">{v.error}</span>}</p>
              ))}
              <p className="font-semibold text-gray-800 dark:text-gray-100 pt-1">Other published BC pages about customers</p>
              {probe.servicesError && <p className="text-red-600 dark:text-red-400">Couldn&apos;t list them: {probe.servicesError}</p>}
              {probe.services?.length === 0 && !probe.servicesError && <p className="text-gray-500">None found.</p>}
              {probe.services?.map((s: any) => (
                <p key={s.name} className="text-gray-600 dark:text-gray-300"><strong>{s.name}</strong>: {s.fields ? s.fields.join(", ") || "(no rows)" : <span className="text-red-600 dark:text-red-400">{s.error}</span>}</p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
