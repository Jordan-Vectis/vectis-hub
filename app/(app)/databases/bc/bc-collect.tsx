"use client"

import { useState } from "react"
import { bcCollectorScript, COLLECTOR_FILE_MB, BC_FIRST_SITE_SALE, BC_LAST_SITE_SALE } from "@/lib/bc-web-collector"

// Databases → BC Database → "Load lot files collected from the website".
//
// ⚠⚠ WHY THIS PANEL EXISTS. The website answers the Hub's server with 202 and an empty body for
// every sale, while the same request from a machine in the office returns the lots. Business
// Central holds the full description and the photo path but publishes neither, and there is no
// development time to change that. So the collecting happens on an office machine and the files it
// writes are loaded here.
//
// ⚠ LAYOUT: the upload comes FIRST because that is the part that gets used. Collecting the files is
// done once, so the script that does it sits behind a toggle rather than three numbered steps
// standing between Jordan and the button he actually needs (2026-09-09: "its become a mess UI wise").
//
// ⚠ Files are sent ONE AT A TIME, with a count that moves (RULES §7b). A single 139 MB post shows
// nothing while it runs and would be cut off by Railway's 20 MB body limit anyway.
export default function BcCollect({ defaultFrom, defaultTo, collectedTo, held }: { defaultFrom: number; defaultTo: number; collectedTo: number | null; held: number }) {
  const [from, setFrom] = useState(String(defaultFrom))
  const [to, setTo] = useState(String(defaultTo))
  const [copied, setCopied] = useState<"" | "script" | "claude">("")
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState(0)
  const [lots, setLots] = useState(0)
  const [sales, setSales] = useState(0)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  const f = Math.max(1, parseInt(from) || 0), t = Math.max(1, parseInt(to) || 0)
  const script = bcCollectorScript({ from: f, to: t })
  const totalMb = files.reduce((n, x) => n + x.size, 0) / 1048576

  // ⚠ Written to stand on its own. Whoever reads it — a fresh Claude session on an office machine —
  // has none of this conversation, so it has to carry WHY the server cannot do it, WHERE the
  // collector is, WHICH sales to start from, and WHAT to report back.
  const claudeText = [
    "Please collect the Business Central lot descriptions and photos from vectis.co.uk for the Vectis Hub. I will load the files myself afterwards.",
    "",
    "Background: the Hub's Railway server cannot read the website — it answers 202 with an empty body for every sale — but a machine on the Vectis office network gets the lots normally. Business Central holds the full description and the photo path but publishes neither, so the website's lot feed is the only source we have.",
    "",
    "There is a collector in the repo for exactly this. From C:\\Dev apps\\vectis-hub, run it in the background and leave it going:",
    "",
    `    node scripts/collect-bc-lots.mjs ${f} ${t} "<my Downloads folder>/vectis-bc-lots"`,
    "",
    // ⚠⚠ THREE STATES, because "no marker" and "no lots" are different things — see the comment on
    // the BC Database page. Claiming an empty database when it is full sends whoever reads this off
    // to collect a year of sales for nothing, and they have no way of knowing better.
    collectedTo
      ? `The Hub already holds every sale up to the website's sale number ${collectedTo}, so ${f} is where to carry on from.`
      : held > 0
        ? `The Hub already holds ${held.toLocaleString()} lots, but not a record of which website sale each one came from, so there is no way to tell here how far the last collection got. ${f} to ${t} is the whole range. Collecting a sale we already have is safe — loading the files only fills in blanks and never overwrites — but it is slow, so if you can see the range should be narrower, say so before you start rather than after.`
        : "Nothing has been collected yet, so that is the whole range.",
    "",
    "It walks the website's own sale numbers, skips the pre-Business-Central sales with one small request each, keeps only finished sales and lots whose id looks like r009030-1, and writes JSON files of about 12 MB. Roughly half an hour for a year of sales. A red 500 in the output means there is no sale with that number and is normal.",
    "",
    "When it finishes, tell me how many lots and sales it collected, how many files, the highest website sale number it reached, and whether any sale could not be read — it names those at the end. Do not try to load them into the database yourself.",
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
    setBusy(true); setError(null); setDone(null); setProblems([]); setAt(0); setLots(0); setSales(0)
    let totalLots = 0, totalSales = 0
    const found: string[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        setAt(i + 1)
        const fd = new FormData()
        fd.append("file", files[i])
        const res = await fetch("/api/databases/bc/collect", { method: "POST", body: fd })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j?.error ?? `${files[i].name} could not be loaded (${res.status})`)
        totalLots += j.lots ?? 0; totalSales += j.sales ?? 0
        setLots(totalLots); setSales(totalSales)
        if (Array.isArray(j.problems)) found.push(...j.problems)
      }
      setProblems(found)
      setDone(totalLots === 0
        ? "Nothing was loaded — the files held no Business Central lots. Check the collector reached the recent sales."
        : `Loaded ${totalLots.toLocaleString()} lot${totalLots === 1 ? "" : "s"} across ${totalSales.toLocaleString()} sale${totalSales === 1 ? "" : "s"}. Refresh the page to see them, then press Copy BC photos above to bring their pictures in.`)
    } catch (e: any) {
      setError(e?.message ?? "Could not load the files")
    } finally {
      setBusy(false)
    }
  }

  const box = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white focus:outline-none focus:border-violet-500"
  const btn = "min-h-[44px] inline-flex items-center px-4 rounded-lg font-semibold disabled:opacity-50"
  const why = "cursor-pointer text-xs text-gray-500 dark:text-gray-400 hover:text-violet-500"

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">📥 Update the BC lots</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {collectedTo
            ? <>Collected up to the website&rsquo;s sale <span className="font-mono">{collectedTo}</span> — this picks up from <span className="font-mono">{collectedTo + 1}</span></>
            : held > 0
              ? <><span className="text-amber-600 dark:text-amber-400">{held.toLocaleString()} lots already collected, but not which sale they came from</span> — this starts at <span className="font-mono">{defaultFrom}</span> and only fills blanks</>
              : <>Nothing collected yet — this starts at sale <span className="font-mono">{defaultFrom}</span></>}
        </span>
      </div>

      {/* ⚠ THE THREE STEPS ARE ON SCREEN, NUMBERED (Jordan, 2026-09-09: "so when I want to update
          the BC lots lets say in a month what do I do?"). They were behind a toggle, which meant the
          panel showed a file box and no way of knowing where the files were meant to come from. */}
      <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        <li className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900 dark:text-white">1.</span>
          <button type="button" onClick={() => copyText("script")} className={`${btn} border border-gray-300 dark:border-gray-700 hover:border-violet-500`}>
            {copied === "script" ? "✓ Copied" : "📋 Copy the collector"}
          </button>
          <span>then open <a href="https://www.vectis.co.uk" target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">www.vectis.co.uk ↗</a> on an office machine.</span>
        </li>
        <li className="flex flex-wrap items-start gap-2">
          <span className="font-semibold text-gray-900 dark:text-white">2.</span>
          <span>On that page press <span className="font-semibold text-gray-900 dark:text-white">F12</span>, click <span className="font-semibold text-gray-900 dark:text-white">Console</span>, paste and press Enter. Leave the tab open — it prints each sale as it goes and saves a file to your Downloads every {COLLECTOR_FILE_MB} MB. Red 500 lines are normal.</span>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900 dark:text-white">3.</span>
          <input
            type="file" accept=".json,application/json" multiple disabled={busy}
            onChange={e => { setFiles(Array.from(e.target.files ?? [])); setDone(null); setError(null); setProblems([]) }}
            className="file-input"
          />
          <button type="button" onClick={load} disabled={busy || !files.length} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>
            {busy ? "Loading…" : files.length ? `Load ${files.length} file${files.length === 1 ? "" : "s"}` : "Load files"}
          </button>
          <span className="text-gray-500 dark:text-gray-400">{files.length ? `${totalMb.toFixed(0)} MB — they go up one at a time.` : "choose the files it saved."}</span>
        </li>
      </ol>

      {/* ⚠ The other way round: hand the whole job to Claude on an office machine. It can reach the
          website when the Hub's server cannot, so steps 1 and 2 stop being Jordan's problem. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 dark:border-gray-800 pt-3">
        <button type="button" onClick={() => copyText("claude")} className={`${btn} border border-gray-300 dark:border-gray-700 hover:border-violet-500`}>
          {copied === "claude" ? "✓ Copied" : "📋 Copy instructions for Claude"}
        </button>
        <span className="text-sm text-gray-600 dark:text-gray-400">Or paste these into Claude Code on an office machine and it does steps 1 and 2 for you — then come back and press Load.</span>
      </div>

      {busy && (
        <div className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
          <div className="flex flex-wrap justify-between gap-2 mb-1">
            <span>File {at} of {files.length} — {lots.toLocaleString()} lots loaded across {sales.toLocaleString()} sales</span>
            <span className="font-mono shrink-0">{Math.round((at / Math.max(1, files.length)) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500 transition-all" style={{ width: `${(at / Math.max(1, files.length)) * 100}%` }} /></div>
        </div>
      )}
      {done && !busy && <p className="text-sm text-emerald-700 dark:text-emerald-300">{done}</p>}
      {error && <p className="text-sm text-red-700 dark:text-red-300">⚠ {error}</p>}
      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">
          {problems.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}

      <details>
        <summary className={why}>Why it is done this way, and the sale numbers</summary>
        <div className="mt-2 space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <p>
            The website will not answer the Hub&rsquo;s server — every sale comes back empty — but it answers a browser
            on the office network normally. The files go in through the same route the automatic pull uses, so the two
            can never disagree. Sales already held are updated rather than duplicated, so collecting a stretch twice
            only fills in what was blank — a hammer price on a sale that has since been held, for instance.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">First sale</span>
              <input value={from} onChange={e => setFrom(e.target.value)} inputMode="numeric" className={`${box} w-28`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Last sale</span>
              <input value={to} onChange={e => setTo(e.target.value)} inputMode="numeric" className={`${box} w-28`} />
            </label>
          </div>
          <p className="text-xs">
            These are the website&rsquo;s own sale numbers, not our sale codes — Business Central sales run from site
            number {BC_FIRST_SITE_SALE} to {BC_LAST_SITE_SALE}, and sales with none are skipped in one small request.
            Change them and press Copy the collector again. To stop a run early type <span className="font-mono">vectisStop()</span>;
            running it again carries on from where it stopped.
          </p>
          <details>
            <summary className={why}>Show the script (if the copy button will not work)</summary>
            <textarea readOnly value={script} rows={10} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0D0D0F] p-2 font-mono text-[11px] text-gray-800 dark:text-gray-200" />
          </details>
        </div>
      </details>
    </div>
  )
}
