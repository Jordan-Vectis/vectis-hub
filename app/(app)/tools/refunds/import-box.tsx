"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { importRefundLog, previewRefundLog } from "@/lib/actions/refunds-import"
import { REFUNDS_PATH, REFUND_STATUSES, REFUND_STATUS_META, refundFilterQuery } from "@/lib/refunds"
import { REFUND_LOG_MAX_CHARS, refundLogStatus, type RefundLogPreview } from "@/lib/refunds-import"
import { addDays, formatDay, isDay, londonDay } from "@/lib/uncollected"

// Refunds → "Import the old refund log (SharePoint CSV)". Admins only (the actions check again).
//
// Choose the CSV saved from the SharePoint Refund Log → Check file (previewRefundLog: how many rows,
// how many are in already, which are skipped and why, and the statuses they'll get — nothing written)
// → Import N requests. The import goes 50 at a time so the count moves (design rule 7b), with a Stop
// that ends it after the slice in hand and says what was kept; every slice commits, so a failure
// part-way says how many went in and pressing Import again carries on. Importing the same file again
// only ever adds what isn't in yet — a request already in is never changed.
//
// Most of the old log was dealt with ("Liv") but never given a Date processed or Complete for accounts,
// so the preview asks what to do with those: count the ones that came in before a day as done (Paid and
// complete for accounts with an amount, Closed without), or bring them all in open. Without that, three
// hundred finished requests would land in To pay and Being looked at, to be closed one by one.
//
// The file is decoded HERE, not on the server: the old log is Windows-1252 (£ is byte 0xA3, smart
// quotes 0x92–0x94), so it's read as that unless it starts with a UTF-8 BOM or is valid UTF-8 through
// and through (Excel's "CSV UTF-8") — a Windows-1252 £ is never valid UTF-8, so the two can't be confused.

