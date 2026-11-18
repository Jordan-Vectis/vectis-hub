"use client"

import { useMemo, useRef, useState } from "react"
import { bcPhotoBatch, bcPhotoPlan, type BcPhotoLot, type BcPhotoResult } from "@/lib/actions/bc-photo-pull"

// 📸 Pull photos (top of a sale page, admins only — 2026-11-18). Copies photos out of Business Central onto the
// Hub lots with the same barcode, for lots that have no photos in the Hub yet — this sale, or EVERY sale at once.
// The rules are in lib/actions/bc-photo-pull.ts.
//
// Two steps, each driven from here in batches with a count that moves and a Stop (RULES.md 7b):
//   1. "Find photos in BC" — READ ONLY. Says what BC has, lot by lot (one sale) or sale by sale (every sale).
//   2. "Copy N photos onto M lots" — the server finds each lot's photos again and copies the ones it hasn't
//      got, so nothing is copied from a stale list. The end says what happened in numbers.
// The same error three batches running stops it by itself (BC refusing, the photo list missing) rather than
// failing every remaining lot one batch at a time.

/** Lots per call — the server's limits (BATCH_MAX / COPY_MAX in bc-photo-pull.ts). */
const FIND_BATCH = 12
const COPY_BATCH = 3

type Phase = "idle" | "loading" | "finding" | "review" | "copying" | "done"
type Scope = "sale" | "all"
type Checked = { lot: BcPhotoLot; r: BcPhotoResult }

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`
const btn = "inline-flex items-center justify-center min-h-11 px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "inline-flex items-center justify-center min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const SHOW_MAX = 200

function failedBatch(lots: BcPhotoLot[], error: string): Checked[] {
  return lots.map(lot => ({ lot, r: { lotId: lot.id, outcome: "failed", uniqueId: "", receiptNo: "", photos: 0, notCopied: 0, added: 0, problems: [], detail: error } }))
}

export default function BcPhotoPullModal({ auctionId, saleCode, onClose, onCopied }: {
  auctionId: string
  saleCode: string
  onClose: () => void
  /** Called after any photo was copied, so the sale page can show them. */
  onCopied: () => void
}) {
  const [scope, setScope] = useState<Scope>("sale")
  const [planScope, setPlanScope] = useState<Scope>("sale")
  const [phase, setPhase] = useState<Phase>("idle")
  const [environment, setEnvironment] = useState<string | null>(null)
  const [leftOut, setLeftOut] = useState<{ noBarcode: number; hasPhotos: number } | null>(null)
  const [total, setTotal] = useState(0)
  const [checked, setChecked] = useState<Checked[]>([])
  const [copied, setCopied] = useState<Checked[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const stopRef = useRef(false)

  const found = checked.filter(c => c.r.outcome === "found")
  const toCopy = found.filter(c => c.r.notCopied > 0)
  const photosToCopy = toCopy.reduce((n, c) => n + c.r.notCopied, 0)
  const count = (o: BcPhotoResult["outcome"]) => checked.filter(c => c.r.outcome === o).length
  const busy = phase === "loading" || phase === "finding" || phase === "copying"

  /** Runs `lots` through the server in batches; stops on Stop, a lost BC sign-in, or the same error 3 times. */
  async function runBatches(lots: BcPhotoLot[], size: number, copy: boolean, onBatch: (rows: Checked[]) => void): Promise<"done" | "stopped" | "signIn" | "repeated"> {
    let lastError = ""
    let sameErrors = 0
    for (let i = 0; i < lots.length; i += size) {
      if (stopRef.current) return "stopped"
      setProgress({ done: i, total: lots.length })
      const batch = lots.slice(i, i + size)
      const res = await bcPhotoBatch(batch.map(l => l.id), copy).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
      if (!res.ok) {
        if (res.error === "NO_BC_SIGN_IN") return "signIn"
        onBatch(failedBatch(batch, res.error))
        sameErrors = res.error === lastError ? sameErrors + 1 : 1
        lastError = res.error
        if (sameErrors >= 3) { setNotice(`Stopped by itself: Business Central gave the same error three times running — “${res.error}”`); return "repeated" }
        continue
      }
      sameErrors = 0
      lastError = ""
      const byId = new Map(res.data.map(r => [r.lotId, r]))
      onBatch(batch.map(lot => ({ lot, r: byId.get(lot.id) ?? failedBatch([lot], "Not checked.")[0].r })))
    }
    setProgress({ done: lots.length, total: lots.length })
    return "done"
  }

  async function find() {
    setPhase("loading"); setError(null); setNeedsSignIn(false); setNotice(null); setChecked([]); setCopied([]); setSummary(null); setProgress(null)
    setPlanScope(scope)
    const plan = await bcPhotoPlan(scope === "sale" ? auctionId : null).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))
    if (!plan.ok) {
      if (plan.error === "NO_BC_SIGN_IN") setNeedsSignIn(true)
      else setError(plan.error)
      setPhase("idle")
      return
    }
    setEnvironment(plan.data.environment)
    setLeftOut({ noBarcode: plan.data.noBarcode, hasPhotos: plan.data.hasPhotos })
    setTotal(plan.data.lots.length)
    stopRef.current = false
    setPhase("finding")
    const all: Checked[] = []
    const how = await runBatches(plan.data.lots, FIND_BATCH, false, rows => { all.push(...rows); setChecked([...all]) })
    setProgress(null)
    if (how === "signIn") { setNeedsSignIn(true); setPhase("idle"); return }
    if (how === "stopped") setNotice(`Stopped after checking ${plural(all.length, "lot", "lots")} of ${plan.data.lots.length.toLocaleString("en-GB")} — nothing was copied. What was checked is below.`)
    setPhase("review")
  }

  async function copy() {
    const list = toCopy.map(c => c.lot)
    stopRef.current = false
    setPhase("copying"); setError(null); setNotice(null); setCopied([])
    const out: Checked[] = []
    const how = await runBatches(list, COPY_BATCH, true, rows => { out.push(...rows); setCopied([...out]) })
    setProgress(null)
    if (how === "signIn") setNeedsSignIn(true)
    setPhase("done")
    const added = out.reduce((n, c) => n + c.r.added, 0)
    const lotsGot = out.filter(c => c.r.added > 0).length
    const problems = out.reduce((n, c) => n + c.r.problems.length, 0) + out.filter(c => c.r.outcome === "failed").length
    const leftAlone = out.filter(c => c.r.outcome !== "found" && c.r.outcome !== "failed").length
    setSummary(`${how === "stopped" ? `Stopped after ${plural(out.length, "lot", "lots")} of ${list.length.toLocaleString("en-GB")} — the rest weren't copied. ` : ""}`
      + `${plural(added, "photo", "photos")} copied onto ${plural(lotsGot, "lot", "lots")}`
      + `${leftAlone ? `, ${plural(leftAlone, "lot", "lots")} left alone (photos added in the Hub meanwhile, or no longer in BC)` : ""}`
      + `${problems ? `, ${plural(problems, "problem", "problems")} (listed below)` : ""}.`)
    if (added) onCopied()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => { if (!busy) onClose() }}>
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-300 dark:border-gray-700 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">📸 Pull photos from Business Central</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              Copies lots&apos; photos out of BC onto the Hub lot with the same barcode. Admins only, signed in as you.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} title={busy ? "Press Stop first" : "Close"}
            className="min-h-11 min-w-11 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-xl leading-none disabled:opacity-30">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm text-gray-800 dark:text-gray-200">
          {phase === "idle" && (
            <>
              <fieldset className="rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3">
                <legend className="px-1 font-semibold text-gray-900 dark:text-white">Which lots?</legend>
                <label className="flex items-center gap-3 min-h-11 cursor-pointer">
                  <input type="radio" name="bc-photo-scope" className="h-5 w-5 accent-sky-600" checked={scope === "sale"} onChange={() => setScope("sale")} />
                  <span>This sale — <b className="font-mono">{saleCode}</b></span>
                </label>
                <label className="flex items-center gap-3 min-h-11 cursor-pointer">
                  <input type="radio" name="bc-photo-scope" className="h-5 w-5 accent-sky-600" checked={scope === "all"} onChange={() => setScope("all")} />
                  <span><b>All sales</b> — every lot in the Hub without photos</span>
                </label>
              </fieldset>
              <ul className="list-disc pl-5 space-y-1">
                <li>Only lots with <b>no photos in the Hub</b> are filled. A lot with any photo of its own is left alone.</li>
                <li>A lot is matched to BC by its <b>barcode</b>; its photos come in BC&apos;s own order.</li>
                <li>It only <b>reads</b> from BC — nothing in BC changes. Each photo added is noted on the lot&apos;s change log.</li>
                <li>Pressing it again only adds photos that weren&apos;t copied before.</li>
              </ul>
              <button type="button" className={btnGo} onClick={find}>Find photos in BC</button>
              <p className="text-xs text-gray-500 dark:text-gray-400">Finding copies nothing — it shows what BC has first.{scope === "all" ? " Every sale takes a few minutes; keep this window open." : ""}</p>
            </>
          )}

          {phase === "loading" && <p role="status">Finding {planScope === "all" ? "every sale's" : `${saleCode}'s`} lots without photos…</p>}

          {(phase === "finding" || phase === "copying") && progress && (
            <div className="flex flex-wrap items-center gap-3" role="status" aria-live="polite">
              <span>
                {phase === "finding"
                  ? <>Checked <b>{Math.min(progress.done, progress.total).toLocaleString("en-GB")}</b> of {progress.total.toLocaleString("en-GB")} lots in BC — {plural(found.length, "lot", "lots")} with photos so far…</>
                  : <>Copying: <b>{Math.min(progress.done, progress.total).toLocaleString("en-GB")}</b> of {progress.total.toLocaleString("en-GB")} lots done — {plural(copied.reduce((n, c) => n + c.r.added, 0), "photo", "photos")} copied so far…</>}
              </span>
              <button type="button" className={btn} onClick={() => { stopRef.current = true }}>Stop after this batch</button>
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
          {notice && <p className="text-amber-800 dark:text-amber-200">{notice}</p>}

          {(phase === "finding" || phase === "review") && (checked.length > 0 || phase === "review") && (
            <>
              <div className="rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-4 py-3 space-y-1">
                <p>
                  {planScope === "all" ? "Every sale" : <b className="font-mono">{saleCode}</b>}: checked <b>{checked.length.toLocaleString("en-GB")}</b>
                  {total !== checked.length ? <> of {total.toLocaleString("en-GB")}</> : null} lots without photos
                  {environment ? <> in BC&apos;s <b className="font-mono">{environment}</b> environment</> : null} —{" "}
                  <b>{plural(found.length, "lot has", "lots have")} photos in BC</b>
                  {found.length ? <> ({plural(found.reduce((n, c) => n + c.r.photos, 0), "photo", "photos")}, {photosToCopy.toLocaleString("en-GB")} not copied yet)</> : null},{" "}
                  {count("none").toLocaleString("en-GB")} in BC with no photos, {count("notInBc").toLocaleString("en-GB")} not in BC
                  {count("skipped") ? <>, {count("skipped").toLocaleString("en-GB")} left alone</> : null}
                  {count("failed") ? <>, <span className="text-red-700 dark:text-red-300">{count("failed").toLocaleString("en-GB")} couldn&apos;t be checked</span></> : null}.
                </p>
                {leftOut && (leftOut.hasPhotos > 0 || leftOut.noBarcode > 0) && (
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Not checked: {plural(leftOut.hasPhotos, "lot", "lots")} already with photos in the Hub, {plural(leftOut.noBarcode, "lot", "lots")} with no barcode.
                  </p>
                )}
                {phase === "review" && (
                  <div className="pt-2 flex flex-wrap gap-2">
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
              {planScope === "all" ? <BySale rows={checked} /> : <ByLot rows={checked} />}
            </>
          )}

          {(phase === "copying" || phase === "done") && (
            <>
              {summary && <p className="font-medium text-gray-900 dark:text-white">{summary}</p>}
              <CopyResults rows={copied} />
              {phase === "done" && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn} onClick={() => { setPhase("idle"); setCopied([]); setSummary(null) }}>Check again</button>
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

/** One sale: every lot checked, found ones first. */
function ByLot({ rows }: { rows: Checked[] }) {
  const order: Record<string, number> = { found: 0, failed: 1, none: 2, notInBc: 3, skipped: 4 }
  const sorted = [...rows].sort((a, b) => (order[a.r.outcome] ?? 9) - (order[b.r.outcome] ?? 9))
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-gray-900 text-left text-gray-600 dark:text-gray-400">
          <tr><th className="px-3 py-2">Barcode</th><th className="px-3 py-2">In BC as</th><th className="px-3 py-2">Photos in BC</th><th className="px-3 py-2">Lot</th></tr>
        </thead>
        <tbody>
          {sorted.slice(0, SHOW_MAX).map(({ lot, r }) => (
            <tr key={lot.id} className="border-t border-gray-200 dark:border-gray-800">
              <td className="px-3 py-1.5 font-mono">{lot.barcode}</td>
              <td className="px-3 py-1.5 font-mono">
                {r.uniqueId || "—"}
                {r.receiptNo && lot.receipt && r.receiptNo.toUpperCase() !== lot.receipt.toUpperCase() && (
                  <span className="ml-1 font-sans text-amber-700 dark:text-amber-300">(BC receipt {r.receiptNo}, Hub says {lot.receipt})</span>
                )}
              </td>
              <td className="px-3 py-1.5">
                {r.outcome === "found" && <span className="text-emerald-700 dark:text-emerald-300">{r.photos}{r.notCopied < r.photos ? ` (${r.photos - r.notCopied} copied before)` : ""}</span>}
                {r.outcome === "none" && <span className="text-gray-600 dark:text-gray-400">None in BC</span>}
                {r.outcome === "notInBc" && <span className="text-gray-600 dark:text-gray-400">Barcode not in BC</span>}
                {r.outcome === "skipped" && <span className="text-gray-600 dark:text-gray-400">{r.detail}</span>}
                {r.outcome === "failed" && <span className="text-red-700 dark:text-red-300">{r.detail}</span>}
              </td>
              <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 max-w-[24rem] truncate">{lot.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > SHOW_MAX && <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">…and {(sorted.length - SHOW_MAX).toLocaleString("en-GB")} more.</p>}
    </div>
  )
}

/** Every sale: one row per sale, the ones with photos to copy first. */
function BySale({ rows }: { rows: Checked[] }) {
  const sales = useMemo(() => {
    const m = new Map<string, { code: string; checked: number; withPhotos: number; toCopy: number; none: number; notInBc: number; failed: number }>()
    for (const { lot, r } of rows) {
      const s = m.get(lot.auctionId) ?? { code: lot.saleCode, checked: 0, withPhotos: 0, toCopy: 0, none: 0, notInBc: 0, failed: 0 }
      s.checked++
      if (r.outcome === "found") { s.withPhotos++; s.toCopy += r.notCopied }
      else if (r.outcome === "none") s.none++
      else if (r.outcome === "notInBc") s.notInBc++
      else if (r.outcome === "failed") s.failed++
      m.set(lot.auctionId, s)
    }
    return [...m.values()].sort((a, b) => b.toCopy - a.toCopy || a.code.localeCompare(b.code, "en", { numeric: true }))
  }, [rows])
  const failures = rows.filter(c => c.r.outcome === "failed")
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-900 text-left text-gray-600 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">Sale</th><th className="px-3 py-2">Lots checked</th><th className="px-3 py-2">With photos in BC</th>
              <th className="px-3 py-2">Photos to copy</th><th className="px-3 py-2">In BC, no photos</th><th className="px-3 py-2">Not in BC</th><th className="px-3 py-2">Couldn&apos;t check</th>
            </tr>
          </thead>
          <tbody>
            {sales.map(s => (
              <tr key={s.code} className="border-t border-gray-200 dark:border-gray-800">
                <td className="px-3 py-1.5 font-mono font-medium">{s.code}</td>
                <td className="px-3 py-1.5">{s.checked.toLocaleString("en-GB")}</td>
                <td className="px-3 py-1.5 text-emerald-700 dark:text-emerald-300">{s.withPhotos.toLocaleString("en-GB")}</td>
                <td className="px-3 py-1.5 font-semibold">{s.toCopy.toLocaleString("en-GB")}</td>
                <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{s.none.toLocaleString("en-GB")}</td>
                <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{s.notInBc.toLocaleString("en-GB")}</td>
                <td className={`px-3 py-1.5 ${s.failed ? "text-red-700 dark:text-red-300" : "text-gray-600 dark:text-gray-400"}`}>{s.failed.toLocaleString("en-GB")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failures.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none min-h-11 inline-flex items-center text-red-700 dark:text-red-300">
            Lots that couldn&apos;t be checked ({failures.length.toLocaleString("en-GB")})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {failures.slice(0, SHOW_MAX).map(({ lot, r }) => (
              <li key={lot.id}><span className="font-mono">{lot.saleCode} {lot.barcode}</span> — {r.detail}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

/** What the copy did: lots with a problem in full, the rest counted. */
function CopyResults({ rows }: { rows: Checked[] }) {
  if (!rows.length) return null
  const troubled = rows.filter(c => c.r.problems.length || c.r.outcome === "failed" || (c.r.outcome !== "found"))
  const fine = rows.filter(c => !troubled.includes(c))
  return (
    <div className="space-y-2">
      {troubled.length > 0 && (
        <ul className="space-y-1">
          {troubled.slice(0, SHOW_MAX).map(({ lot, r }) => (
            <li key={lot.id}>
              <span className="font-mono font-medium">{lot.saleCode} {lot.barcode}</span>
              {r.uniqueId && <span className="text-gray-500 dark:text-gray-400"> ({r.uniqueId})</span>}
              {" — "}
              {r.outcome === "failed"
                ? <span className="text-red-700 dark:text-red-300">{r.detail}</span>
                : r.outcome !== "found"
                  ? <span className="text-gray-600 dark:text-gray-400">{r.detail} Left alone.</span>
                  : <span className="text-emerald-700 dark:text-emerald-300">{plural(r.added, "photo", "photos")} copied</span>}
              {r.problems.map((p, j) => <div key={j} className="pl-4 text-red-700 dark:text-red-300">✗ {p}</div>)}
            </li>
          ))}
        </ul>
      )}
      {fine.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none min-h-11 inline-flex items-center text-indigo-700 dark:text-indigo-300">
            Lots copied with no problems ({fine.length.toLocaleString("en-GB")})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {fine.slice(0, SHOW_MAX).map(({ lot, r }) => (
              <li key={lot.id}><span className="font-mono">{lot.saleCode} {lot.barcode}</span> — {plural(r.added, "photo", "photos")}{r.uniqueId ? ` (BC ${r.uniqueId})` : ""}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
