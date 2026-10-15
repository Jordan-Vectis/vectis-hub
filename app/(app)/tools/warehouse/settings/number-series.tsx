"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { clearCounter, setCounter } from "@/lib/actions/goods-in"
import { formatNumber, type CounterKey } from "@/lib/goods-in/model"
import { box, btn, btnDanger, btnGo, ErrorBox, input, label, mono, OkBox, ukDate, ukDateTime } from "../_components/ui"

// Goods In → Settings → Number series. One card per series (receipts, totes, pallets, vendor
// numbers): what it will hand out next, and a form to set where it carries on from. The numbers
// are taken atomically on the server (lib/goods-in/numbers.ts); this only sets the starting point.
// The vendor series alone can be switched off again (it is optional — see its warning), so one set
// by mistake doesn't hand every new customer a number from then on.

export type SeriesItem = {
  key: CounterKey
  label: string
  defaultPrefix: string
  defaultWidth: number
  example: string
  current: { prefix: string; next: number; width: number; nextNumber: string; updatedAt: string | null; updatedBy: string | null } | null
  /** The most recent one booked in here, if any. */
  last: { id: string; at: string } | null
}

const ONE: Record<CounterKey, string> = { receipt: "receipt", tote: "tote", pallet: "pallet", vendor: "vendor number" }

const UNSET: Record<CounterKey, string> = {
  receipt: "Not set — booking in is blocked until receipts and totes are set.",
  tote: "Not set — booking in is blocked until receipts and totes are set.",
  pallet: "Not set — pallets can't be booked in until this is set (totes still can, once receipts and totes are set).",
  vendor: "Not set — receipts carry no vendor number unless the customer already has one.",
}

/** "R010244" → { prefix: "R", digits: "010244" }; "10244" → { digits: "10244" }. */
function splitTyped(s: string): { prefix: string | null; digits: string } | null {
  const m = s.trim().toUpperCase().replace(/\s+/g, "").match(/^([A-Z]{1,3})?(\d+)$/)
  return m ? { prefix: m[1] ?? null, digits: m[2] } : null
}

