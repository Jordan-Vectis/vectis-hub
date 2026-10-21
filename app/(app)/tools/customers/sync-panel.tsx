"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CUSTOMER_PHASES, PHASE_LABEL, type CustomerPhase } from "@/lib/customer-sync-phases"

// "Copy from Business Central" — the same page-at-a-time copy the nightly job runs, driven from here
// so the numbers move (RULES design rule 7b). Admins only (the route checks too).
//
// ⚠ 2026-10-21: a copy ran for four hours re-reading what it already had, then a Stop sent it back to
// the start. So: "Copy changes" asks BC only for what changed since each stage's last full pass; the
// server remembers where every stage got to, so a stopped copy CARRIES ON; and Stop asks first.

type Mode = "changes" | "all"
type Tally = { rows: number; created: number; updated: number; merged: number; unmatched: number; failed: number }
const ZERO: Tally = { rows: 0, created: 0, updated: 0, merged: 0, unmatched: 0, failed: 0 }
type StageState = { phase: CustomerPhase; since: string | null; nextLink: string | null; done: number; total: number | null; passMode: Mode | null }
type Progress = { done: number; total: number | null; onlyChanges: boolean }

const n = (x: number) => x.toLocaleString()

export default function SyncPanel({ lastRun }: { lastRun: string | null }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<CustomerPhase | null>(null)
  const [tally, setTally] = useState<Record<string, Tally>>({})
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [firstError, setFirstError] = useState<string | null>(null)
  const [stages, setStages] = useState<StageState[] | null>(null)
  const [askStop, setAskStop] = useState(false)
  const [probe, setProbe] = useState<any>(null)
  const [probing, setProbing] = useState(false)
  const busy = useRef(false)
  const stop = useRef(false)

  // A heartbeat while it runs: the counts move once a batch, so this says how long since the last one.
  const [batches, setBatches] = useState(0)
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  const loadStages = useCallback(async () => {
    try {
      const r = await fetch("/api/customers/sync?state=1")
      if (r.ok) setStages((await r.json()).phases)
    } catch { /* the buttons still work; only Carry on needs this */ }
  }, [])
  useEffect(() => { loadStages() }, [loadStages])

  // The first stage a copy stopped part-way through — where Carry on starts.
  const unfinished = stages?.find(s => s.nextLink) ?? null

  async function run(start: { phase: CustomerPhase; nextLink: string | null; mode: Mode }) {
    if (busy.current) return
    busy.current = true
    stop.current = false
    setRunning(true); setResult(null); setFirstError(null); setNotes([]); setAskStop(false)
    setTally({}); setProgress({}); setBatches(0); setLastAt(Date.now())
    let p: CustomerPhase | null = start.phase
    let next: string | null = start.nextLink
    const t: Record<string, Tally> = {}
    try {
      while (p) {
        if (stop.current) {
          setResult({ ok: false, text: "Stopped. Everything copied so far is kept, and it remembers where it got to — press Carry on to continue from there." })
          return
        }
        setPhase(p)
        const res: Response = await fetch("/api/customers/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase: p, nextLink: next, mode: start.mode }) })
        const d: any = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
        const cur = t[p] ?? { ...ZERO }
        for (const k of Object.keys(ZERO) as (keyof Tally)[]) cur[k] += d[k] ?? 0
        t[p] = cur
        setTally({ ...t })
        setProgress(pr => ({ ...pr, [p as string]: { done: d.stageDone ?? cur.rows, total: d.stageTotal ?? pr[p as string]?.total ?? null, onlyChanges: d.onlyChanges ?? pr[p as string]?.onlyChanges ?? false } }))
        if (d.note) setNotes(x => [...x, `${PHASE_LABEL[p as CustomerPhase]}: ${d.note}`])
        if (d.firstError) setFirstError(f => f ?? d.firstError)
        setBatches(b => b + 1)
        setLastAt(Date.now())
        p = d.nextPhase ?? null
        next = d.nextLink ?? null
      }
      const failed = Object.values(t).reduce((s, x) => s + x.failed, 0)
      const parts = CUSTOMER_PHASES.filter(k => t[k]).map(k => `${n(t[k].rows)} ${PHASE_LABEL[k].toLowerCase()}`)
      setResult({ ok: failed === 0, text: `Finished. Read ${parts.join(", ") || "nothing new"}.${failed ? ` ${failed} rows couldn't be saved — the first is shown below.` : ""}` })
      router.refresh()
    } catch (e: any) {
      setResult({ ok: false, text: `Stopped with an error: ${e?.message ?? e}. Everything copied before it is kept — press Carry on to continue from there.` })
    } finally {
      busy.current = false
      setRunning(false); setPhase(null); setAskStop(false)
      loadStages()
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

  const btn = "min-h-[44px] px-4 rounded-lg text-sm font-semibold"
  const quiet = `${btn} border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50`

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px]">
          <p className="font-semibold text-gray-900 dark:text-white">Copy from Business Central</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Runs by itself every night at 5am — only what changed, and everything on Sundays. {lastRun ? `Last finished copy: ${lastRun}.` : "No copy has finished yet."} BC is still in charge, so anything copied is replaced by BC&apos;s version next time.
          </p>
        </div>

        {running ? (
          askStop ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-700 dark:text-gray-200">Stop the copy? It remembers where it got to.</span>
              <button onClick={() => { stop.current = true; setAskStop(false) }} className={`${btn} bg-red-600 hover:bg-red-500 text-white`}>Yes, stop</button>
              <button onClick={() => setAskStop(false)} className={quiet}>Keep going</button>
            </div>
          ) : (
            <button onClick={() => setAskStop(true)} className={`${btn} border border-red-400 text-red-600 dark:text-red-400`}>Stop…</button>
          )
        ) : (
          <>
            {unfinished && (
              <button onClick={() => run({ phase: unfinished.phase, nextLink: unfinished.nextLink, mode: unfinished.passMode ?? "changes" })}
                className={`${btn} bg-green-600 hover:bg-green-500 text-white`}
                title="Carries on the copy that was stopped, from the batch it had reached">
                Carry on — {PHASE_LABEL[unfinished.phase]}{unfinished.total ? `, ${n(unfinished.done)} of ${n(unfinished.total)}` : ""}
              </button>
            )}
            <button onClick={() => run({ phase: "contacts", nextLink: null, mode: "changes" })}
              className={unfinished ? quiet : `${btn} bg-indigo-600 hover:bg-indigo-500 text-white`}
              title="Asks BC only for what changed since each stage was last copied — usually minutes">
              Copy changes
            </button>
            <button onClick={() => run({ phase: "contacts", nextLink: null, mode: "all" })} className={quiet}
              title="Reads every record from BC again — takes hours; the nightly copy does this on Sundays">
              Copy everything (hours)
            </button>
          </>
        )}
        <button onClick={runProbe} disabled={probing} className={quiet}>
          {probing ? "Asking BC…" : "What does BC publish?"}
        </button>
      </div>

      {(running || Object.keys(tally).length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-2">
          {CUSTOMER_PHASES.map(p => {
            const x = tally[p]
            const pr = progress[p]
            const on = phase === p
            return (
              <div key={p} className={`rounded-lg border p-2 text-xs ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-gray-200 dark:border-gray-700"}`}>
                <p className="font-semibold text-gray-800 dark:text-gray-100">{on ? "▶ " : x ? "✓ " : ""}{PHASE_LABEL[p]}</p>
                {x && pr ? (
                  <>
                    <p className="text-gray-800 dark:text-gray-100 mt-0.5">
                      {pr.total != null ? `${n(pr.done)} of ${n(pr.total)}` : `${n(pr.done)} so far`}{pr.onlyChanges ? " changed" : ""}
                    </p>
                    <p className="text-gray-500 dark:text-gray-400">
                      {n(x.created)} new · {n(x.updated)} updated
                      {x.merged ? ` · ${x.merged} merged` : ""}{x.unmatched ? ` · ${n(x.unmatched)} with no match` : ""}
                      {x.failed ? <span className="text-red-600 dark:text-red-400"> · {x.failed} failed</span> : null}
                    </p>
                  </>
                ) : <p className="text-gray-400 mt-0.5">{on ? "asking BC…" : "waiting"}</p>}
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
            {n(batches)} batches done · last batch {secs}s ago
            {secs > 90 ? " — this one is taking unusually long. If it doesn't move, Stop and press Carry on." : ""}
            {" "}The figures further down this page update when the copy finishes.
          </p>
        )
      })()}

      {result && <p className={`text-sm ${result.ok ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>{result.text}</p>}
      {notes.map(t => <p key={t} className="text-xs text-amber-700 dark:text-amber-400">{t}</p>)}
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
