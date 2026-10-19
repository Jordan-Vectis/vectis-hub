"use client"

import Link from "next/link"
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
import { lookupCode, moveTo, type ScanHit } from "@/lib/actions/goods-in"
import { normaliseCode, type LocationKind } from "@/lib/goods-in/model"
import ScanInput from "../_components/scan-input"
import { box, btn, mono, KindBadge } from "../_components/ui"
import { errorBeep } from "./beep"
import { clock, kindWord, plural, statusWord } from "./words"

// The Move screen's working part. Two scan boxes — the thing, then where it is going — but every
// scan goes through ONE handler that works out what was scanned, so a scan landing in the "wrong"
// box still does the right thing:
//   · a tote, pallet or lot with nothing waiting  → it waits for a location
//   · a location with something waiting          → the move happens
//   · a location with nothing waiting            → that location is KEPT for a run
//   · a tote, pallet or lot with a location kept → moved straight there
//   · a second item while one waits              → the new one waits instead (nothing moved)
// Scans are handled strictly one after another in a queue: a hand scanner can fire the next code
// before the last one has been answered, and that scan must neither be lost nor overtake.

type ItemHit = Extract<ScanHit, { type: "container" | "lot" }>
type Place = { code: string; name: string | null; kind: LocationKind }
type Step = "item" | "place"
type Notice = { tone: "ok" | "warn" | "error"; line: string; detail?: string; link?: { href: string; label: string } }
type Moved = { n: number; item: string; what: string; to: string; toKind: LocationKind; from: string | null; at: number; putBack: boolean }

const codeOf = (h: ItemHit) => (h.type === "container" ? h.id : h.barcode)

/** One line saying what the thing is: "Tote · J Smith · Comics — 5x boxes of comics". */
function describe(h: ItemHit) {
  if (h.type === "container") {
    const what = [h.category, h.description].filter(Boolean).join(" — ")
    return [h.kind === "pallet" ? "Pallet" : "Tote", h.customer, what].filter(Boolean).join(" · ")
  }
  return ["Lot", h.title, h.auction ? `sale ${h.auction}` : null].filter(Boolean).join(" · ")
}