function SeriesCard({ item }: { item: SeriesItem }) {
  const router = useRouter()
  const c = item.current
  const [prefix, setPrefix] = useState(c?.prefix ?? item.defaultPrefix)
  const [next, setNext] = useState(c ? String(c.next) : "")
  const [width, setWidth] = useState(String(c?.width ?? item.defaultWidth))
  const [confirming, setConfirming] = useState(false)
  const [ackC, setAckC] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)

  const stop = async () => {
    if (stopping) return
    setStopping(true); setError(null); setOk(null)
    const res = await clearCounter(item.key)
    setStopping(false)
    setConfirmStop(false)
    if (!res.ok) { setError(res.error); return }
    setOk("Switched off — new customers won't be given a vendor number. Numbers already given stay on their customers.")
    router.refresh()
  }

  // Someone may type or paste the whole number ("R010244") into the number box — split it into its parts.
  const tidyNext = () => {
    const t = splitTyped(next)
    if (!t) return
    if (t.prefix) {
      setPrefix(t.prefix)
      if (t.digits.length >= 3 && t.digits.length <= 9) setWidth(String(t.digits.length))
    }
    setNext(String(Number(t.digits)))
  }

  const p = prefix.trim().toUpperCase()
  const typed = splitTyped(next)
  const nNext = typed ? Number(typed.digits) : NaN
  const nWidth = Number(width)
  const problem =
    !/^[A-Z]{1,3}$/.test(p) ? "The prefix is one to three letters." :
    !next.trim() ? `Type the number the next ${ONE[item.key]} should have.` :
    !typed || !Number.isSafeInteger(nNext) || nNext < 1 ? "The next number must be a whole number, 1 or more." :
    !Number.isInteger(nWidth) || nWidth < 3 || nWidth > 9 ? "The number of digits must be between 3 and 9." :
    null
  const preview = problem ? null : formatNumber(p, nNext, nWidth)
  const tooLong = !problem && String(nNext).length > nWidth
  const unchanged = !!c && !problem && c.prefix === p && c.next === nNext && c.width === nWidth

  // Setting it at or below one already handed out here: safe (used numbers are skipped), but worth saying.
  const lastSplit = item.last ? splitTyped(item.last.id) : null
  const atOrBelowLast = !problem && !!lastSplit && lastSplit.prefix === p && nNext <= Number(lastSplit.digits)
  const vendorC = item.key === "vendor" && p === "C"

  const save = async () => {
    if (problem || saving) return
    if (vendorC && !ackC) { setError("Tick the box to say you understand the C-number risk, or use a different letter."); return }
    if (c && !confirming) { setConfirming(true); setError(null); return }
    setSaving(true); setError(null); setOk(null)
    const res = await setCounter(item.key, { prefix: p, next: nNext, width: nWidth })
    setSaving(false)
    setConfirming(false)
    if (!res.ok) { setError(res.error); return }
    setOk(`Saved — the next ${ONE[item.key]} will be ${preview}.`)
    router.refresh()
  }

  return (
    <section className={`${box} p-4 sm:p-5 flex flex-col gap-4`} aria-labelledby={`series-${item.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`series-${item.key}`} className="text-base font-semibold text-gray-900 dark:text-white">{item.label}</h3>
        {c
          ? <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800">Set</span>
          : <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800">Not set</span>}
      </div>

      {c ? (
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Next number it will give</p>
          <p className={`${mono} text-3xl font-bold text-gray-900 dark:text-white`}>{c.nextNumber}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Prefix <b className={mono}>{c.prefix}</b> · next <b className={mono}>{c.next.toLocaleString("en-GB")}</b> · {c.width} digits
            {c.updatedAt && <> · last set {c.updatedBy ? `by ${c.updatedBy} ` : ""}on {ukDateTime(c.updatedAt)}</>}
          </p>
        </div>
      ) : (
        <p className={`rounded-lg border px-3 py-2 text-sm ${item.key === "receipt" || item.key === "tote" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200" : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300"}`}>
          {UNSET[item.key]}
        </p>
      )}

      {item.last && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Last one booked in here: <b className={`${mono} text-gray-700 dark:text-gray-200`}>{item.last.id}</b> on {ukDate(item.last.at)}</p>
      )}

      {item.key === "vendor" && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm leading-relaxed">
          <b>Careful with vendor numbers.</b> BC still gives out C-numbers to people who sign up on the website, so carrying the C-series on here could give two customers the same number. Leave this unset (receipts then carry no vendor number) or use a different letter.
        </div>
      )}

      <div className="grid grid-cols-[5.5rem_1fr_5.5rem] gap-2 sm:gap-3 items-end">
        <div>
          <label htmlFor={`pfx-${item.key}`} className={label}>Prefix</label>
          <input id={`pfx-${item.key}`} className={`${input} ${mono} uppercase`} value={prefix} maxLength={3} autoCapitalize="characters" autoComplete="off" spellCheck={false}
            onChange={e => { setPrefix(e.target.value.replace(/[^A-Za-z]/g, "")); setConfirming(false); setOk(null) }} />
        </div>
        <div>
          <label htmlFor={`next-${item.key}`} className={label}>Next number</label>
          <input id={`next-${item.key}`} className={`${input} ${mono}`} value={next} inputMode="numeric" autoComplete="off" spellCheck={false}
            placeholder={`e.g. ${item.example.replace(/^[A-Z]+0*/, "")}`}
            onChange={e => { setNext(e.target.value); setConfirming(false); setOk(null) }}
            onBlur={tidyNext}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); tidyNext() } }} />
        </div>
        <div>
          <label htmlFor={`w-${item.key}`} className={label}>Digits</label>
          <input id={`w-${item.key}`} className={`${input} ${mono}`} value={width} inputMode="numeric" maxLength={1} autoComplete="off"
            onChange={e => { setWidth(e.target.value.replace(/\D/g, "")); setConfirming(false); setOk(null) }} />
        </div>
      </div>

      <div className="text-sm">
        {problem
          ? <p className="text-gray-500 dark:text-gray-400">{problem}</p>
          : <p className="text-gray-700 dark:text-gray-200">With these, the next {ONE[item.key]} will be <b className={`${mono} text-base text-gray-900 dark:text-white`}>{preview}</b>{unchanged ? " — that's what it's set to now." : "."}</p>}
        {tooLong && <p className="mt-1 text-amber-800 dark:text-amber-200">That number has more than {nWidth} digits, so it will print longer than the others. Check the number of digits.</p>}
        {atOrBelowLast && (
          <p className="mt-1 text-amber-800 dark:text-amber-200">
            {item.last!.id} has already been given here. Numbers already used are skipped, never reused — but set it after the last one given, or booking in will step through the used ones.
          </p>
        )}
      </div>

      {vendorC && (
        <label className="flex items-start gap-3 min-h-11 cursor-pointer rounded-lg border border-amber-400 px-3 py-2">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-amber-600" checked={ackC} onChange={e => setAckC(e.target.checked)} />
          <span className="text-sm text-amber-900 dark:text-amber-200">I understand BC also hands out C-numbers for website sign-ups, and this could give two customers the same vendor number.</span>
        </label>
      )}

      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
      {ok && <OkBox>{ok}</OkBox>}

      {item.key === "vendor" && c && !confirming && (
        confirmStop ? (
          <div role="alertdialog" aria-labelledby="stop-vendor-title" className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-3 space-y-3">
            <p id="stop-vendor-title" className="text-sm text-red-800 dark:text-red-200">
              Stop giving vendor numbers? From now on a customer without one is booked in with none, as before this was set. Numbers already given ({c.prefix}…) stay on their customers.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="inline-flex items-center justify-center min-h-11 px-5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-40" onClick={() => void stop()} disabled={stopping}>
                {stopping ? "Switching off…" : "Yes, stop giving them"}
              </button>
              <button type="button" className={btn} onClick={() => setConfirmStop(false)} disabled={stopping}>Keep it on</button>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" className={btnDanger} onClick={() => { setConfirmStop(true); setError(null); setOk(null) }}>Stop giving vendor numbers</button>
          </div>
        )
      )}

      {confirming && c && preview ? (
        <div className="rounded-lg border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-3 space-y-3">
          <p className="text-sm text-gray-800 dark:text-gray-100">
            Change {item.label.toLowerCase()} from <b className={mono}>{c.nextNumber}</b> to <b className={mono}>{preview}</b>? The next {ONE[item.key]} booked in anywhere gets {preview}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGo} onClick={save} disabled={saving}>{saving ? "Saving…" : "Yes, change it"}</button>
            <button type="button" className={btn} onClick={() => setConfirming(false)} disabled={saving}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className={btnGo} onClick={save} disabled={!!problem || saving || unchanged || (vendorC && !ackC)}>
            {saving ? "Saving…" : c ? `Change ${item.label.toLowerCase()}` : `Set ${item.label.toLowerCase()}`}
          </button>
        </div>
      )}
    </section>
  )
}

export default function NumberSeries({ items }: { items: SeriesItem[] }) {
  const blocked = items.filter(i => (i.key === "receipt" || i.key === "tote") && !i.current)
  return (
    <section aria-labelledby="numbers-heading" className="space-y-4">
      <div>
        <h2 id="numbers-heading" className="text-lg font-semibold text-gray-900 dark:text-white">Number series</h2>
        <div className="text-sm text-gray-600 dark:text-gray-300 mt-1 max-w-3xl leading-relaxed space-y-2">
          <p>
            Carry on from Business Central&apos;s numbers: set each one to the number AFTER the last one BC gave (e.g. if BC&apos;s last receipt was R010243, set the next receipt to 10244).
            Set these on the day BC stops booking goods in, or two receipts could get the same number.
          </p>
          <p className="text-gray-500 dark:text-gray-400">You can type the whole number (R010244) in the number box and it is split into its prefix and digits for you.</p>
        </div>
      </div>
      {blocked.length > 0 && (
        <div role="status" className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-3 text-sm">
          <b>Booking in is blocked</b> until receipts and totes are set — {blocked.map(b => b.label.toLowerCase()).join(" and ")} {blocked.length === 1 ? "isn't" : "aren't"} set yet.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map(i => <SeriesCard key={i.key} item={i} />)}
      </div>
    </section>
  )
}
