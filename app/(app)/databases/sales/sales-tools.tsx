"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

type Job = { id: string; total: number; added: number; done: boolean; error: string | null; note: string | null; running: boolean }

// The admin tools on the Sales page, as chips (the same shape as the BC Database page's): nothing
// on screen until asked for, one panel at a time, and a running job opens itself.
//
// Where the pictures come from: the office collector records each sale's cover picture alongside
// its lots (the website won't answer the Hub's server), and "Copy sale pictures" then brings each
// one into R2 from the website's own storage on Amazon S3 — which the server CAN reach.
export default function SalesTools({ toCopy, withHero }: { toCopy: number; withHero: number }) {
  const router = useRouter()
  const [open, setOpen] = useState<"pictures" | "export" | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/databases/archive/site-pull")
      if (!r.ok) return
      const j = await r.json()
      setJob(j?.heroes ?? null)
      if (j?.heroes?.running) setOpen(o => o ?? "pictures")
    } catch { /* next poll */ }
  }, [])
  useEffect(() => { void load() }, [load])
  const running = !!job?.running
  useEffect(() => {
    if (!running) return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [running, load])
  useEffect(() => { if (job && !running) router.refresh() }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: "start" | "stop") {
    setError(null)
    const r = await fetch("/api/databases/archive/site-pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: "heroes", action }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setError(j?.error ?? "Couldn't do that"); return }
    await load()
  }

  const chip = (key: "pictures" | "export", label: string) => (
    <button type="button" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}
      className={`min-h-[40px] px-3 rounded-lg border text-sm transition-colors ${open === key
        ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-semibold"
        : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-violet-500"}`}>
      {label}
      {key === "pictures" && running && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-violet-500 animate-pulse align-middle" title="Copying" />}
    </button>
  )
  const btn = "min-h-[44px] px-4 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  const code = "font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded"

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mr-1">Tools</span>
        {chip("pictures", "📸 Sale pictures")}
        {chip("export", "⬇ Export")}
      </div>

      {open === "pictures" && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-4 space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">📸 Copy sale pictures into the Hub</h3>
            {running
              ? <button onClick={() => act("stop")} className={`${btn} border border-gray-300 dark:border-gray-700 hover:border-violet-500`}>⏹ Stop</button>
              : <button onClick={() => act("start")} disabled={toCopy === 0} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white font-semibold`}>{toCopy === 0 ? "Nothing to copy" : `Copy ${toCopy.toLocaleString()} picture${toCopy === 1 ? "" : "s"}`}</button>}
          </div>
          {job && (
            <div aria-live="polite">
              <div className="flex flex-wrap justify-between gap-2 mb-1">
                <span className="line-clamp-2 min-w-0" title={job.note ?? undefined}>{job.running ? "Running" : job.done ? "Finished" : job.error ? "Stopped" : "Paused"}{job.note ? ` — ${job.note}` : ""}</span>
                <span className="font-mono shrink-0">{job.added.toLocaleString()} of {job.total.toLocaleString()} copied</span>
              </div>
              <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className={`h-full bg-violet-500 ${job.running ? "animate-pulse" : ""}`} style={{ width: `${job.total ? Math.min(100, Math.round((job.added / job.total) * 100)) : 0}%` }} /></div>
              {job.error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">⚠ {job.error} — press the button to carry on.</p>}
            </div>
          )}
          {error && <p className="text-xs text-red-700 dark:text-red-300">⚠ {error}</p>}
          <p className="text-gray-600 dark:text-gray-400">
            {withHero.toLocaleString()} sales have a picture recorded. Pictures arrive with the lot collection on the BC Database page — the collector now notes each sale&apos;s title, date and cover picture as it goes. For the older ABC sales, run the collector once over sales 1 to 1061: it skips their lots but keeps their pictures. This copy is kept at <code className={code}>sale-photos/&#123;website sale number&#125;.webp</code> in R2.
          </p>
        </div>
      )}

      {open === "export" && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-4 space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <div className="flex flex-wrap items-center gap-3">
            <a href="/api/databases/sales/export" className="min-h-[44px] inline-flex items-center px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">⬇ Export sales (CSV)</a>
            <span className="text-gray-600 dark:text-gray-400">One row per sale: website sale number, ABC auction id, BC code, title, date, lots, the picture&apos;s file name in R2 and its address on the website.</span>
          </div>
          <p className="text-gray-600 dark:text-gray-400">Handover works as on the other two pages: the CSV plus a read-only R2 token, and the pictures copied bucket-to-bucket from <code className={code}>sale-photos/</code>.</p>
        </div>
      )}
    </div>
  )
}
