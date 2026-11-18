"use client"

import { useRef, useState } from "react"
import { bcPhotoCopy, bcPhotoFind, bcPhotoPullStart, type BcPhotoFind, type BcPhotoLot } from "@/lib/actions/bc-photo-pull"

// A sale → 📸 Pull photos (top of the sale page, admins only — 2026-11-18). Copies photos out of Business
// Central onto the Hub lots with the same barcode, for lots that have no photos in the Hub yet. The rules are
// in lib/actions/bc-photo-pull.ts.
//
// Two steps, each one lot at a time with a count that moves and a Stop (RULES.md 7b):
//   1. "Find photos in BC" — READ ONLY. Says, lot by lot, what BC has. Nothing is copied.
//   2. "Copy N photos onto M lots" — the server finds each lot's photos again and copies the ones it hasn't
//      got, so nothing is copied from a stale list. The end says what happened in numbers.

type Phase = "idle" | "loading" | "finding" | "review" | "copying" | "done"

type Row = { lot: BcPhotoLot; find: BcPhotoFind | { outcome: "failed"; detail: string } }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const btn = "inline-flex items-center justify-center min-h-11 px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "inline-flex items-center justify-center min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

export default function BcPhotoPullModal({ auctionId, saleCode, onClose, onCopied }: {
  auctionId: string
  saleCode: string
  onClose: () => void
  /** Called after any photo was copied, so the sale page can show them. */
  onCopied: () => void
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [environment, setEnvironment] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [results, setResults] = useState<{ barcode: string; uniqueId: string; added: number; already: number; problems: string[]; skipped: string | null; error?: string }[]>([])
  const [summary, setSummary] = useState<string | null>(null)
  const stopRef = useRef(false)

  const found = rows.filter(r => r.find.outcome === "found") as (Row & { find: Extract<BcPhotoFind, { outcome: "found" }> })[]
  const toCopy = found.filter(r => r.find.notCopied > 0)
  const photosToCopy = toCopy.reduce((n, r) => n + r.find.notCopied, 0)
  const count = (o: string) => rows.filter(r => r.find.outcome === o).length

  function signInOrError(err: string) {
    if (err === "NO_BC_SIGN_IN") setNeedsSignIn(true)
    else setError(err)
  }

  async function find() {
    setPhase("loading"); setError(null); setNeedsSignIn(false); setNotice(null); setRows([]); setResults([]); setSummary(null)
    const start = await bcPhotoPullStart(auctionId).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
    if (!start.ok) { signInOrError(start.error); setPhase("idle"); return }
    setEnvironment(start.data.environment)
    const lots = start.data.lots
    stopRef.current = false
    setPhase("finding")
    const all: Row[] = []
    for (let i = 0; i < lots.length; i++) {
      if (stopRef.current) {
        setNotice(`Stopped after checking ${i} of ${lots.length} lots — nothing was copied. The lots checked so far are below.`)
        break
      }
      const lot = lots[i]
      setProgress({ done: i, total: lots.length, current: lot.barcode ?? lot.title.slice(0, 30) })
      // The server decides too; these two are answered here to save a call per lot.
      let row: Row
      if (!lot.barcode) row = { lot, find: { outcome: "skipped", detail: "No barcode, so it can't be matched to BC." } }
      else if (lot.photos > lot.fromBc) row = { lot, find: { outcome: "skipped", detail: `Already has ${lot.photos - lot.fromBc} photo${lot.photos - lot.fromBc === 1 ? "" : "s"} in the Hub — left alone.` } }
      else {
        const res = await bcPhotoFind(auctionId, lot.id).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
        if (!res.ok && res.error === "NO_BC_SIGN_IN") { setProgress(null); setNeedsSignIn(true); setPhase("idle"); return }
        row = { lot, find: res.ok ? res.data : { outcome: "failed", detail: res.error } }
      }
      all.push(row)
      setRows([...all])
    }
    setProgress(null)
    setPhase("review")
  }

  async function copy() {
    const list = toCopy
    stopRef.current = false
    setPhase("copying"); setError(null); setNotice(null)
    const out: typeof results = []
    let stopped = false
    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) { stopped = true; break }
      const r = list[i]
      setProgress({ done: i, total: list.length, current: r.lot.barcode ?? "" })
      const res = await bcPhotoCopy(auctionId, r.lot.id).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
      if (!res.ok && res.error === "NO_BC_SIGN_IN") { setNeedsSignIn(true); break }
      out.push(res.ok
        ? { barcode: r.lot.barcode ?? "", ...res.data }
        : { barcode: r.lot.barcode ?? "", uniqueId: r.find.uniqueId, added: 0, already: 0, problems: [], skipped: null, error: res.error })
      setResults([...out])
    }
    setProgress(null)
    setPhase("done")
    const added = out.reduce((n, x) => n + x.added, 0)
    const lotsGot = out.filter(x => x.added > 0).length
    const problems = out.reduce((n, x) => n + x.problems.length, 0) + out.filter(x => x.error).length
    const skipped = out.filter(x => x.skipped).length
    setSummary(`${stopped ? `Stopped after ${out.length} of ${list.length} lots — the rest weren't copied. ` : ""}`
      + `${plural(added, "photo", "photos")} copied onto ${plural(lotsGot, "lot", "lots")}`
      + `${skipped ? `, ${plural(skipped, "lot", "lots")} left alone (photos added in the Hub meanwhile, or no longer in BC)` : ""}`
      + `${problems ? `, ${plural(problems, "problem", "problems")} (listed below)` : ""}.`)
    if (added) onCopied()
  }

  const busy = phase === "loading" || phase === "finding" || phase === "copying"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => { if (!busy) onClose() }}>
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-300 dark:border-gray-700 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">📸 Pull photos from Business Central</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              {saleCode} — copies each lot&apos;s photos out of BC onto the Hub lot with the same barcode. Admins only, signed in as you.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} title={busy ? "Press Stop first" : "Close"}
            className="min-h-11 min-w-11 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-xl leading-none disabled:opacity-30">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm text-gray-800 dark:text-gray-200">
          {phase === "idle" && (
            <>
              <ul className="list-disc pl-5 space-y-1">
                <li>Only lots with <b>no photos in the Hub</b> are filled. A lot with any photo of its own is left alone.</li>
                <li>A lot is matched to BC by its <b>barcode</b>; its photos come in BC&apos;s own order.</li>
                <li>It only <b>reads</b> from BC — nothing in BC changes. Each photo added is noted on the lot&apos;s change log.</li>
                <li>Pressing it again only adds photos that weren&apos;t copied before.</li>
              </ul>
              <button type="button" className={btnGo} onClick={find}>Find photos in BC</button>
              <p className="text-xs text-gray-500 dark:text-gray-400">Finding copies nothing — it shows what BC has first.</p>
            </>
          )}

          {phase === "loading" && <p role="status">Finding {saleCode}&apos;s lots…</p>}

          {(phase === "finding" || phase === "copying") && progress && (
            <div className="flex flex-wrap items-center gap-3" role="status" aria-live="polite">
              <span>
                {phase === "finding" ? "Checking BC for" : "Copying photos for"} lot {Math.min(progress.done + 1, progress.total)} of {progress.total}:{" "}
                <span className="font-mono">{progress.current}</span>…
              </span>
              <button type="button" className={btn} onClick={() => { stopRef.current = true }}>Stop after this one</button>
            </div>
          )}

          {needsSignIn && (
            <p className="text-amber-800 dark:text-amber-200">
              The Hub doesn&apos;t have a Business Central sign-in for you.{" "}
              <a className="font-medium underline text-indigo-700 dark:text-indigo-300 inline-flex items-center min-h-11"
                href={`/api/bc/auth?return=${encodeURIComponent(`/tools/cataloguing/auctions/${auctionId}`)}`}>
                Sign in to Business Central
              </a>
              , then press Pull photos again.
            </p>
          )}
          {error && <p className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-red-800 dark:text-red-200">{error}</p>}
          {notice && <p>{notice}</p>}

          {(phase === "finding" || phase === "review") && rows.length > 0 && (
            <>
              <div className="rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-4 py-3">
                <p>
                  Checked <b>{rows.length}</b> lots{environment ? <> in BC&apos;s <b className="font-mono">{environment}</b> environment</> : null}:{" "}
                  <b>{plural(found.length, "lot has", "lots have")}</b> photos in BC
                  {found.length ? <> ({plural(found.reduce((n, r) => n + r.find.photos, 0), "photo", "photos")}, {photosToCopy} not copied yet)</> : null},{" "}
                  {count("none")} in BC with no photos, {count("notInBc")} not in BC, {count("skipped")} left alone, {count("failed")} couldn&apos;t be checked.
                </p>
                {phase === "review" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {photosToCopy > 0 ? (
                      <button type="button" className={btnGo} onClick={copy}>
                        Copy {plural(photosToCopy, "photo", "photos")} onto {plural(toCopy.length, "lot", "lots")}
                      </button>
                    ) : (
                      <p className="font-medium">Nothing to copy — no lot without photos has photos in BC that it hasn&apos;t got already.</p>
                    )}
                    <button type="button" className={btn} onClick={() => setPhase("idle")}>Back</button>
                  </div>
                )}
              </div>
              <FindTable rows={rows} />
            </>
          )}

          {(phase === "copying" || phase === "done") && (
            <>
              {summary && <p className="font-medium text-gray-900 dark:text-white">{summary}</p>}
              {results.length > 0 && (
                <ul className="space-y-1">
                  {results.map((x, i) => (
                    <li key={i}>
                      <span className="font-mono font-medium">{x.barcode}</span>
                      {x.uniqueId && <span className="text-gray-500 dark:text-gray-400"> ({x.uniqueId})</span>}
                      {" — "}
                      {x.error
                        ? <span className="text-red-700 dark:text-red-300">{x.error}</span>
                        : x.skipped
                          ? <span className="text-gray-600 dark:text-gray-400">{x.skipped}</span>
                          : <span className="text-emerald-700 dark:text-emerald-300">{plural(x.added, "photo", "photos")} copied{x.already ? `, ${x.already} already there` : ""}</span>}
                      {x.problems.map((p, j) => <div key={j} className="pl-4 text-red-700 dark:text-red-300">✗ {p}</div>)}
                    </li>
                  ))}
                </ul>
              )}
              {phase === "done" && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn} onClick={find}>Check again</button>
                  <button type="button" className={btn} onClick={onClose}>Close</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Every lot checked, what BC has for it — found ones first. */
function FindTable({ rows }: { rows: Row[] }) {
  const order: Record<string, number> = { found: 0, failed: 1, none: 2, notInBc: 3, skipped: 4 }
  const sorted = [...rows].sort((a, b) => (order[a.find.outcome] ?? 9) - (order[b.find.outcome] ?? 9))
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-gray-900 text-left text-gray-600 dark:text-gray-400">
          <tr><th className="px-3 py-2">Barcode</th><th className="px-3 py-2">In BC as</th><th className="px-3 py-2">Photos in BC</th><th className="px-3 py-2">Lot</th></tr>
        </thead>
        <tbody>
          {sorted.map(({ lot, find }) => (
            <tr key={lot.id} className="border-t border-gray-200 dark:border-gray-800">
              <td className="px-3 py-1.5 font-mono">{lot.barcode ?? "—"}</td>
              <td className="px-3 py-1.5 font-mono">
                {"uniqueId" in find ? find.uniqueId : "—"}
                {"receiptNo" in find && lot.receipt && find.receiptNo.toUpperCase() !== lot.receipt.toUpperCase() && (
                  <span className="ml-1 font-sans text-amber-700 dark:text-amber-300">(BC receipt {find.receiptNo}, Hub says {lot.receipt})</span>
                )}
              </td>
              <td className="px-3 py-1.5">
                {find.outcome === "found" && <span className="text-emerald-700 dark:text-emerald-300">{find.photos}{find.notCopied < find.photos ? ` (${find.photos - find.notCopied} copied before)` : ""}</span>}
                {find.outcome === "none" && <span className="text-gray-600 dark:text-gray-400">None in BC</span>}
                {find.outcome === "notInBc" && <span className="text-gray-600 dark:text-gray-400">Barcode not in BC</span>}
                {find.outcome === "skipped" && <span className="text-gray-600 dark:text-gray-400">{find.detail}</span>}
                {find.outcome === "failed" && <span className="text-red-700 dark:text-red-300">{find.detail}</span>}
              </td>
              <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 max-w-[24rem] truncate">{lot.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