const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"
const cardTitle = "text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
const btn = "inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 text-sm font-semibold rounded-xl border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 bg-white dark:bg-[#1C1C1E] hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
const field = "min-h-11 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-base sm:text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 [color-scheme:light] dark:[color-scheme:dark]"
const inlineLink = "inline-flex items-center min-h-11 font-semibold underline underline-offset-2"
const muted = "text-gray-500 dark:text-gray-400"

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`

/** New requests per import call — each call answers with how many are left. */
const SLICE = 50
/** Skipped rows listed before "Show all". */
const SKIPS_SHOWN = 5
/** The day offered for "came in before": four weeks ago — anything newer may still be being worked. */
const DONE_BEFORE_DAYS = 28

/** The whole list, every status — imported requests are mostly paid (closed), so the default open list
 *  would hide most of them. */
const LIST_HREF = `${REFUNDS_PATH}${refundFilterQuery({ statuses: [...REFUND_STATUSES] })}`

async function readCsv(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder("windows-1252").decode(bytes)
  }
}

/** The statuses the rows will get with this choice for the dealt-with ones (null = bring them in open). */
function statusSplit(p: RefundLogPreview, doneBefore: string | null): Record<string, number> {
  const out: Record<string, number> = { ...p.byStatus }
  for (const d of p.dealt) {
    const s = refundLogStatus({ status: d.status, dealtNotDone: true, receivedAt: d.receivedAt }, doneBefore)
    if (!s.countedDone) continue
    out[d.status] = (out[d.status] ?? 0) - 1
    out[s.status] = (out[s.status] ?? 0) + 1
  }
  return out
}

type Busy = null | "reading" | "checking" | "importing"
type Done = { imported: number; alreadyImported: number; skipped: number; stoppedWith: number | null }

export default function ImportBox() {
  const router = useRouter()
  const [fileName, setFileName] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [preview, setPreview] = useState<RefundLogPreview | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  // The choice for rows dealt with but never processed.
  const [countDone, setCountDone] = useState(true)
  const [doneBefore, setDoneBefore] = useState("")
  // Stop: read by the import loop between slices.
  const stop = useRef(false)
  const [stopping, setStopping] = useState(false)

  async function choose(file: File | null) {
    setText(null); setPreview(null); setError(null); setDone(null); setProgress(null)
    setFileName(file?.name ?? null)
    if (!file) return
    setBusy("reading")
    try {
      const t = await readCsv(file)
      if (t.length > REFUND_LOG_MAX_CHARS) {
        setError(`That file is too big for the refund log — ${REFUND_LOG_MAX_CHARS.toLocaleString("en-GB")} characters at most. Check it's the right file.`)
        return
      }
      if (!t.trim()) { setError("That file is empty — choose the CSV saved from the refund log."); return }
      setText(t)
    } catch {
      setError("This browser couldn't read that file — choose it again.")
    } finally {
      setBusy(null)
    }
  }

  async function check() {
    if (!text || busy) return
    setBusy("checking"); setError(null); setDone(null); setPreview(null)
    try {
      const res = await previewRefundLog(text)
      if (!res.ok) { setError(res.error); return }
      setPreview(res.data)
      if (!doneBefore) setDoneBefore(addDays(londonDay(), -DONE_BEFORE_DAYS))
    } catch {
      setError("The Hub didn't answer — check your connection and press Check file again.")
    } finally {
      setBusy(null)
    }
  }

  async function runImport() {
    if (!text || !preview || busy) return
    const chosen = countDone && preview.dealt.length ? doneBefore : null
    if (chosen != null && !isDay(chosen)) { setError("Pick the day for “came in before” from the calendar first. Nothing was imported."); return }
    setBusy("importing"); setError(null); setDone(null)
    stop.current = false
    setStopping(false)
    let total = 0
    let before: number | null = null
    let skipped = preview.skipped.length
    let left = preview.toImport
    setProgress({ done: 0, of: preview.toImport })
    try {
      for (;;) {
        const res = await importRefundLog(text, SLICE, chosen)
        if (!res.ok) {
          setError(total > 0 ? `${plural(total, "request")} imported first. ${res.error}` : res.error)
          return
        }
        const d = res.data
        if (before == null) before = d.alreadyImported
        skipped = d.skipped
        total += d.imported
        left = d.remaining
        setProgress({ done: total, of: total + d.remaining })
        if (d.remaining === 0) break
        if (stop.current) {
          // Each slice commits — what's in stays in; pressing Import again carries on from here.
          setDone({ imported: total, alreadyImported: before ?? 0, skipped, stoppedWith: left })
          setPreview(null)
          return
        }
        if (d.imported === 0) {
          setError(`${plural(total, "request")} imported, then the rest wouldn't go in. Press Check file to see where it stands.`)
          return
        }
      }
      setDone({ imported: total, alreadyImported: before ?? 0, skipped, stoppedWith: null })
      setPreview(null)
    } catch {
      setError(total > 0
        ? `${plural(total, "request")} imported, then the Hub stopped answering. Press Check file to see where it stands — importing again never adds one twice.`
        : "The Hub didn't answer and nothing was imported — check your connection and try again.")
    } finally {
      setBusy(null)
      setProgress(null)
      setStopping(false)
      if (total > 0) router.refresh()
    }
  }

  const pct = progress && progress.of > 0 ? Math.round((progress.done / progress.of) * 100) : 0
  const choice = preview && preview.dealt.length && countDone && isDay(doneBefore) ? doneBefore : null

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="refund-import-title">
      <h2 id="refund-import-title" className={cardTitle}>Import the old refund log (SharePoint CSV)</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 max-w-3xl">
        Open the SharePoint <b>Refund Log</b> in Excel, save it as <b>CSV</b>, and choose that file. <b>Check file</b> shows
        what would come in — nothing is saved until you press Import. Importing again only adds rows that aren&apos;t in yet:
        a request already in the Hub is never changed.
      </p>

      <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <input
          type="file" accept=".csv,text/csv" disabled={busy != null}
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
          aria-label="The refund log CSV"
          className="file-input min-h-11"
        />
        <button type="button" onClick={check} disabled={!text || busy != null} className={btn}>
          {busy === "checking" ? "Checking…" : busy === "reading" ? "Reading the file…" : "Check file"}
        </button>
        {preview && preview.toImport > 0 && (
          <button type="button" onClick={runImport} disabled={busy != null} className={btnGo}>
            {busy === "importing" ? "Importing…" : `Import ${plural(preview.toImport, "request")}`}
          </button>
        )}
        {busy === "importing" && (
          <button type="button" onClick={() => { stop.current = true; setStopping(true) }} disabled={stopping} className={btn}>
            {stopping ? "Stopping after this batch…" : "Stop"}
          </button>
        )}
      </div>
      {!fileName && <p className={`text-xs mt-2 ${muted}`}>Choose the .csv file first.</p>}

      {progress && (
        <div className="mt-3 text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
          <div className="flex flex-wrap justify-between gap-2 mb-1">
            <span>Importing — {progress.done.toLocaleString("en-GB")} of {progress.of.toLocaleString("en-GB")} in{stopping ? " · stopping after this batch" : ""}</span>
            <span className="font-mono shrink-0">{pct}%</span>
          </div>
          <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {preview && busy !== "importing" && preview.toImport > 0 && preview.dealt.length > 0 && (
        <fieldset className="mt-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100 min-w-0">
          <legend className="px-1 font-semibold">{plural(preview.dealt.length, "row")} {preview.dealt.length === 1 ? "was" : "were"} dealt with but never marked processed</legend>
          <p className="text-xs">
            The old log has a name under <b>Dealt with</b> but no <b>Date processed</b> or <b>Complete for accounts</b> — it rarely
            filled those in. How should {preview.dealt.length === 1 ? "it" : "they"} come in?
          </p>
          <div className="mt-2 space-y-1">
            <label className="flex items-start gap-3 min-h-11 py-1 cursor-pointer">
              <input type="radio" name="refund-import-dealt" checked={countDone} onChange={() => setCountDone(true)} className="mt-1 h-5 w-5 shrink-0 accent-emerald-600" />
              <span>
                <b>Count them as done</b> — the ones that came in before the day below: <b>Paid</b> and complete for accounts when the
                log has an amount, <b>Closed</b> when it hasn&apos;t (with no date processed). Newer ones come in open.
              </span>
            </label>
            {countDone && (
              <label className="flex flex-wrap items-center gap-2 pl-8">
                <span className="text-xs font-semibold">Came in before</span>
                <input type="date" value={doneBefore} onChange={(e) => setDoneBefore(e.target.value)} className={field} />
                {isDay(doneBefore) && (
                  <span className="text-xs">
                    {plural(preview.dealt.filter((d) => d.receivedAt < doneBefore).length, "row")} counted as done,{" "}
                    {plural(preview.dealt.filter((d) => d.receivedAt >= doneBefore).length, "row")} from {formatDay(`${doneBefore}T12:00:00Z`)} on left open
                  </span>
                )}
              </label>
            )}
            <label className="flex items-start gap-3 min-h-11 py-1 cursor-pointer">
              <input type="radio" name="refund-import-dealt" checked={!countDone} onChange={() => setCountDone(false)} className="mt-1 h-5 w-5 shrink-0 accent-emerald-600" />
              <span><b>Bring them all in open</b> — To pay when there&apos;s an amount, Being looked at when there isn&apos;t.</span>
            </label>
          </div>
          <p className="text-xs mt-1">Either way, each one&apos;s timeline says how its status was decided, and any of them can be moved on by hand afterwards.</p>
        </fieldset>
      )}

      {preview && busy !== "importing" && <PreviewNote p={preview} split={statusSplit(preview, choice)} />}

      {done && (
        <p role="status" className="mt-3 rounded-xl border px-4 py-3 text-sm border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200">
          {done.stoppedWith != null ? "Stopped — imported " : "✓ Imported "}{done.imported.toLocaleString("en-GB")}
          {done.alreadyImported > 0 && <> ({done.alreadyImported.toLocaleString("en-GB")} were in already)</>}
          {done.skipped > 0 && <>, {plural(done.skipped, "row")} skipped</>}
          {done.stoppedWith != null && (
            <>; {plural(done.stoppedWith, "row")} not imported yet — everything imported stays in. Press <b>Check file</b> then Import to carry on (none is ever added twice)</>
          )} —{" "}
          <Link href={LIST_HREF} prefetch={false} className={inlineLink}>open the list</Link>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border px-4 py-3 text-sm border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200">
          {error}
        </p>
      )}
    </section>
  )
}

