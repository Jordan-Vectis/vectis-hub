"use client"

import { useState } from "react"
import { salePicturesScript } from "@/lib/sale-pictures-collector"

// Databases → Sales → "Get the pictures": the picture-only collector (Jordan, 2026-09-22: "can't
// we make a new one that just gets the cover images?"), handed out two ways — the browser script
// to paste on vectis.co.uk, or the instructions for a Claude session to run the Node script — and
// the box to load what it saved. The upload is the BC Database page's route: the same file shape,
// minus the lots, and the Hub never blanks a value it already holds.
export default function SalesCollect({ defaultFrom, defaultTo }: { defaultFrom: number; defaultTo: number }) {
  const [from, setFrom] = useState(String(defaultFrom))
  const [to, setTo] = useState(String(defaultTo))
  const [copied, setCopied] = useState("")
  const [showScript, setShowScript] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState(0)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  const f = Math.max(1, parseInt(from) || 0), t = Math.max(1, parseInt(to) || 0)
  const script = salePicturesScript({ from: f, to: t })
  const claudeText = [
    "Please collect every sale's cover picture from vectis.co.uk for the Vectis Hub. I will load the file myself afterwards.",
    "",
    "Background: the Hub's Railway server cannot read the website (it answers 202 with an empty body), but a machine on the Vectis office network can. Each sale page on the site carries one cover picture — the one the auction calendar shows — and its title and date. This collector reads ONE page per sale number and never the lot feed, so it is quick.",
    "",
    "From C:\\Dev apps\\vectis-hub, run it in the background and leave it going:",
    "",
    `    node scripts/collect-sale-pictures.mjs ${f} ${t} "<my Downloads folder>/vectis-sale-pictures"`,
    "",
    "It writes one file, vectis-sale-pictures.json, and a log beside it. About a third of a second a sale, so ten minutes or so for the whole range. A sale number with no sale is normal and is counted, not an error.",
    "",
    "When it finishes, tell me how many sales it found, how many had a picture, and whether any page would not load — it names those at the end. Do not try to load the file into the database yourself.",
  ].join(String.fromCharCode(10))

  async function copyText(kind: "script" | "claude") {
    try {
      await navigator.clipboard.writeText(kind === "script" ? script : claudeText)
      setCopied(kind)
      setTimeout(() => setCopied(""), 4000)
    } catch {
      setError("This browser would not let the page copy for you — open “Show the script” and copy it by hand.")
    }
  }

  async function load() {
    if (!files.length || busy) return
    setBusy(true); setError(null); setDone(null); setProblems([]); setAt(0)
    let saleRows = 0, heroes = 0, lots = 0
    const found: string[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        setAt(i + 1)
        const fd = new FormData()
        fd.append("file", files[i])
        const res = await fetch("/api/databases/bc/collect", { method: "POST", body: fd })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j?.error ?? `${files[i].name} could not be loaded (${res.status})`)
        saleRows += j.saleRows ?? 0; heroes += j.heroes ?? 0; lots += j.lots ?? 0
        if (Array.isArray(j.problems)) found.push(...j.problems)
      }
      setProblems(found)
      setDone(saleRows === 0
        ? "Nothing was recorded — the file held no sales. Check the collector ran on vectis.co.uk and finished."
        : `Recorded ${saleRows.toLocaleString()} sale${saleRows === 1 ? "" : "s"}, ${heroes.toLocaleString()} with a cover picture${lots ? `, and ${lots.toLocaleString()} lots` : ""}. Refresh the page, then press Copy sale pictures above to bring them into the Hub.`)
    } catch (e: any) {
      setError(e?.message ?? "Could not load the files")
    } finally {
      setBusy(false)
    }
  }

  const box = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white focus:outline-none focus:border-violet-500"
  const btn = "min-h-[44px] inline-flex items-center px-4 rounded-lg font-semibold disabled:opacity-50"
  const step = "text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400"

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-4 space-y-4 text-sm text-gray-700 dark:text-gray-300">
      <div>
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">📥 Get the pictures from the website</h3>
        <p className="mt-1 text-gray-600 dark:text-gray-400">The website won&apos;t answer the Hub&apos;s server, so a machine in the office reads the sale pages and the file is loaded here. Pictures only — the lots are not touched, so it takes about ten minutes for every sale there has ever been.</p>
      </div>

      <div className="space-y-2">
        <div className={step}>1 · Run the collector on an office machine — either way works</div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2"><span className="text-xs text-gray-500">From sale</span><input value={from} onChange={e => setFrom(e.target.value)} inputMode="numeric" className={`${box} w-24`} /></label>
          <label className="flex items-center gap-2"><span className="text-xs text-gray-500">to</span><input value={to} onChange={e => setTo(e.target.value)} inputMode="numeric" className={`${box} w-24`} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => copyText("script")} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>{copied === "script" ? "✓ Copied" : "📋 Copy the collector"}</button>
          <span className="text-gray-600 dark:text-gray-400">then on <span className="font-semibold text-gray-900 dark:text-white">www.vectis.co.uk</span> press F12 → Console, paste, Enter. It saves a file to your Downloads every 200 sales and at the end.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => copyText("claude")} className={`${btn} border border-gray-300 dark:border-gray-700 hover:border-violet-500`}>{copied === "claude" ? "✓ Copied" : "📋 Copy instructions for Claude"}</button>
          <span className="text-gray-600 dark:text-gray-400">or paste these into a Claude session on an office machine with the Hub&apos;s code — it runs <span className="font-mono text-xs">scripts/collect-sale-pictures.mjs</span> for you.</span>
        </div>
        <button type="button" onClick={() => setShowScript(s => !s)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-violet-500">{showScript ? "Hide the script" : "Show the script"}</button>
        {showScript && <pre className="max-h-64 overflow-auto rounded-lg bg-gray-100 dark:bg-gray-900 p-3 text-xs font-mono whitespace-pre-wrap break-all">{script}</pre>}
      </div>

      <div className="space-y-2">
        <div className={step}>2 · Load what it saved</div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" accept=".json,application/json" multiple onChange={e => setFiles(Array.from(e.target.files ?? []))} className="file-input" />
          <button type="button" onClick={load} disabled={!files.length || busy} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>{busy ? `Loading file ${at} of ${files.length}…` : `Load ${files.length || ""} file${files.length === 1 ? "" : "s"}`}</button>
        </div>
        {done && <p className="rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-emerald-900 dark:text-emerald-100">{done}</p>}
        {error && <p className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-red-800 dark:text-red-200">⚠ {error}</p>}
        {problems.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      </div>

      <div className={step}>3 · Press Copy sale pictures (the 📸 chip) so the Hub keeps its own copy</div>
    </div>
  )
}
