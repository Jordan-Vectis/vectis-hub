"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  LABEL, PER_SHEET, ROOM_PT, SHEET, barNarrowFor, barcodeOf, labelDate, nextFrom, overlapping, readRun, runProblem, runWords,
  type LabelRunRow, type LabelSale,
} from "@/lib/barcode-labels"
import { code39Runs } from "@/lib/code39"

// Admin & Operations → Barcode Labels — the page. Three things to choose (the sale, the numbers, where
// on the first sheet to start) and Print: the PDF opens in a new tab (a form posted inside the tap, as
// the Hub's other label screens do — iPad Safari blocks a tab opened later). The first number follows
// on from the last run printed for that sale; numbers already printed are said, not refused (reprinting
// spoilt labels is normal). Below: a preview of the first label, and what has been printed.

const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"
const field = "min-h-11 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500 [color-scheme:light] dark:[color-scheme:dark]"
const label = "block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1"
const btn = "inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
const btnGo = "inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold disabled:opacity-40"
const chip = "min-h-11 px-3 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
const muted = "text-gray-500 dark:text-gray-400"

/** The "Another sale" choice in the sale box. */
const OTHER = "__other__"

const shortDay = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return ""
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T12:00:00Z`))
}
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

export default function LabelsClient({ sales, runs, logReady, logFailed, today }: {
  sales: LabelSale[] | null; runs: LabelRunRow[]; logReady: boolean; logFailed: boolean; today: string
}) {
  const router = useRouter()
  const list = sales ?? []
  const coming = list.filter(s => s.date >= today)
  const earlier = list.filter(s => s.date < today).reverse()

  // The sale: one from the list, or typed in ("Another sale").
  const [pick, setPick] = useState<string>(coming[0]?.code ?? (list.length ? list[list.length - 1].code : OTHER))
  const [typed, setTyped] = useState("")
  const picked = list.find(s => s.code === pick) ?? null
  const sale = (pick === OTHER ? typed : pick).trim().toUpperCase().replace(/\s+/g, "")
  const [date, setDate] = useState(picked?.date ?? "")
  // Runs printed from this page since it loaded — counted at once, before the log comes back with them.
  const [mine, setMine] = useState<LabelRunRow[]>([])
  const known = useMemo(() => [...mine, ...runs], [mine, runs])
  // The first number: carries on from the last printed for the sale (moving on after each print, and
  // when the log shows someone else's), unless one has been typed (or put back by "Print again").
  const [fromTyped, setFromTyped] = useState<string | null>(null)
  const from = fromTyped ?? String(nextFrom(known, sale))
  const [count, setCount] = useState(String(PER_SHEET * 10))
  const [startAt, setStartAt] = useState("1")
  const [note, setNote] = useState<string | null>(null)
  const busy = useRef(false)
  const lastRefresh = useRef(0)

  /** Choosing a sale fills its date (none for one typed in) and carries on from its last printed number. */
  function choose(code: string) {
    setPick(code)
    setNote(null)
    setFromTyped(null)
    setStartAt("1")
    setDate(list.find(x => x.code === code)?.date ?? "")
  }
  /** A typed code that is one of the listed sales takes its date. */
  function typeSale(v: string) {
    setTyped(v)
    setNote(null)
    setFromTyped(null)
    const s = list.find(x => x.code === v.trim().toUpperCase().replace(/\s+/g, ""))
    if (s) setDate(s.date)
  }

  const run = readRun({ sale, date, from, count, startAt })
  const problem = runProblem(run)
  const already = useMemo(() => {
    if (problem) return []
    // One line per numbers printed (a run printed here and then logged is the same run).
    const seen = new Set<string>()
    return overlapping(known, run.sale, run.from, run.count).filter(r => { const k = `${r.from}-${r.to}`; if (seen.has(k)) return false; seen.add(k); return true })
  }, [problem, known, run.sale, run.from, run.count])

  // Looked at again (after printing in the other tab, or after a while): the log catches up — at most
  // every 30 seconds — so the first number and the "printed before" warning count everyone's prints.
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh.current < 30_000) return
      lastRefresh.current = Date.now()
      router.refresh()
    }
    window.addEventListener("focus", catchUp)
    document.addEventListener("visibilitychange", catchUp)
    return () => { window.removeEventListener("focus", catchUp); document.removeEventListener("visibilitychange", catchUp) }
  }, [router])

  function print(edges: boolean) {
    if (problem || busy.current) return
    busy.current = true
    // A tab of its own, opened now — inside the tap — then the form posted into it.
    const name = `labels-${Date.now().toString(36)}`
    let w: Window | null = null
    try { w = window.open("", name) } catch { w = null }
    if (w) {
      try {
        w.document.title = "Barcode labels"
        w.document.body.style.cssText = "font:16px system-ui,sans-serif;padding:24px;color:#555"
        w.document.body.textContent = "Making the labels…"
      } catch { /* the tab still gets the PDF */ }
    }
    const form = document.createElement("form")
    form.method = "post"
    form.action = "/api/barcodes/labels"
    form.target = name
    form.hidden = true
    const fields: Record<string, string> = { sale: run.sale, date: run.date, from: String(run.from), count: String(run.count), startAt: String(run.startAt), edges: edges ? "1" : "" }
    for (const [k, v] of Object.entries(fields)) {
      const input = document.createElement("input")
      input.type = "hidden"
      input.name = k
      input.value = v
      form.append(input)
    }
    document.body.append(form)
    try { form.submit() } finally { setTimeout(() => form.remove(), 1000) }
    if (!w) {
      setNote("No new tab opened — the browser may have blocked it. Allow pop-ups for the Hub, then press Print again.")
      busy.current = false
      return
    }
    setNote(edges
      ? "A test sheet opened in a new tab — print it on plain paper at Actual size and hold it against a sheet of labels up to the light: the grey boxes should sit on the stickers, with each label's print inside its box. Nothing was logged."
      : `${runWords(run)} opened in a new tab — print it at Actual size. The next labels carry on from ${barcodeOf(run.sale, run.from + run.count)}.`)
    if (!edges) {
      // Counted straight away, so the next print carries on (and a second press doesn't repeat it);
      // the part-used sheet is used up.
      setMine(m => [{ id: `here-${Date.now()}`, sale: run.sale, date: run.date || null, from: run.from, to: run.from + run.count - 1, count: run.count, startAt: run.startAt, byName: "you, just now", at: new Date().toISOString() }, ...m])
      setFromTyped(null)
      setStartAt("1")
    }
    setTimeout(() => { busy.current = false; if (!edges) { lastRefresh.current = Date.now(); router.refresh() } }, 2500)
  }

  /** "Print again": a run from the log back in the boxes. */
  function again(r: LabelRunRow) {
    const listed = list.some(s => s.code === r.sale)
    setPick(listed ? r.sale : OTHER)
    if (!listed) setTyped(r.sale)
    setDate(r.date ?? "")
    setFromTyped(String(r.from))
    setCount(String(r.count))
    setStartAt("1")
    setNote(`${barcodeOf(r.sale, r.from)}${r.count > 1 ? ` – ${barcodeOf(r.sale, r.to)}` : ""} is back in the boxes — press Print to make it again.`)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // What's listed: this sale's runs, else the latest of any (the log is long — the carry-on number and
  // the warning use all of it).
  const saleRuns = runs.filter(r => r.sale === run.sale)
  const shownRuns = (saleRuns.length ? saleRuns : runs).slice(0, 30)

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem] items-start">
      <section className={`${card} p-4 sm:p-6`} aria-label="What to print">
        {/* 1 — the sale */}
        <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3"><Step n={1} /> The sale</h2>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className="block">
            <span className={label}>Sale</span>
            <select value={pick} onChange={e => choose(e.target.value)} className={`${field} w-full`}>
              {coming.length > 0 && (
                <optgroup label="Coming up">
                  {coming.map(s => <option key={s.code} value={s.code}>{saleWords(s)}</option>)}
                </optgroup>
              )}
              {earlier.length > 0 && (
                <optgroup label="Earlier">
                  {earlier.map(s => <option key={s.code} value={s.code}>{saleWords(s)}</option>)}
                </optgroup>
              )}
              <option value={OTHER}>Another sale — type its code…</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Sale date on the labels</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${field} w-full`} />
          </label>
          {pick === OTHER && (
            <label className="block sm:col-span-2">
              <span className={label}>Sale code</span>
              <input value={typed} onChange={e => typeSale(e.target.value)} placeholder="e.g. X160" maxLength={8} autoComplete="off" className={`${field} w-full sm:w-48 font-mono uppercase`} />
            </label>
          )}
        </div>
        {sales === null && <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">The list of sales couldn&apos;t be read just now — choose &ldquo;Another sale&rdquo; and type its code and date.</p>}
        {!date && <p className={`text-xs ${muted} mt-2`}>No date — the labels will have no date line.</p>}

        {/* 2 — the numbers */}
        <h2 className="text-sm font-bold text-gray-900 dark:text-white mt-6 mb-3"><Step n={2} /> The numbers</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className={label}>First number</span>
            <input value={from} onChange={e => setFromTyped(e.target.value)} inputMode="numeric" className={`${field} w-28 tabular-nums`} />
          </label>
          <label className="block">
            <span className={label}>How many labels</span>
            <input value={count} onChange={e => setCount(e.target.value)} inputMode="numeric" className={`${field} w-28 tabular-nums`} />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Whole sheets">
            {[1, 5, 10].map(n => (
              <button key={n} type="button" onClick={() => setCount(String(n * PER_SHEET))} className={chip}>
                {n} sheet{n === 1 ? "" : "s"} ({n * PER_SHEET})
              </button>
            ))}
          </div>
        </div>
        <details className="mt-3 group">
          <summary className={`cursor-pointer select-none min-h-11 inline-flex items-center text-xs font-semibold ${muted}`}>
            Using a sheet with some labels already gone?{run.startAt > 1 ? ` — starting on label ${run.startAt}` : ""}
          </summary>
          <label className="block mt-1">
            <span className={label}>Start on label (1–{PER_SHEET}, counting across then down)</span>
            <input value={startAt} onChange={e => setStartAt(e.target.value)} inputMode="numeric" className={`${field} w-28 tabular-nums`} />
          </label>
        </details>

        {/* What it comes to */}
        <div className="mt-5 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3" aria-live="polite">
          {problem
            ? <p className="text-sm text-amber-700 dark:text-amber-300">{problem}</p>
            : <p className="text-base font-bold text-gray-900 dark:text-white tabular-nums">{runWords(run)}</p>}
          {!problem && already.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              ⚠ Some of these have been printed before —{" "}
              {already.slice(0, 3).map(r => `${barcodeOf(r.sale, r.from)}–${barcodeOf(r.sale, r.to)} (${when(r.at)}, ${r.byName})`).join("; ")}
              {already.length > 3 ? ` and ${already.length - 3} more` : ""}. Printing again makes duplicates — fine for replacing spoilt labels.
            </p>
          )}
        </div>

        {/* 3 — print */}
        <h2 className="text-sm font-bold text-gray-900 dark:text-white mt-6 mb-3"><Step n={3} /> Print</h2>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
          <button type="button" onClick={() => print(false)} disabled={!!problem} className={btnGo}>🖨️ Print the labels</button>
          <button type="button" onClick={() => print(true)} disabled={!!problem} className={btn} title="The same labels with their edges drawn, to print on plain paper and hold against a sheet">
            Test on plain paper
          </button>
        </div>
        <p className={`text-xs ${muted} mt-2 max-w-2xl`}>
          The labels open as a PDF in a new tab. In the print box choose <b>A4</b> and <b>Actual size</b> (100 %) — never &ldquo;Fit to page&rdquo; — and
          load the Avery L7651 sheets (38.1 × 21.2 mm, 65 a sheet).
        </p>
        {note && <p role="status" className="mt-3 rounded-xl border px-4 py-3 text-sm border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-100">{note}</p>}
      </section>

      <div className="grid gap-5">
        {/* The first label, as it prints */}
        <section className={`${card} p-4 sm:p-5`} aria-label="Preview">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3">The first label</h2>
          {problem ? <p className={`text-sm ${muted}`}>Fill in the sale and the numbers to see it.</p> : <LabelPreview code={barcodeOf(run.sale, run.from)} date={labelDate(run.date)} />}
          <p className={`text-xs ${muted} mt-2`}>Actual size 38.1 × 21.2 mm. The barcode is Code 39, the same as the old labels, so the scanners read it as before.</p>
        </section>

        {/* What has been printed */}
        <section className={`${card} p-4 sm:p-5`} aria-label="Printed before">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">{saleRuns.length ? `Printed for ${run.sale}` : "Printed lately"}</h2>
          {logFailed
            ? <p className="text-xs text-amber-700 dark:text-amber-300">What&apos;s been printed couldn&apos;t be read just now — labels print either way.</p>
            : !logReady
              ? <p className={`text-xs ${muted}`}>The list of what&apos;s been printed starts once an admin presses <b>Run Migrations</b> — labels print either way.</p>
              : shownRuns.length === 0
                ? <p className={`text-xs ${muted}`}>Nothing printed yet.</p>
                : (
                  <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
                    {shownRuns.map(r => (
                      <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">{barcodeOf(r.sale, r.from)}{r.count > 1 ? ` – ${barcodeOf(r.sale, r.to)}` : ""}</p>
                          <p className={`text-xs ${muted}`}>{r.count.toLocaleString("en-GB")} label{r.count === 1 ? "" : "s"} · {when(r.at)} · {r.byName}</p>
                        </div>
                        <button type="button" onClick={() => again(r)} className={chip}>Print again</button>
                      </li>
                    ))}
                  </ul>
                )}
        </section>
      </div>
    </div>
  )
}