/** "424 rows — 424 to import, 0 already imported, 3 skipped", the statuses they'll get (with the
 *  choice for the dealt-with ones — `split`), and why rows were skipped. */
function PreviewNote({ p, split }: { p: RefundLogPreview; split: Record<string, number> }) {
  const statuses = REFUND_STATUSES.filter((s) => (split[s] ?? 0) > 0)
  const shown = p.skipped.slice(0, SKIPS_SHOWN)
  const rest = p.skipped.slice(SKIPS_SHOWN)
  return (
    <div role="status" className="mt-3 rounded-xl border px-4 py-3 text-sm border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-200 space-y-2">
      <p>
        <b>{plural(p.rows, "row")}</b> — {p.toImport.toLocaleString("en-GB")} to import, {p.alreadyImported.toLocaleString("en-GB")} already
        imported, {p.skipped.length.toLocaleString("en-GB")} skipped
      </p>
      {p.toImport === 0 && (
        <p className="font-semibold">Nothing new to import — {p.rows > 0 ? "every row this file can read is in the Hub already." : "the file has no rows that can be read."}</p>
      )}
      {statuses.length > 0 && (
        <div>
          <p className={`text-xs ${muted}`}>They&apos;ll come in as:</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {statuses.map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={`inline-block w-2.5 h-2.5 rounded-full ${REFUND_STATUS_META[s].dot}`} />
                <span>{REFUND_STATUS_META[s].short}</span>
                <span className="font-mono">{(split[s] ?? 0).toLocaleString("en-GB")}</span>
              </li>
            ))}
          </ul>
          <p className={`text-xs mt-1 ${muted}`}>
            Paid = processed or complete for accounts in the old log (or counted as done, above); Declined = its Solution says no
            refund; Closed = counted as done with no amount; To pay = an amount but not processed; Looking = no amount yet.
          </p>
        </div>
      )}
      {p.bankDetailsRemoved > 0 && (
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
          {plural(p.bankDetailsRemoved, "row")} had what looks like bank or card details in {p.bankDetailsRemoved === 1 ? "it" : "them"} —
          taken out before anything is saved (they&apos;re never kept in the Hub), and {p.bankDetailsRemoved === 1 ? "its" : "each one's"} timeline says so.
        </p>
      )}
      {p.datesFromProcessed > 0 && (
        <p className="text-xs">{plural(p.datesFromProcessed, "row")} had no Date that could be read, so {p.datesFromProcessed === 1 ? "it takes" : "they take"} the Date processed.</p>
      )}
      {p.repeats > 0 && (
        <p className="text-xs">{plural(p.repeats, "row")} {p.repeats === 1 ? "is" : "are"} exactly the same as an earlier row — kept, as each was its own entry in the log (close a duplicate in the Hub).</p>
      )}
      {shown.length > 0 && (
        <div>
          <p className={`text-xs ${muted}`}>Skipped (row numbers as Excel shows them):</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {shown.map((s, i) => <li key={`${s.line}-${i}`}>Row {s.line}: {s.why}</li>)}
          </ul>
          {rest.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer min-h-11 inline-flex items-center text-xs font-semibold text-emerald-700 dark:text-emerald-400">Show the other {rest.length.toLocaleString("en-GB")}</summary>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {rest.map((s, i) => <li key={`${s.line}-${i}`}>Row {s.line}: {s.why}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
