"use client"

import { useState, type ReactNode } from "react"
import { saveAgreement, type CustomerAgreement } from "@/lib/actions/goods-in-agreement"
import type { Result } from "@/lib/actions/goods-in"
import { DEFAULT_TERMS, SPECIAL_ARRANGEMENT_MAX as MAX_ARRANGEMENT } from "@/lib/goods-in/model"
import { box, btn, btnGo, btnDanger, input, mono, ErrorBox, ukDate, ukDateTime } from "../../_components/ui"

// Goods In → a customer → Fees & agreement. Set once here, used by every check-in for them (Jack,
// 2026-10-16: "Tab on the customer's page" — check-in has no fees step at all). Three cards:
//
//   Their fees           commission, lotting / photography / unsold fees and their usual reserve.
//                        An empty box is the standard rate (shown as the placeholder); one Save.
//   Vendor terms         whether they have signed Vectis's vendor terms, and the terms to read.
//   Special arrangement  plain words, shown at check-in and printed on their receipts.
//
// Every write is saveAgreement (lib/actions/goods-in-agreement.ts), which records who changed it.
// The fees live on GoodsInCustomer; the reserve, the signed date and the arrangement live in
// GoodsInAgreement, which only exists after Run Migrations — until then `ready` is false, the fees
// still work, and the rest says so quietly instead of offering buttons that can't save. If the
// agreement couldn't be READ (a fault, not the missing table) the cards say that instead — never
// "Run Migrations" — and start again from the real agreement once a fees save hands it back.

type Agreement = CustomerAgreement
type FeeKey = keyof Agreement["fees"]
type FieldKey = FeeKey | "reservePercent"
type Field = { key: FieldKey; label: string; unit: "%" | "£"; per: string; std: number; max: number; whole?: boolean }

const FIELDS: Field[] = [
  { key: "commission", label: "Commission", unit: "%", per: "Of the hammer price", std: DEFAULT_TERMS.commission, max: 100 },
  { key: "lottingFee", label: "Lotting fee", unit: "£", per: "Per lot", std: DEFAULT_TERMS.lottingFee, max: 100000 },
  { key: "photographyFee", label: "Photography fee", unit: "£", per: "Per lot", std: DEFAULT_TERMS.photographyFee, max: 100000 },
  { key: "unsoldFee", label: "Unsold fee", unit: "£", per: "Per unsold lot", std: DEFAULT_TERMS.unsoldFee, max: 100000 },
  { key: "reservePercent", label: "Usual reserve", unit: "%", per: "Of the bottom estimate", std: DEFAULT_TERMS.reservePercent, max: 100, whole: true },
]

const muted = "text-gray-500 dark:text-gray-400"
const textBtn = "inline-flex min-h-11 items-center rounded px-1 text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:underline disabled:opacity-40"
const LATER = "Available once an admin presses Run Migrations."
/** Instead of LATER when the agreement couldn't be READ (a fault, not a missing table). */
const UNREAD = "Couldn't be read just now — refresh the page to try again."
const OFFLINE = "Couldn't reach the Hub — check the connection and try again. Nothing was changed."

const pounds = (n: number) => `£${n.toFixed(2)}`
const standardText = (f: Field) => (f.unit === "£" ? (f.std > 0 ? `standard ${pounds(f.std)}` : "standard: no fee") : `standard ${f.std}%`)
const valueOf = (a: Agreement, k: FieldKey) => (k === "reservePercent" ? a.reservePercent : a.fees[k])
// Pounds always show pence ("3.00", like the placeholder); readField reads "3.00" back as 3, so it isn't a change.
const asText = (f: Field, n: number | null) => (n == null ? "" : f.unit === "£" ? n.toFixed(2) : String(n))
const draftOf = (a: Agreement) => Object.fromEntries(FIELDS.map(f => [f.key, asText(f, valueOf(a, f.key))])) as Record<FieldKey, string>