const saleWords = (s: LabelSale) => [s.code, s.name, shortDay(s.date)].filter(Boolean).join(" — ")

function Step({ n }: { n: number }) {
  return <span className="inline-flex items-center justify-center h-6 w-6 mr-1.5 rounded-full bg-sky-600 text-white text-xs" aria-hidden>{n}</span>
}

/** One label drawn as it prints — the same measurements and bars as the PDF (in points), scaled up. */
function LabelPreview({ code, date }: { code: string; date: string }) {
  const W = SHEET.labelW / 20, H = SHEET.labelH / 20, pad = SHEET.padX / 20
  const unit = barNarrowFor(code) * (72 / 25.4)
  const bars: { x: number; w: number }[] = []
  let x = (SHEET.padX + LABEL.barIndent) / 20
  code39Runs(code).forEach((u, k) => { if (k % 2 === 0) bars.push({ x, w: u * unit }); x += u * unit })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white" role="img" aria-label={`Label ${code}${date ? `, ${date}` : ""}`}>
      {date && <text x={pad} y={LABEL.dateBaseline} fontFamily="Helvetica, Arial, sans-serif" fontSize={LABEL.dateSize} fill="#000">{date}</text>}
      {bars.map((b, i) => <rect key={i} x={b.x} y={LABEL.barTop} width={b.w} height={LABEL.barHeight} fill="#000" />)}
      <text x={(SHEET.padX + LABEL.numberIndent) / 20} y={LABEL.numberBaseline} fontFamily="Helvetica, Arial, sans-serif" fontWeight="bold" fontSize={LABEL.numberSize} textLength={code.length > 7 ? ROOM_PT : undefined} lengthAdjust="spacingAndGlyphs" fill="#000">{code}</text>
    </svg>
  )
}
