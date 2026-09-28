"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

type Job = { id: string; cursor: number; total: number; sales: number; matched: number; added: number; done: boolean; error: string | null; note: string | null; running: boolean; scope: string | null }
type State = { site: Job | null; photos: Job | null }

// Admin-only panel: the two website jobs. Both run on the server and carry on after
// the tab closes; Stop pauses, the button again resumes from the same place.
//
// ⚠ LAYOUT: one row per job — title, buttons, a line of status, a bar. The explanation sits behind
// "What this does" (Jordan, 2026-09-09: "its become a mess UI wise"). Two paragraphs of prose that
// are read once and then in the way for ever pushed the search and the lots themselves off the
// screen. The status and the bar are NEVER hidden — a running job has to be visible without
// opening anything.
export default function ArchiveSite({ scope = "both" }: { scope?: "abc" | "bc" | "both" }) {
  // ⚠ The page you are on decides which database a run is for. Before this the photo copy did all
  // 948,000 ABC photos before it started a single BC one, so the BC Database sat at 0 photos with
  // no way to get at them. One walk of the website still covers both — they are the same sales —
  // but only the chosen database is written.
  const which = scope === "abc" ? "the ABC archive" : scope === "bc" ? "the BC database" : "both databases"
  const router = useRouter()
  const [st, setSt] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const r = await fetch("/api/databases/archive/site-pull"); if (r.ok) setSt(await r.json()) } catch {}
  }, [])
  useEffect(() => { load() }, [load])
  const running = !!(st?.site?.running || st?.photos?.running)
  useEffect(() => {
    if (!running) return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [running, load])
  useEffect(() => { if (st && !running) router.refresh() }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  const [probe, setProbe] = useState<any[] | null>(null)
  const [probing, setProbing] = useState(false)

  // ⚠ The website answers this server differently from a desk in the office — 202 with an empty
  // body where the office gets 774 lots. Guessing at that from an empty report wastes a day, so
  // this shows exactly what it said: status, content type, size and the first of the body.
  async function testSite() {
    setProbing(true); setProbe(null); setError(null)
    try {
      const r = await fetch("/api/databases/archive/site-pull", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: "site", action: "probe" }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j?.error ?? "Couldn't reach the website"); return }
      setProbe(j.probe ?? [])
    } finally { setProbing(false) }
  }

  async function act(job: "site" | "photos", action: "start" | "stop") {
    setError(null)
    const r = await fetch("/api/databases/archive/site-pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, action, scope }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setError(j?.error ?? "Couldn't do that"); return }
    await load()
  }

  const btn = "min-h-[44px] px-4 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  const primary = `${btn} bg-violet-600 hover:bg-violet-500 text-white font-semibold`
  const plain = `${btn} border border-gray-300 dark:border-gray-700 hover:border-violet-500`
  const site = st?.site ?? null, photos = st?.photos ?? null
  const head = "text-sm font-bold text-gray-900 dark:text-white"
  const why = "cursor-pointer text-xs text-gray-500 dark:text-gray-400 hover:text-violet-500"
  const state = (j: Job) => j.running ? "Running" : j.done ? "Finished" : j.error ? "Stopped" : "Paused"

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] divide-y divide-gray-200 dark:divide-gray-800">

      {/* ─── Walk the website ───────────────────────────────────────────────── */}
      <div className="p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={head}>🌐 Pull from the website</h2>
          <div className="flex gap-2">
            {site?.running
              ? <button onClick={() => act("site", "stop")} className={plain}>⏹ Stop</button>
              : <button onClick={() => act("site", "start")} disabled={!st} className={primary}>{site?.done ? "Check for new sales" : site ? "▶ Resume pull" : "Pull from the website"}</button>}
            <button onClick={testSite} disabled={probing} className={plain}>{probing ? "Testing…" : "Test the website"}</button>
          </div>
        </div>

        {site && (
          <div className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
            <div className="flex flex-wrap justify-between gap-2 mb-1">
              {/* ⚠ Clamped, not cut: a stopped run's reason can be three sentences long and it used
                  to set the height of the whole page. The full text is still there on hover. */}
              <span className="line-clamp-2 min-w-0" title={site.note ?? undefined}>{state(site)}{site.note ? ` — ${site.note}` : ""}</span>
              <span className="font-mono shrink-0">site sale {site.cursor.toLocaleString()}</span>
            </div>
            <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className={`h-full bg-violet-500 ${site.running ? "animate-pulse" : ""}`} style={{ width: site.done ? "100%" : "60%" }} /></div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Sales {site.sales.toLocaleString()} · lots matched {site.matched.toLocaleString()} · lots only on the website (not added) {site.added.toLocaleString()}</p>
            {site.error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">⚠ {site.error} — press Resume to carry on.</p>}
          </div>
        )}

        <details>
          <summary className={why}>What this does</summary>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Walks every finished sale on vectis.co.uk (Feb 2006 onwards). ABC lots already in the archive get the site&rsquo;s link, its own lot number and its photo — nothing is added or changed from the site, and its hammer is only shown beside ours where they differ. Business Central lots get the site&rsquo;s full description, link and photo (BC&rsquo;s own API has only the short description). One walk covers both databases because they are the same sales on the website; this button writes {which}. A full first run takes a few hours and carries on by itself.</p>
        </details>

        {probe && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#0d0f1a] p-3 text-xs space-y-2">
            <p className="font-semibold text-gray-900 dark:text-white">What the website said to this server</p>
            {probe.map((r: any) => (
              <div key={r.siteId} className="font-mono text-gray-700 dark:text-gray-300 break-all">
                sale {r.siteId} → {r.status} · {r.contentType} · {r.bytes} bytes · {r.lots == null ? "no lot list" : `${r.lots} lots`}
                <div className="text-gray-500">{r.snippet}</div>
              </div>
            ))}
            <p className="text-gray-600 dark:text-gray-400">
              {probe.some((r: any) => (r.lots ?? 0) > 0)
                ? "The website is answering properly, so the pull should work — press Pull from the website."
                : "The website is not serving its lot feed to this server. It answers a browser here in the office, so this is a block at the website's end rather than something the Hub can fix — whoever runs the site needs to let the server through."}
            </p>
          </div>
        )}
      </div>

      {/* ─── Copy the photos ────────────────────────────────────────────────── */}
      <div className="p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={head}>🖼 Copy the photos into the Hub</h3>
          {photos?.running
            ? <button onClick={() => act("photos", "stop")} className={plain}>⏹ Stop</button>
            : <button onClick={() => act("photos", "start")} disabled={!st} className={primary}>{photos && !photos.done && photos.scope === scope ? "▶ Resume copying" : scope === "bc" ? "Copy BC photos" : scope === "abc" ? "Copy ABC photos" : "Copy photos"}</button>}
        </div>

        {photos && (
          <div className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
            <div className="flex flex-wrap justify-between gap-2 mb-1">
              <span className="line-clamp-2 min-w-0" title={photos.note ?? undefined}>
                {state(photos)}{photos.note ? ` — ${photos.note}` : ""}
                {photos.scope && photos.scope !== scope && (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">
                    (this run is for {photos.scope === "abc" ? "the ABC archive" : photos.scope === "bc" ? "the BC database" : "both"} — starting it here switches it to {which})
                  </span>
                )}
              </span>
              {/* The photos job keeps "no file on the website" in `matched` — copied + missing is how far it has got. */}
              <span className="font-mono shrink-0">
                {photos.added.toLocaleString()} copied{photos.matched ? <span className="text-amber-600 dark:text-amber-400"> · {photos.matched.toLocaleString()} no file on the site</span> : null} · of {photos.total.toLocaleString()}
              </span>
            </div>
            <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500 transition-all" style={{ width: `${photos.total ? Math.min(100, Math.round(((photos.added + (photos.matched || 0)) / photos.total) * 100)) : photos.done ? 100 : 0}%` }} /></div>
            {photos.error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">⚠ {photos.error} — press Resume to carry on.</p>}
          </div>
        )}

        <details>
          <summary className={why}>What this does</summary>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Each lot&rsquo;s photo — ABC and BC databases alike — is copied from the site into our own storage twice: the full-size version the site holds (about 250 KB) as the backup, and a small copy for showing on the page. About 260 GB for the ABC archive plus 55 GB for BC; pictures stay ours whatever happens to the website. This button copies {which}.</p>
        </details>
      </div>

      {error && <p className="p-4 text-sm text-red-700 dark:text-red-300">⚠ {error}</p>}
    </div>
  )
}