/** London's today as YYYY-MM-DD — the most a signed date may be. */
const londonDay = (d: Date | string = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d))

/** What was typed in one box: empty is the standard rate (null); anything else must be usable. */
function readField(f: Field, raw: string): { value: number | null; error: string | null } {
  const t = raw.trim().replace(/^£\s*/, "").replace(/\s*%$/, "").replace(/,/g, "")
  if (t === "") return { value: null, error: null }
  if (/^-/.test(t)) return { value: null, error: "It can't be less than 0." }
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return { value: null, error: "That isn't a number." }
  const n = Number(t)
  if (!Number.isFinite(n)) return { value: null, error: "That isn't a number." }
  if (n > f.max) return { value: null, error: f.unit === "%" ? `It can't be more than ${f.max}%.` : "That looks too big — check it." }
  if (f.whole && !Number.isInteger(n)) return { value: null, error: "Use a whole number." }
  if ((t.split(".")[1] ?? "").length > 2) return { value: null, error: f.unit === "£" ? "Pounds and pence only — 2 decimal places at most." : "2 decimal places at most." }
  return { value: n, error: null }
}

/** Runs a save, turning a dropped connection into a plain message rather than an unhandled error. */
async function attempt(run: () => Promise<Result<Agreement>>): Promise<Result<Agreement>> {
  try { return await run() } catch { return { ok: false, error: OFFLINE } }
}

