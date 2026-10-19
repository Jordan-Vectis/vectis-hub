"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { lookupCode, moveTo, updateContainer } from "@/lib/actions/goods-in"
import { normaliseCode } from "@/lib/goods-in/model"
import ScanInput from "../_components/scan-input"
import { useScanFocus } from "../_components/use-scan-focus"
import { btn, btnGo, mono, ErrorBox } from "../_components/ui"
import { errorBeep } from "../move/beep"
import { kindWord } from "../move/words"

// The Bench screen's moving parts: "Mark catalogued" on each tote, the "Send a tote to a bench"
// scan box, and the refresh button. Everything writes through the Goods In server actions.

/** Mark a tote/pallet at a bench as catalogued (its lots are made) — or take that back. */
export function MarkCatalogued({ id, status, lots }: { id: string; status: string | null; lots: number }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [refreshing, startRefresh] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const done = status === "catalogued"

  const set = async (to: "catalogued" | "bench") => {
    setSaving(true)
    setError(null)
    const res = await updateContainer(id, { status: to })
    setSaving(false)
    setConfirming(false)
    if (!res.ok) { setError(res.error); return }
    startRefresh(() => router.refresh())
  }
  const busy = saving || refreshing

  if (done) {
    return (
      <div className="space-y-2">
        <button type="button" className={btn} disabled={busy} onClick={() => void set("bench")}>
          {busy ? "Saving…" : "Not finished after all"}
        </button>
        {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
      </div>
    )
  }
  if (confirming) {
    // Marking a tote done with nothing made from it is usually a slip — ask, in place (never a pop-up).
    return (
      <div className="w-full rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-3 text-sm space-y-2">
        <p>No lots have been made from <span className={`${mono} font-semibold`}>{id}</span> yet. Mark it catalogued anyway?</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnGo} disabled={busy} onClick={() => void set("catalogued")}>{busy ? "Saving…" : "Yes, mark catalogued"}</button>
          <button type="button" className={btn} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <button type="button" className={btnGo} disabled={busy} onClick={() => (lots === 0 ? setConfirming(true) : void set("catalogued"))}>
        {busy ? "Saving…" : "Mark catalogued"}
      </button>
      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
    </div>
  )
}

type Waiting = { id: string; kind: string; customer: string; what: string; at: string | null }
type Bench = { code: string; name: string | null }
type Msg = { tone: "ok" | "info" | "error"; text: string; link?: { href: string; label: string } }

/** Scan a tote (or pallet) and then a bench — either order — to send it to that bench. */
export function SendToBench() {
  const router = useRouter()
  const box = useRef<HTMLInputElement>(null)
  // Mirrored in refs because scans are queued (see onScan) and each must see what the last left.
  const [tote, setToteState] = useState<Waiting | null>(null)
  const [bench, setBenchState] = useState<Bench | null>(null)
  const live = useRef<{ tote: Waiting | null; bench: Bench | null }>({ tote: null, bench: null })
  const setTote = (v: Waiting | null) => { live.current.tote = v; setToteState(v) }
  const setBench = (v: Bench | null) => { live.current.bench = v; setBenchState(v) }
  const [msg, setMsg] = useState<Msg | null>(null)
  const [working, setWorking] = useState(false)
  const [, startRefresh] = useTransition()
  const chain = useRef<Promise<void>>(Promise.resolve())

  const say = (m: Msg) => { setMsg(m); if (m.tone === "error") errorBeep() }
  const refocus = () => requestAnimationFrame(() => box.current?.focus())
  // After a tap on Mark catalogued, Start again or a link, the next scan still lands in the box.
  useScanFocus(box)

  const send = async (item: string, to: Bench) => {
    const res = await moveTo(item, to.code)
    if (!res.ok) {
      if (/already at/i.test(res.error)) {
        // Not a failure — it is where it was meant to go. Nothing to do, and nothing waiting any more.
        setTote(null)
        setBench(null)
        say({ tone: "info", text: `${res.error} Nothing needed moving.` })
        return
      }
      say({ tone: "error", text: `${res.error} Nothing was moved.` })
      return
    }
    setTote(null)
    setBench(null)
    say({ tone: "ok", text: `${res.data.item} → ${res.data.locationCode} (${kindWord(res.data.kind)})` })
    startRefresh(() => router.refresh())
  }

  // The box hands each scan over and is ready again at once; scans are then dealt with strictly in
  // order, so a tote and a bench scanned back-to-back are never lost or taken the wrong way round.
  const onScan = (raw: string) => {
    chain.current = chain.current.then(async () => {
      setWorking(true)
      try { await handle(raw) } finally { setWorking(false); refocus() }
    })
  }

  const handle = async (raw: string) => {
    const code = normaliseCode(raw)
    const tote = live.current.tote
    const bench = live.current.bench
    try {
      const res = await lookupCode(code)
      if (!res.ok) { say({ tone: "error", text: res.error }); return }
      const hit = res.data
      if (!hit) { say({ tone: "error", text: `Nothing found for ${code} — it isn't a tote, pallet or bench the Hub knows.` }); return }
      if (hit.type === "container") {
        const waiting: Waiting = { id: hit.id, kind: hit.kind, customer: hit.customer, what: [hit.category, hit.description].filter(Boolean).join(" — "), at: hit.locationCode }
        if (bench) { await send(hit.id, bench); return }
        setTote(waiting)
        setMsg(null)
        return
      }
      if (hit.type === "location") {
        if (hit.kind !== "bench") {
          say({
            tone: "error",
            text: `${hit.code} is a ${kindWord(hit.kind)} location, not a bench.${tote ? ` ${tote.id} has not been moved.` : ""} To put something anywhere other than a bench, use Move.`,
            link: { href: tote ? `/tools/warehouse/move?item=${encodeURIComponent(tote.id)}` : "/tools/warehouse/move", label: "Open Move" },
          })
          return
        }
        const b = { code: hit.code, name: hit.name }
        if (tote) { await send(tote.id, b); return }
        setBench(b)
        setMsg(null)
        return
      }
      if (hit.type === "lot") {
        say({ tone: "error", text: `${hit.barcode} is a lot, not a tote. Finished lots go on a shelf — use Move for that.`, link: { href: `/tools/warehouse/move?item=${encodeURIComponent(hit.barcode)}`, label: "Move this lot" } })
        return
      }
      if (hit.type === "receipt") {
        say({ tone: "error", text: `${hit.id} is a receipt, not a tote. Scan the label on the tote or pallet itself.` })
        return
      }
      say({ tone: "error", text: `${hit.vendorNo ?? code} is ${hit.name}'s vendor number, not a tote. Scan the label on the tote or pallet itself.` })
    } catch (e) {
      say({ tone: "error", text: `That didn't go through — scan it again. Nothing was moved. (${String((e as Error)?.message ?? e).slice(0, 140)})` })
    }
  }

  const clear = () => { setTote(null); setBench(null); setMsg(null); refocus() }

  const placeholder = tote ? `Now scan the bench for ${tote.id}` : bench ? `Now scan the tote or pallet for ${bench.code}` : "Scan a tote or pallet, then the bench"

  return (
    <div className="space-y-3">
      <ScanInput ref={box} id="send-to-bench" label="Send a tote to a bench" placeholder={placeholder} onScan={onScan} autoFocus />
      {working && <p className="text-xs font-medium text-gray-500 dark:text-gray-400" aria-live="polite">Checking the scan…</p>}
      {(tote || bench) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-950/30 px-4 py-3 text-sm text-gray-800 dark:text-gray-100">
          {tote ? (
            <p className="min-w-0 flex-1">
              <span className={`${mono} text-lg font-bold`}>{tote.id}</span> · {tote.customer}
              {tote.what && <> · {tote.what}</>}
              <span className="block text-xs text-gray-600 dark:text-gray-300">{tote.at ? `Now at ${tote.at}.` : "Not put anywhere yet."} Scan the bench it is going to.</span>
            </p>
          ) : bench ? (
            <p className="min-w-0 flex-1">
              Sending to <span className={`${mono} text-lg font-bold`}>{bench.code}</span>{bench.name ? ` (${bench.name})` : ""}
              <span className="block text-xs text-gray-600 dark:text-gray-300">Scan the tote or pallet that is going there.</span>
            </p>
          ) : null}
          <button type="button" className={btn} onClick={clear}>Start again</button>
        </div>
      )}
      {msg && (
        <div
          role={msg.tone === "error" ? "alert" : "status"}
          className={`rounded-lg border-2 px-4 py-3 ${msg.tone === "ok" ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-100" : msg.tone === "error" ? "border-red-500 bg-red-50 text-red-900 dark:border-red-600 dark:bg-red-950/40 dark:text-red-100" : "border-gray-300 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"}`}
        >
          <p className={msg.tone === "ok" ? `${mono} text-xl sm:text-2xl font-bold break-words` : "text-sm font-medium"}>{msg.text}</p>
          {msg.link && <Link href={msg.link.href} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold underline">{msg.link.label}</Link>}
        </div>
      )}
    </div>
  )
}

/** Refresh the board now, and every two minutes while the screen is being looked at. */
export function RefreshButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") start(() => router.refresh())
    }, 120_000)
    return () => clearInterval(t)
  }, [router])
  return (
    <button type="button" className={btn} disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  )
}