export default function MoveScreen({ initialItem, initialTo }: { initialItem: string | null; initialTo: string | null }) {
  const itemBox = useRef<HTMLInputElement>(null)
  const placeBox = useRef<HTMLInputElement>(null)

  // What the screen shows, mirrored in a ref: queued scans run after the render that queued them,
  // and each must see what the scan before it left behind — not a stale copy from its closure.
  const [pending, setPendingState] = useState<ItemHit | null>(null)
  const [keep, setKeepState] = useState(false)
  const [pinned, setPinnedState] = useState<Place | null>(null)
  const live = useRef<{ pending: ItemHit | null; keep: boolean; pinned: Place | null }>({ pending: null, keep: false, pinned: null })
  const setPending = (v: ItemHit | null) => { live.current.pending = v; setPendingState(v) }
  const setKeep = (v: boolean) => { live.current.keep = v; setKeepState(v) }
  const setPinned = (v: Place | null) => { live.current.pinned = v; setPinnedState(v) }

  const [notice, setNotice] = useState<Notice | null>(null)
  const [log, setLog] = useState<Moved[]>([])
  const [working, setWorking] = useState<string | null>(null)
  const [queued, setQueued] = useState(0)
  const [sound, setSound] = useState(true)
  const soundOn = useRef(true)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const seq = useRef(0)
  const started = useRef(false)

  const stepNow = (): Step => (live.current.pending || (live.current.keep && !live.current.pinned) ? "place" : "item")
  const focusNext = () => requestAnimationFrame(() => (stepNow() === "place" ? placeBox : itemBox).current?.focus())

  const fail = (line: string, detail?: string, link?: Notice["link"]) => {
    setNotice({ tone: "error", line, detail, link })
    if (soundOn.current) errorBeep()
  }

  const record = (m: Omit<Moved, "n" | "at">) => {
    const n = ++seq.current
    const at = Date.now()
    setLog(l => [{ ...m, n, at }, ...l].slice(0, 300))
  }

  /** Run one piece of work after everything already queued, then put the cursor where the next scan goes. */
  const run = (label: string, task: () => Promise<void>) => {
    setQueued(n => n + 1)
    chain.current = chain.current.then(async () => {
      setWorking(label)
      try {
        await task()
      } catch (e) {
        fail("That didn't go through — scan it again", `The Hub couldn't be reached or answered with an error (${String((e as Error)?.message ?? e).slice(0, 140)}). Nothing was moved.`)
      } finally {
        setWorking(null)
        setQueued(n => n - 1)
        focusNext()
      }
    })
  }

  const move = async (item: ItemHit, place: Place) => {
    const code = codeOf(item)
    const res = await moveTo(code, place.code)
    if (!res.ok) {
      if (/already at/i.test(res.error)) {
        setPending(null)
        if (live.current.keep) setPinned(place)
        setNotice({
          tone: "warn",
          line: res.error,
          detail: live.current.keep
            ? "Nothing needed moving. To put it somewhere else instead, press Put back in the list, or switch off Keep this location and scan it again."
            : "Nothing needed moving.",
        })
        return
      }
      const kept = live.current.keep && live.current.pinned
      return fail(res.error, kept ? `${code} was not moved.` : `${code} was not moved and is still waiting — scan a different location, or press "Not this one".`)
    }
    setPending(null)
    if (live.current.keep) setPinned(place)
    const { item: moved, locationCode, kind } = res.data
    const from = item.locationCode
    setNotice({
      tone: "ok",
      line: `${moved} → ${locationCode} (${kindWord(kind)})`,
      detail: `${describe(item)}${from ? ` — was at ${from}` : ""}. ${!live.current.keep ? "Wrong place? Scan it again to put it somewhere else." : from ? "Wrong place? Press Put back in the list." : "Wrong place? Switch off Keep this location and scan it again."}`,
    })
    record({ item: moved, what: describe(item), to: locationCode, toKind: kind, from, putBack: false })
  }

  const handle = async (raw: string) => {
    const code = normaliseCode(raw)
    if (!code) return
    const res = await lookupCode(code)
    if (!res.ok) return fail(res.error)
    const hit = res.data
    const waiting = live.current.pending
    if (!hit) {
      return fail(
        `Nothing found for ${code}`,
        waiting
          ? `It isn't a location, tote, pallet or lot the Hub knows. ${codeOf(waiting)} is still waiting — scan the location label again, or type its code.`
          : "It isn't a tote, pallet, lot barcode or location the Hub knows. Check the label and scan again, or type the code.",
      )
    }
    switch (hit.type) {
      case "location": {
        const place: Place = { code: hit.code, name: hit.name, kind: hit.kind }
        if (waiting) return move(waiting, place)
        setKeep(true)
        setPinned(place)
        setNotice({ tone: "ok", line: `Keeping ${place.code} (${kindWord(place.kind)})`, detail: "Now scan each tote, pallet or lot — every one goes straight there." })
        return
      }
      case "receipt":
        return fail(
          `${hit.id} is a receipt, not a tote`,
          `It's ${hit.customer}'s receipt with ${plural(hit.containers, "tote or pallet", "totes and pallets")}. Scan the label on the tote or pallet itself.`,
          { href: `/tools/warehouse/receipts/${encodeURIComponent(hit.id)}`, label: `Open receipt ${hit.id}` },
        )
      case "customer":
        return fail(`${hit.vendorNo ?? code} is a customer's vendor number`, `That's ${hit.name}. Scan the label on the tote, pallet or lot instead.`)
      default: {
        const kept = live.current.keep ? live.current.pinned : null
        if (kept) {
          setPending(null)
          return move(hit, kept)
        }
        setPending(hit)
        if (waiting && codeOf(waiting) !== codeOf(hit)) {
          setNotice({ tone: "warn", line: `Now moving ${codeOf(hit)} instead`, detail: `Nothing was moved — ${codeOf(waiting)} stays where it was. Scan the location for ${codeOf(hit)}.` })
        } else {
          setNotice(null)
        }
      }
    }
  }

  const scan = (raw: string) => run(normaliseCode(raw), () => handle(raw))

  const putBack = (m: Moved) => {
    const back = m.from
    if (!back) return
    run(m.item, async () => {
      const res = await moveTo(m.item, back)
      if (!res.ok) return fail(res.error, `${m.item} was not put back.`)
      setNotice({ tone: "ok", line: `${res.data.item} → ${res.data.locationCode} (${kindWord(res.data.kind)})`, detail: `Put back where it was. ${m.what}` })
      record({ item: res.data.item, what: m.what, to: res.data.locationCode, toKind: res.data.kind, from: m.to, putBack: true })
    })
  }

  const toggleKeep = () => {
    const on = !live.current.keep
    setKeep(on)
    if (!on) setPinned(null)
    setNotice(null)
    focusNext()
  }
  const changePinned = () => { setPinned(null); setNotice(null); focusNext() }
  const clearPending = () => { setPending(null); setNotice(null); focusNext() }
  const toggleSound = () => { soundOn.current = !soundOn.current; setSound(soundOn.current); focusNext() }

  // Opened from a link with ?item= or ?to= — treat it as the first scan. (Once only: React runs
  // effects twice in development.)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const first = initialItem || initialTo
    if (first) scan(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A scanner "types" into whatever has focus. If someone has tapped a button or the page, the
  // first character of the next scan pulls the cursor back into the box the scan belongs in —
  // otherwise the scanner's Enter would press whichever button was last tapped.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === " ") return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return
      const target = live.current.pending || (live.current.keep && !live.current.pinned) ? placeBox : itemBox
      target.current?.focus()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  const step: Step = pending || (keep && !pinned) ? "place" : "item"
  const prompt = pending
    ? `Now scan the location for ${codeOf(pending)}.`
    : keep && pinned
      ? `Scan the next tote, pallet or lot — it goes straight to ${pinned.code}.`
      : keep
        ? "Scan the location to keep."
        : "Scan a tote, pallet or lot — or scan a location first to keep it for a run."

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      <div className="space-y-4 min-w-0">
        <ResultPanel notice={notice} prompt={prompt} working={working} queued={queued} />

        <StepBox n={1} active={step === "item"} title="Scan a tote, pallet or lot">
          <ScanInput ref={itemBox} id="move-item" placeholder="Tote, pallet or lot barcode" onScan={scan} autoFocus={!initialItem && !initialTo} />
          {pending && <ItemCard hit={pending} onClear={clearPending} />}
          {!pending && keep && pinned && (
            <p className="text-sm text-gray-600 dark:text-gray-300">Each one you scan goes straight to <span className={`${mono} font-semibold`}>{pinned.code}</span>.</p>
          )}
        </StepBox>

        <StepBox n={2} active={step === "place"} title={keep && pinned ? "Scan a different location to keep that one instead" : "Scan the location"}>
          {keep && pinned && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Keeping</p>
                <p className="text-gray-900 dark:text-white">
                  <span className={`${mono} text-2xl font-bold`}>{pinned.code}</span>{" "}
                  <span className="text-sm text-gray-600 dark:text-gray-300">({kindWord(pinned.kind)}{pinned.name ? ` · ${pinned.name}` : ""})</span>
                </p>
              </div>
              <button type="button" className={btn} onClick={changePinned}>Change location</button>
            </div>
          )}
          <ScanInput ref={placeBox} id="move-place" placeholder="Location, e.g. BENCH12 or A10A1" onScan={scan} />
          <button
            type="button"
            role="switch"
            aria-checked={keep}
            onClick={toggleKeep}
            className={`w-full flex items-center gap-4 min-h-14 rounded-lg border px-4 py-2 text-left transition-colors ${keep ? "border-indigo-400 dark:border-indigo-600 bg-white dark:bg-gray-900" : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
          >
            <span className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${keep ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"}`}>
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${keep ? "translate-x-5" : "translate-x-0.5"}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-gray-900 dark:text-white">Keep this location</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {keep ? "On — every tote, pallet or lot you scan goes straight to the kept location." : "Off — scan a location after each item."}
              </span>
            </span>
          </button>
        </StepBox>
      </div>

      <section className={`${box} min-w-0 overflow-hidden`} aria-label="Moved this visit">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
          <h2 className="flex-1 font-semibold text-gray-900 dark:text-white">
            Moved this visit <span className="font-normal text-gray-500 dark:text-gray-400">({log.length})</span>
          </h2>
          <button type="button" role="switch" aria-checked={sound} className={btn} onClick={toggleSound}>
            Sound on errors: {sound ? "on" : "off"}
          </button>
        </div>
        <p className="px-4 pt-3 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Newest first. Moved the wrong thing? <b className="text-gray-700 dark:text-gray-200">Scan it again to put it somewhere else</b>, or press <b className="text-gray-700 dark:text-gray-200">Put back</b>. This list is only on this screen and clears when you leave; every move is kept in{" "}
          <Link href="/tools/warehouse/history" target="_blank" className="underline">History</Link>.
        </p>
        {log.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">Nothing moved yet this visit.</p>
        ) : (
          <ol className="mt-2 divide-y divide-gray-200 dark:divide-gray-800">
            {log.map((m, i) => {
              const latestForItem = log.findIndex(x => x.item === m.item) === i
              return (
                <li key={m.n} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{clock(m.at)}</span>
                  <span className={`${mono} font-bold text-gray-900 dark:text-white`}>{m.item}</span>
                  <span aria-hidden className="text-gray-400">→</span>
                  <span className={`${mono} font-bold text-gray-900 dark:text-white`}>{m.to}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">({kindWord(m.toKind)})</span>
                  {m.putBack && <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">put back</span>}
                  {latestForItem && m.from && (
                    <button type="button" className={`${btn} ml-auto`} onClick={() => putBack(m)} disabled={queued > 0}>
                      Put back at <span className={mono}>{m.from}</span>
                    </button>
                  )}
                  <p className="basis-full text-xs text-gray-500 dark:text-gray-400 break-words">
                    {m.what}{m.from ? ` · was at ${m.from}` : " · wasn't anywhere before"}
                  </p>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

function ResultPanel({ notice, prompt, working, queued }: { notice: Notice | null; prompt: string; working: string | null; queued: number }) {
  const tone = !notice
    ? "border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
    : notice.tone === "ok"
      ? "border-emerald-500 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100"
      : notice.tone === "warn"
        ? "border-amber-500 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100"
        : "border-red-500 dark:border-red-600 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-100"
  const waitingAfter = Math.max(0, queued - 1)
  return (
    <div role={notice?.tone === "error" ? "alert" : "status"} aria-live="polite" className={`rounded-xl border-2 px-4 py-4 sm:px-5 min-h-32 flex flex-col justify-center ${tone}`}>
      {notice ? (
        <>
          <p className={`${notice.tone === "ok" ? mono : ""} text-2xl sm:text-3xl font-bold leading-tight break-words`}>{notice.line}</p>
          {notice.detail && <p className="mt-1.5 text-sm leading-relaxed opacity-90">{notice.detail}</p>}
          {notice.link && (
            <Link href={notice.link.href} target="_blank" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline">
              {notice.link.label}
            </Link>
          )}
          <p className="mt-2 text-sm font-semibold">Next: {prompt}</p>
        </>
      ) : (
        <p className="text-lg sm:text-xl font-semibold">{prompt}</p>
      )}
      <p className="mt-1 min-h-5 text-xs font-medium" aria-live="polite">
        {working ? `Working on ${working}…${waitingAfter ? ` ${plural(waitingAfter, "more scan")} waiting.` : ""}` : ""}
      </p>
    </div>
  )
}

function StepBox({ n, active, title, children }: { n: number; active: boolean; title: string; children: ReactNode }) {
  return (
    <section className={`rounded-xl border-2 p-4 space-y-3 transition-colors ${active ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
      <div className="flex items-center gap-3">
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${active ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200"}`}>{n}</span>
        <h2 className="flex-1 text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
        {active && <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300 whitespace-nowrap">Scan here next</span>}
      </div>
      {children}
    </section>
  )
}

function ItemCard({ hit, onClear }: { hit: ItemHit; onClear: () => void }) {
  const code = codeOf(hit)
  const rows: [string, ReactNode][] =
    hit.type === "container"
      ? [
          ["Customer", hit.customer],
          ["Receipt", <span key="r" className={mono}>{hit.receiptId}</span>],
          ["Category", hit.category ?? "—"],
          ["Description", hit.description ?? "—"],
          ["Status", statusWord(hit.status)],
          ["Now at", hit.locationCode ? <span key="l" className={`${mono} font-semibold`}>{hit.locationCode}</span> : "Not put anywhere yet"],
        ]
      : [
          ["Title", hit.title],
          ["Sale", hit.auction ? <span key="a" className={mono}>{hit.auction}</span> : "—"],
          ["Tote", hit.tote ? <span key="t" className={mono}>{hit.tote}</span> : "—"],
          ["Receipt", hit.receipt ? <span key="r" className={mono}>{hit.receipt}</span> : "—"],
          ["Shelf now", hit.locationCode ? <span key="l" className={`${mono} font-semibold`}>{hit.locationCode}</span> : "Not shelved yet"],
        ]
  return (
    <div className={`${box} p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${mono} text-2xl font-bold text-gray-900 dark:text-white`}>{code}</span>
        {hit.type === "container" ? (
          <KindBadge kind={hit.kind} />
        ) : (
          <span className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Lot</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href={`/tools/warehouse/find?q=${encodeURIComponent(code)}`} target="_blank" className={btn}>Details</Link>
          <button type="button" className={btn} onClick={onClear}>Not this one</button>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
            <dd className="text-gray-900 dark:text-gray-100 break-words">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}