function Card({ id, title, intro, children }: { id: string; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${box} @container p-4 sm:p-5`}>
      <div className="mb-4 min-w-0">
        <h2 id={id} className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
        <p className={`mt-1 text-sm ${muted}`}>{intro}</p>
      </div>
      {children}
    </section>
  )
}

function Marker({ custom }: { custom: boolean }) {
  return custom
    ? <span className="inline-flex items-center rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-200">Custom</span>
    : <span className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">Standard</span>
}

const Done = ({ children }: { children: ReactNode }) => <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">✓ {children}</span>

// ─── Their fees ─────────────────────────────────────────────────────────────────────────────

function FeesCard({ customerId, name, agreement, unread, onSaved }: {
  customerId: string
  name: string
  agreement: Agreement
  /** The agreement couldn't be read (a fault) — the reserve is held back for that reason, not Run Migrations. */
  unread: boolean
  onSaved: (a: Agreement) => void
}) {
  const [draft, setDraft] = useState(() => draftOf(agreement))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // The reserve is in the new table: until Run Migrations it shows the standard and can't be changed.
  const usable = (f: Field) => f.key !== "reservePercent" || agreement.ready
  const read = Object.fromEntries(FIELDS.map(f => [f.key, readField(f, draft[f.key])])) as Record<FieldKey, ReturnType<typeof readField>>
  const fields = FIELDS.filter(usable)
  const changed = fields.filter(f => !read[f.key].error && read[f.key].value !== valueOf(agreement, f.key))
  const hasError = fields.some(f => read[f.key].error)
  const typedSince = fields.some(f => draft[f.key] !== asText(f, valueOf(agreement, f.key)))
  const anyCustom = fields.some(f => draft[f.key].trim() !== "")

  const edit = (k: FieldKey, v: string) => { setSaved(false); setError(null); setDraft(d => ({ ...d, [k]: v })) }
  const allStandard = () => { setSaved(false); setError(null); setDraft(d => ({ ...d, ...Object.fromEntries(fields.map(f => [f.key, ""])) })) }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving || hasError || changed.length === 0) return
    const fees: Partial<Agreement["fees"]> = {}
    let reserve: number | null | undefined
    for (const f of changed) {
      if (f.key === "reservePercent") reserve = read[f.key].value
      else fees[f.key] = read[f.key].value
    }
    setSaving(true)
    setError(null)
    const res = await attempt(() => saveAgreement(customerId, {
      ...(Object.keys(fees).length ? { fees } : {}),
      ...(reserve !== undefined ? { reservePercent: reserve } : {}),
    }))
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setDraft(draftOf(res.data))
    setSaved(true)
    onSaved(res.data)
  }

  return (
    <Card
      id="ga-fees"
      title="Their fees"
      intro={<>Every new receipt for {name} uses these. Leave a box empty for the standard rate. The counter can still change one receipt on the day.</>}
    >
      <form onSubmit={save} noValidate>
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {FIELDS.map(f => {
            const id = `ga-${f.key}`
            const on = usable(f)
            const err = on ? read[f.key].error : null
            const custom = on && draft[f.key].trim() !== ""
            return (
              // The second column is held at its full width on a phone too, so the box doesn't shrink under the finger when "Back to standard" appears.
              <li key={f.key} className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-x-3 gap-y-2 py-3 first:pt-0 @md:grid-cols-[minmax(0,1fr)_8rem_8.5rem] @md:gap-x-4">
                <div className="col-span-2 min-w-0 @md:col-span-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <label htmlFor={id} className="text-sm font-semibold text-gray-900 dark:text-white">{f.label}</label>
                    <Marker custom={custom} />
                  </div>
                  <p className={`mt-0.5 text-xs ${muted}`}>{f.per} · {standardText(f)}{on ? "" : unread ? " · couldn't be read just now" : " · needs Run Migrations"}</p>
                </div>
                <div className="relative">
                  {f.unit === "£" && <span aria-hidden className={`pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm ${muted}`}>£</span>}
                  <input
                    id={id}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className={`${input} ${mono} ${f.unit === "£" ? "!pl-7" : "!pr-8"} ${err ? "!border-red-500 dark:!border-red-500" : ""} disabled:opacity-50`}
                    value={on ? draft[f.key] : ""}
                    placeholder={f.unit === "£" ? f.std.toFixed(2) : String(f.std)}
                    onChange={e => edit(f.key, e.target.value)}
                    disabled={!on || saving}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `${id}-err` : undefined}
                  />
                  {f.unit === "%" && <span aria-hidden className={`pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm ${muted}`}>%</span>}
                </div>
                <div className="flex justify-end @md:justify-start">
                  {custom && <button type="button" className={textBtn} onClick={() => edit(f.key, "")} disabled={saving} aria-label={`Put ${f.label.toLowerCase()} back to standard`}>Back to standard</button>}
                </div>
                {err && <p id={`${id}-err`} className="col-span-2 text-xs font-semibold text-red-700 dark:text-red-300 @md:col-span-2 @md:col-start-2">{err}</p>}
              </li>
            )
          })}
        </ul>

        {error && <div className="mt-4"><ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox></div>}

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-gray-100 dark:border-gray-800 pt-4">
          <button type="submit" className={btnGo} disabled={saving || hasError || changed.length === 0} aria-busy={saving}>
            {saving ? "Saving…" : "Save fees"}
          </button>
          {typedSince && !saving && <button type="button" className={btn} onClick={() => { setError(null); setDraft(draftOf(agreement)) }}>Undo changes</button>}
          {anyCustom && !saving && <button type="button" className={textBtn} onClick={allStandard}>All back to standard</button>}
          <span role="status" className="text-sm">
            {saving ? null
              : hasError ? <span className="text-red-700 dark:text-red-300">Fix the box marked in red first.</span>
              : changed.length ? <span className="font-semibold text-amber-700 dark:text-amber-300">Not saved yet</span>
              : saved ? <Done>Saved — their next receipts use these</Done>
              : null}
          </span>
        </div>
      </form>
    </Card>
  )
}

// ─── Vendor terms ───────────────────────────────────────────────────────────────────────────

function TermsCard({ customerId, agreement, why, onSaved, termsText }: {
  customerId: string
  agreement: Agreement
  /** What to say instead of the controls while `agreement.ready` is false. */
  why: string
  onSaved: (a: Agreement) => void
  termsText: ReactNode
}) {
  const [mode, setMode] = useState<"view" | "record" | "clear">("view")
  const [day, setDay] = useState("")
  const [today, setToday] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const signed = agreement.termsSignedAt

  const open = () => {
    const t = londonDay()
    setToday(t)
    setDay(signed ? londonDay(signed) : t)
    setError(null)
    setDone(null)
    setMode("record")
  }
  const dayProblem = !day ? "Pick the day they signed." : !/^\d{4}-\d{2}-\d{2}$/.test(day) ? "That isn't a date." : today && day > today ? "That's in the future — pick the day they signed." : null

  const send = async (termsSignedOn: string | null) => {
    setSaving(true)
    setError(null)
    const res = await attempt(() => saveAgreement(customerId, { termsSignedOn }))
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setMode("view")
    setDone(termsSignedOn ? "Recorded" : "Cleared — they show as not signed yet")
    onSaved(res.data)
  }

  return (
    <Card id="ga-terms" title="Vendor terms" intro="Printed on every receipt for them to sign. Once they have, record it here so the counter knows.">
      {!agreement.ready ? (
        <p className={`text-sm ${muted}`}>{why}</p>
      ) : (
        <div className="space-y-3">
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3 ${signed ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30" : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40"}`}>
            <span
              aria-hidden
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${signed ? "bg-emerald-600 text-white" : "border-2 border-dashed border-gray-300 dark:border-gray-600"}`}
            >
              {signed ? "✓" : ""}
            </span>
            <p className="min-w-0 flex-1 basis-40 text-sm">
              {signed ? (
                <>
                  <span className="font-semibold text-gray-900 dark:text-white">Signed on {ukDate(signed)}</span>
                  {agreement.termsRecordedBy && <span className={muted}> · recorded by {agreement.termsRecordedBy}</span>}
                </>
              ) : (
                <span className="font-semibold text-gray-700 dark:text-gray-200">Not signed yet</span>
              )}
            </p>
            {mode === "view" && (
              signed ? (
                <span className="flex gap-2">
                  <button type="button" className={btn} onClick={open}>Change date</button>
                  <button type="button" className={btn} onClick={() => { setError(null); setDone(null); setMode("clear") }}>Clear</button>
                </span>
              ) : (
                <button type="button" className={btnGo} onClick={open}>They&apos;ve signed — record it</button>
              )
            )}
          </div>

          {mode === "record" && (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={e => { e.preventDefault(); if (!dayProblem && !saving) void send(day) }}
              noValidate
            >
              <div className="min-w-0 flex-1 basis-44">
                <label htmlFor="ga-signed-on" className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-300">The day they signed</label>
                <input
                  id="ga-signed-on"
                  type="date"
                  className={`${input} dark:[color-scheme:dark]`}
                  value={day}
                  max={today || undefined}
                  onChange={e => setDay(e.target.value)}
                  disabled={saving}
                  aria-invalid={dayProblem ? true : undefined}
                  aria-describedby={dayProblem ? "ga-signed-on-err" : undefined}
                />
              </div>
              <span className="flex gap-2">
                <button type="submit" className={btnGo} disabled={saving || !!dayProblem} aria-busy={saving}>{saving ? "Saving…" : "Record it"}</button>
                <button type="button" className={btn} onClick={() => setMode("view")} disabled={saving}>Cancel</button>
              </span>
              {dayProblem && day && <p id="ga-signed-on-err" className="basis-full text-xs font-semibold text-red-700 dark:text-red-300">{dayProblem}</p>}
            </form>
          )}

          {mode === "clear" && (
            <div role="group" aria-labelledby="ga-clear-q" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
              <p id="ga-clear-q" className="min-w-0 flex-1 basis-48 text-sm text-amber-900 dark:text-amber-100">Clear the signed date? They&apos;ll show as not signed yet.</p>
              <span className="flex gap-2">
                <button type="button" className={btnDanger} onClick={() => void send(null)} disabled={saving} aria-busy={saving}>{saving ? "Clearing…" : "Yes, clear it"}</button>
                <button type="button" className={btn} onClick={() => setMode("view")} disabled={saving}>Keep it</button>
              </span>
            </div>
          )}

          {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
          {done && mode === "view" && <p role="status"><Done>{done}</Done></p>}
        </div>
      )}

      <details className="group mt-4 border-t border-gray-100 dark:border-gray-800 pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:underline [&::-webkit-details-marker]:hidden">
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" fill="currentColor"><path d="M7.2 4.2a.75.75 0 0 1 1.06 0l5.25 5.27a.75.75 0 0 1 0 1.06L8.26 15.8a.75.75 0 1 1-1.06-1.06L11.92 10 7.2 5.27a.75.75 0 0 1 0-1.06Z" /></svg>
          <span className="group-open:hidden">Read Vectis&apos;s vendor terms</span>
          <span className="hidden group-open:inline">Hide the vendor terms</span>
        </summary>
        <div
          tabIndex={0}
          aria-label="Vectis's vendor terms"
          className="mt-2 max-h-[28rem] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {termsText}
        </div>
      </details>
    </Card>
  )
}

// ─── Special arrangement ────────────────────────────────────────────────────────────────────

function ArrangementCard({ customerId, agreement, why, onSaved }: {
  customerId: string
  agreement: Agreement
  /** What to say instead of the controls while `agreement.ready` is false. */
  why: string
  onSaved: (a: Agreement) => void
}) {
  const current = agreement.specialArrangement
  const [editing, setEditing] = useState(!current)
  const [text, setText] = useState(current ?? "")
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const trimmed = text.trim()
  const canSave = !saving && trimmed.length > 0 && trimmed.length <= MAX_ARRANGEMENT && trimmed !== (current ?? "")

  const send = async (value: string | null) => {
    setSaving(true)
    setError(null)
    const res = await attempt(() => saveAgreement(customerId, { specialArrangement: value }))
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    const now = res.data.specialArrangement
    setText(now ?? "")
    setEditing(!now)
    setConfirming(false)
    setDone(value ? "Saved — check-in shows it from now on" : "Removed")
    onSaved(res.data)
  }

  return (
    <Card id="ga-special" title="Special arrangement" intro="Anything agreed with them beyond their fees. Shown at check-in and printed on their receipts.">
      {!agreement.ready ? (
        <p className={`text-sm ${muted}`}>{why}</p>
      ) : current && !editing ? (
        <div className="space-y-3">
          {/* Indigo, as at check-in — amber means a warning everywhere else in Goods In, and this isn't one. */}
          <p className="whitespace-pre-line break-words rounded-lg border-l-4 border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 text-sm leading-relaxed text-indigo-950 dark:text-indigo-100">{current}</p>
          {confirming ? (
            <div role="group" aria-labelledby="ga-remove-q" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
              <p id="ga-remove-q" className="min-w-0 flex-1 basis-48 text-sm text-amber-900 dark:text-amber-100">Remove it? Their next receipts won&apos;t mention it. Receipts already booked keep it.</p>
              <span className="flex gap-2">
                <button type="button" className={btnDanger} onClick={() => void send(null)} disabled={saving} aria-busy={saving}>{saving ? "Removing…" : "Yes, remove it"}</button>
                <button type="button" className={btn} onClick={() => setConfirming(false)} disabled={saving}>Keep it</button>
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={btn} onClick={() => { setDone(null); setError(null); setText(current); setEditing(true) }}>Change</button>
              <button type="button" className={btn} onClick={() => { setDone(null); setError(null); setConfirming(true) }}>Remove</button>
              {done && <span role="status" className="ml-1"><Done>{done}</Done></span>}
            </div>
          )}
        </div>
      ) : (
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (canSave) void send(trimmed) }}>
          <label htmlFor="ga-special-text" className="sr-only">Special arrangement</label>
          <textarea
            id="ga-special-text"
            rows={3}
            maxLength={MAX_ARRANGEMENT}
            className={`${input} resize-y leading-relaxed`}
            placeholder="e.g. 15% on any single lot over £5,000 — agreed with Jordan, March 2026"
            value={text}
            onChange={e => { setDone(null); setText(e.target.value) }}
            disabled={saving}
            aria-describedby="ga-special-note"
          />
          <p id="ga-special-note" className={`-mt-1 text-xs ${muted}`}>Never put bank details here — this is printed on their receipts.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={btnGo} disabled={!canSave} aria-busy={saving}>{saving ? "Saving…" : "Save"}</button>
            {current && <button type="button" className={btn} onClick={() => { setText(current); setEditing(false); setError(null) }} disabled={saving}>Cancel</button>}
            {done && !current && <span role="status" className="ml-1"><Done>{done}</Done></span>}
            {text.length > MAX_ARRANGEMENT - 200 && (
              <span className={`ml-auto text-xs ${mono} ${text.length >= MAX_ARRANGEMENT ? "text-amber-700 dark:text-amber-300" : muted}`}>{text.length.toLocaleString("en-GB")} / {MAX_ARRANGEMENT.toLocaleString("en-GB")}</span>
            )}
          </div>
        </form>
      )}
      {error && <div className="mt-3"><ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox></div>}
    </Card>
  )
}

// ─── The tab ────────────────────────────────────────────────────────────────────────────────

export default function FeesAgreement({ customerId, name, initial, loadError, termsText }: {
  customerId: string
  name: string
  initial: Agreement
  /** Set when the agreement couldn't be read (the fees shown are the customer's own). */
  loadError: string | null
  /** Vectis's vendor terms, laid out on the server (vendor-terms-text.tsx). */
  termsText: ReactNode
}) {
  // Each card saves its own part and hands back the whole agreement, which is kept here so the
  // other cards and the "last changed" line stay in step without reloading the page.
  const [agreement, setAgreement] = useState(initial)
  // The page couldn't read it (a fault, not a missing table) until a save hands back the real one.
  const [unread, setUnread] = useState(!!loadError)
  const saved = (a: Agreement) => { setAgreement(a); setUnread(false) }
  const why = unread ? UNREAD : LATER
  // The terms and arrangement cards start from the agreement they're first given, so they start
  // again when it becomes readable (a fees save after a failed read hands back the real one) —
  // never an empty box over an arrangement they haven't been shown.
  const fresh = `${agreement.ready}-${unread}`

  return (
    <div className="@container space-y-6">
      {unread ? (
        <ErrorBox>Their agreement couldn&apos;t be read just now ({loadError}). Their fees below are from their customer record and can still be changed — refresh the page in a moment for the rest.</ErrorBox>
      ) : !agreement.ready ? (
        <p className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
          <b className="font-semibold text-gray-800 dark:text-gray-100">Reserve, signed terms and special arrangement need Run Migrations</b>
          {" "}— an admin presses it in the banner at the top of the Hub. Their fees can be changed now.
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <FeesCard customerId={customerId} name={name} agreement={agreement} unread={unread} onSaved={saved} />
        <div className="space-y-6">
          <TermsCard key={`t-${fresh}`} customerId={customerId} agreement={agreement} why={why} onSaved={saved} termsText={termsText} />
          <ArrangementCard key={`a-${fresh}`} customerId={customerId} agreement={agreement} why={why} onSaved={saved} />
        </div>
      </div>

      {agreement.updatedAt && (
        <p className={`text-xs ${muted}`}>
          Last changed{agreement.updatedByName ? <> by {agreement.updatedByName}</> : null}, {ukDateTime(agreement.updatedAt)}
        </p>
      )}
    </div>
  )
}
