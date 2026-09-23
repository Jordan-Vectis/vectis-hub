"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

type Missing = { id: number; file: string }   // "<article id>.<ext>" — the name the collector gave the picture

// The admin tools on the News page, as a chip (the same shape as the Sales page's): nothing on
// screen until asked for. One panel, three steps: run the collector on an office machine (the
// website refuses the Hub's server), load the file it saved, then choose its pictures folder — each
// picture goes straight from the browser into R2 on a presigned PUT and is registered against its
// article, with a count that moves and a Stop.
export default function NewsTools({ missing, held }: { missing: Missing[]; held: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // step 2 — the JSON parts (vectis-news-1.json, -2.json, …; an older run's single vectis-news.json loads too)
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingAt, setLoadingAt] = useState(0)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  // step 3 — the pictures folder
  const [folder, setFolder] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState<string[]>([])
  const [finished, setFinished] = useState<string | null>(null)
  const stopRef = useRef(false)
  const busyRef = useRef(false)   // re-entry guard — a ref, not state, so a double press can't start two loops

  const claudeText = [
    "Please collect the News & Stories articles from vectis.co.uk for the Vectis Hub — text and cover pictures. I will load them myself afterwards.",
    "",
    "Background: the Hub's Railway server cannot read the website (it answers 202 with an empty body), but a machine on the Vectis office network can. The site's news is a Joomla blog with a JSON feed that includes each article's full text; each cover picture is a plain file on the site.",
    "",
    "From C:\\Dev apps\\vectis-hub, run it in the background and leave it going:",
    "",
    "    node scripts/collect-news.mjs \"<my Downloads folder>/vectis-news\"",
    "",
    "It writes vectis-news.json, a pictures folder with one file per article, and a log beside them. About 14 feed requests for the articles and then a picture every fifth of a second — six or seven minutes for everything. It is safe to run again; pictures already in the folder are kept.",
    "",
    "When it finishes, tell me how many articles it saved, how many pictures it downloaded, and whether any picture would not download — it names those at the end. Do not try to load anything into the database yourself.",
  ].join(String.fromCharCode(10))

  async function copyClaude() {
    try { await navigator.clipboard.writeText(claudeText); setCopied(true); setTimeout(() => setCopied(false), 4000) }
    catch { setError("This browser would not let the page copy for you.") }
  }

  async function load() {
    if (!files.length || loading) return
    setLoading(true); setError(null); setLoaded(null); setProblems([]); setLoadingAt(0)
    let written = 0, withBodyNote = "", last: any = null
    const found: string[] = []
    try {
      // One request per part — each stays well under the 20 MB request limit.
      for (let i = 0; i < files.length; i++) {
        setLoadingAt(i + 1)
        const fd = new FormData()
        fd.append("file", files[i])
        const res = await fetch("/api/databases/news/collect", { method: "POST", body: fd })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j?.error ?? `${files[i].name} could not be loaded (${res.status})`)
        written += j.written ?? 0
        last = j
        if (Array.isArray(j.problems)) found.push(...j.problems)
      }
      setProblems(found)
      withBodyNote = last?.message ?? ""
      setLoaded(files.length === 1
        ? withBodyNote || "Loaded."
        : `Loaded ${written.toLocaleString()} article${written === 1 ? "" : "s"} from ${files.length} files; the Hub now holds ${Number(last?.held ?? 0).toLocaleString()}. ${last?.toUpload ? `${Number(last.toUpload).toLocaleString()} picture${last.toUpload === 1 ? "" : "s"} still to upload — choose the collector's pictures below.` : "Every picture is already in the Hub."}`)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? "Could not load the files")
    } finally {
      setLoading(false)
    }
  }

  // Which files in the chosen folder are pictures the Hub still needs — matched on the file name
  // the collector gave them: "<article id>.<ext>" for the cover, "<article id>-<n>.<ext>" for the
  // pictures inside the article.
  const wanted = new Map(missing.map(m => [m.file.toLowerCase(), m.id]))
  const byName = new Map<string, File>()
  for (const f of folder) {
    const name = (f.name || "").toLowerCase()
    if (/^\d+(-\d+)?\.(jpe?g|png|webp|gif)$/.test(name)) byName.set(name, f)
  }
  const toUpload = missing.filter(m => byName.has(m.file.toLowerCase()))
  const spare = [...byName.keys()].filter(n => !wanted.has(n)).length

  const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }

  async function upload() {
    if (busyRef.current || toUpload.length === 0) return
    busyRef.current = true
    stopRef.current = false
    setUploading(true); setError(null); setDone(0); setFailed([]); setFinished(null)
    let ok = 0
    const bad: string[] = []
    try {
      for (const m of toUpload) {
        if (stopRef.current) break
        const f = byName.get(m.file.toLowerCase())!
        const ext = m.file.split(".").pop()!.toLowerCase()
        const contentType = f.type || TYPES[ext] || "image/jpeg"
        try {
          const r1 = await fetch("/api/databases/news/picture-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: m.id, file: m.file, contentType, size: f.size }) })
          const j1 = await r1.json().catch(() => ({}))
          if (!r1.ok) throw new Error(j1?.error ?? `could not get an upload address (${r1.status})`)
          const put = await fetch(j1.url, { method: "PUT", headers: { "Content-Type": j1.contentType ?? contentType }, body: f })
          if (!put.ok) throw new Error(`storage refused the file (${put.status})`)
          const r2 = await fetch("/api/databases/news/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: m.id, key: j1.key }) })
          const j2 = await r2.json().catch(() => ({}))
          if (!r2.ok) throw new Error(j2?.error ?? `could not register it (${r2.status})`)
          ok++
          setDone(ok)
        } catch (e: any) {
          bad.push(`${m.file}: ${e?.message ?? "failed"}`)
          setFailed([...bad])
        }
      }
      setFinished(stopRef.current
        ? `Stopped — ${ok.toLocaleString()} picture${ok === 1 ? "" : "s"} uploaded and kept${bad.length ? `, ${bad.length} failed` : ""}. Press Upload again to carry on with the rest.`
        : `${ok.toLocaleString()} picture${ok === 1 ? "" : "s"} uploaded${bad.length ? `, ${bad.length} failed — listed below` : ""}.`)
    } finally {
      busyRef.current = false
      setUploading(false)
      router.refresh()
    }
  }

  const box = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-4 space-y-4 text-sm text-gray-700 dark:text-gray-300"
  const btn = "min-h-[44px] inline-flex items-center px-4 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
  const step = "text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400"
  const good = "rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-emerald-900 dark:text-emerald-100"
  const bad = "rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-red-800 dark:text-red-200"

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mr-1">Tools</span>
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className={`min-h-[40px] px-3 rounded-lg border text-sm transition-colors ${open
            ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-semibold"
            : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-violet-500"}`}>
          📥 Update the news
          {uploading && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-violet-500 animate-pulse align-middle" title="Uploading" />}
        </button>
        {missing.length > 0 && !open && <span className="text-xs text-gray-500 dark:text-gray-400">{missing.length.toLocaleString()} picture{missing.length === 1 ? "" : "s"} still only on the website</span>}
      </div>

      {open && (
        <div className={box}>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">📥 Update the news from the website</h3>
            <p className="mt-1 text-gray-600 dark:text-gray-400">The website won&apos;t answer the Hub&apos;s server, so a machine in the office runs the collector and what it saves is loaded here. The Hub holds {held.toLocaleString()} article{held === 1 ? "" : "s"} now.</p>
          </div>

          <div className="space-y-2">
            <div className={step}>1 · Run the collector on an office machine</div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={copyClaude} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>{copied ? "✓ Copied" : "📋 Copy instructions for Claude"}</button>
              <span className="text-gray-600 dark:text-gray-400">paste them into a Claude session on an office machine with the Hub&apos;s code — it runs <span className="font-mono text-xs">scripts/collect-news.mjs</span>, which pulls every article and downloads each cover picture into a folder (six or seven minutes).</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className={step}>2 · Load the articles — every <span className="font-mono normal-case">vectis-news-N.json</span> file, all at once</div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" multiple accept=".json,application/json" onChange={e => setFiles(Array.from(e.target.files ?? []))} className="file-input" />
              <button type="button" onClick={load} disabled={!files.length || loading} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>{loading ? `Loading file ${loadingAt} of ${files.length}…` : `Load ${files.length || ""} file${files.length === 1 ? "" : "s"}`}</button>
            </div>
            {loaded && <p className={good}>{loaded}</p>}
            {problems.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          </div>

          <div className="space-y-2">
            <div className={step}>3 · Upload the pictures — open the collector&apos;s <span className="font-mono normal-case">pictures</span> folder, select them all (Ctrl+A) and press Open</div>
            <div className="flex flex-wrap items-center gap-2">
              {/* A plain multi-file picker, not a folder picker: a folder picker greys the files out and
                  expects the folder itself to be chosen, which reads as "the photos aren't there". */}
              <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,image/*"
                onChange={e => { setFolder(Array.from(e.target.files ?? [])); setFinished(null); setFailed([]); setDone(0) }} className="file-input" />
              {!uploading
                ? <button type="button" onClick={upload} disabled={toUpload.length === 0} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>{toUpload.length ? `Upload ${toUpload.length.toLocaleString()} picture${toUpload.length === 1 ? "" : "s"}` : "Nothing to upload"}</button>
                : <button type="button" onClick={() => { stopRef.current = true }} className={`${btn} border border-gray-300 dark:border-gray-700 hover:border-violet-500`}>⏹ Stop</button>}
            </div>
            {folder.length > 0 && !uploading && !finished && (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {folder.length.toLocaleString()} file{folder.length === 1 ? "" : "s"} in the folder · {toUpload.length.toLocaleString()} match{toUpload.length === 1 ? "es" : ""} an article whose picture the Hub doesn&apos;t have{spare ? ` · ${spare.toLocaleString()} already in the Hub or not an article's picture` : ""}
                {missing.length > toUpload.length ? ` · ${(missing.length - toUpload.length).toLocaleString()} wanted picture${missing.length - toUpload.length === 1 ? " isn't" : "s aren't"} in this folder` : ""}
              </p>
            )}
            {(uploading || finished) && (
              <div aria-live="polite">
                <div className="flex flex-wrap justify-between gap-2 mb-1">
                  <span>{uploading ? "Uploading" : finished}</span>
                  <span className="font-mono shrink-0">{done.toLocaleString()} of {toUpload.length.toLocaleString()}</span>
                </div>
                <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className={`h-full bg-violet-500 ${uploading ? "animate-pulse" : ""}`} style={{ width: `${toUpload.length ? Math.min(100, Math.round((done / toUpload.length) * 100)) : 0}%` }} /></div>
              </div>
            )}
            {failed.length > 0 && <ul className="list-disc pl-5 text-xs text-red-700 dark:text-red-300">{failed.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          </div>

          {error && <p className={bad}>⚠ {error}</p>}
        </div>
      )}
    </div>
  )
}
