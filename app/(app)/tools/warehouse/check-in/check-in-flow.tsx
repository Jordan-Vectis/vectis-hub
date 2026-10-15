"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import { createReceipt, getCustomer, type CustomerRow } from "@/lib/actions/goods-in"
import { COUNTERS, DEFAULT_TERMS, type CounterKey, type ReceiptTerms } from "@/lib/goods-in/model"
import { ErrorBox, btn, btnGo, ukDateTime } from "../_components/ui"
import CheckStep from "./check-step"
import CustomerStep, { type CustomerMode } from "./customer-step"
import DonePanel, { type Booked } from "./done-panel"
import { clearDraft, readDraft, writeDraft, type CheckInDraft } from "./draft"
import GoodsStep from "./goods-step"
import {
  MAX_ROWS, blankRow, countKinds, fullName, isBlankRow, isNumberingError, kindsPhrase, parseTerms, sameTerms, termsDraft, usualTerms,
  type GoodsRow, type TermsDraft,
} from "./shared"
import TermsStep from "./terms-step"

// Goods In → Check in: the counter's main screen. Four steps on one page — Customer, What
// they've brought, Terms, Check & book in — each reachable again from the step bar, with NOTHING
// booked until the final Book in (createReceipt makes the receipt, its number and every tote and
// pallet number in one go, so a half-finished check-in leaves no trace). Adding or editing a
// customer is the exception: that saves their record as it always has.
//
// A half-finished check-in is kept in this tab (draft.ts) and offered back if the clerk follows a
// link away and comes back; Book in, or starting another customer, clears it.
//
// Works the same on the counter iPad, a desktop and with a USB/Bluetooth scanner: big targets,
// the cursor where the next thing is typed, Enter moves you on, and the layout follows the width
// the page actually has (container queries — the Warehouse sidebar takes a slice of the screen).

const STEPS = [
  { title: "Customer", short: "Customer" },
  { title: "What they've brought", short: "Goods" },
  { title: "Terms", short: "Terms" },
  { title: "Check & book in", short: "Book in" },
] as const

type BookError = { kind: "server"; message: string } | { kind: "lost" }

export default function CheckInFlow({ missingSeries, isAdmin, userId, initialCustomer = null }: {
  /** Number series not yet set up in Settings (null = couldn't check). */
  missingSeries: CounterKey[] | null
  isAdmin: boolean
  /** Who is at the counter — a kept draft is only offered back to the person who left it. */
  userId: string
  /** The customer the page was opened for (?customer= from the Customers screens) — starts picked, with Next ready. */
  initialCustomer?: CustomerRow | null
}) {
  const router = useRouter()
  const [checking, startChecking] = useTransition()

  const [step, setStep] = useState(0)
  const [furthest, setFurthest] = useState(0)
  const [customer, setCustomer] = useState<CustomerRow | null>(initialCustomer)
  const [customerMode, setCustomerMode] = useState<CustomerMode>("view")
  const [rows, setRows] = useState<GoodsRow[]>(() => [blankRow("tote")])
  const [terms, setTerms] = useState<TermsDraft>(() => termsDraft(usualTerms(initialCustomer)))
  const [notes, setNotes] = useState("")
  const [owner, setOwner] = useState(false)
  const [agent, setAgent] = useState(false)

  const [booking, setBooking] = useState(false)
  const bookingRef = useRef(false)
  const [bookError, setBookError] = useState<BookError | null>(null)
  const [booked, setBooked] = useState<Booked | null>(null)

  const topRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  // Opened for a customer: their card shows with Next ready, exactly as if they'd just been picked.
  const focusNext = useRef(!!initialCustomer)
  const shownStep = useRef(step)

  const parsed = parseTerms(terms)
  const { totes, pallets } = countKinds(rows)
  const ok = [!!customer && customerMode === "view", rows.length > 0 && rows.length <= MAX_ROWS, !!parsed.terms, true]
  const blocked = [
    customer ? (customerMode === "edit" ? "Save or cancel the customer's details first." : "Pick the customer first.") : "Find or add the customer first.",
    rows.length === 0 ? "Add at least one tote or pallet." : `More than ${MAX_ROWS} — split it into two receipts.`,
    "Fix the terms marked in red.",
    "",
  ]
  const reachable = (i: number) => ok.slice(0, i).every(Boolean)
  const canBook = ok.every(Boolean) && !!customer && !!parsed.terms

  // Number series this booking needs that aren't set up — booking in would be refused.
  const needed: CounterKey[] = ["receipt", ...(totes ? (["tote"] as const) : []), ...(pallets ? (["pallet"] as const) : [])]
  const missingNeeded = missingSeries ? needed.filter(k => missingSeries.includes(k)) : []
  const vendorSeries = missingSeries ? !missingSeries.includes("vendor") : null

  // ── Moving between steps ──
  const go = (i: number) => {
    if (bookingRef.current || i === step || i < 0 || i >= STEPS.length) return
    if (i > step && !(reachable(i) && i <= furthest + 1)) return
    setStep(i)
    setFurthest(f => Math.max(f, i))
  }

  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    topRef.current?.scrollIntoView({ block: "start" })
    // The customer search and the goods rows put the cursor where it's needed themselves; Terms and
    // Check hand focus to their heading — never to Book in, so a stray scan's Enter can't press it.
    if (step >= 2) document.getElementById(`gi-step-${step}-heading`)?.focus({ preventScroll: true })
  }, [step])

  // After picking a customer, Next is ready — Enter (or a tap) moves on.
  useEffect(() => {
    if (!focusNext.current || step !== 0 || customerMode !== "view" || !customer) return
    focusNext.current = false
    nextRef.current?.focus({ preventScroll: true })
  })

  // Something here would be lost by leaving. The customer the page was opened for doesn't count on
  // its own — following the link again brings them straight back.
  const dirty = !booked && (
    (!!customer && customer.id !== initialCustomer?.id) || rows.length > 1 || rows.some(r => !isBlankRow(r)) || !!notes.trim() ||
    owner || agent || (!!customer && !sameTerms(terms, usualTerms(customer)))
  )

  // Closing or reloading the tab: the browser's own warning.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  // Following a link elsewhere in the Hub fires no warning, so the check-in is kept in this tab
  // (sessionStorage) while it's half done, and offered back when Check in is opened again.
  const [offer, setOffer] = useState<CheckInDraft | null>(null)
  const [draftChecked, setDraftChecked] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreNote, setRestoreNote] = useState<string | null>(null)

  useEffect(() => {
    // Read after mount (the server has no sessionStorage, so reading while rendering would differ).
    const d = readDraft(userId)
    setOffer(d && (d.customerId || d.rows.some(r => !isBlankRow(r)) || d.rows.length > 1 || d.notes.trim()) ? d : null)
    setDraftChecked(true)
  }, [userId])

  useEffect(() => {
    if (!draftChecked) return // don't overwrite a kept draft before it's been offered
    if (booked) { clearDraft(); return }
    if (!dirty) { if (!offer) clearDraft(); return }
    writeDraft({
      v: 1, userId, customerId: customer?.id ?? null, customerName: customer ? fullName(customer) : null,
      rows, terms, notes, owner, agent, step, furthest, savedAt: Date.now(),
    })
  }, [draftChecked, booked, dirty, offer, userId, customer, rows, terms, notes, owner, agent, step, furthest])

  const carryOn = async () => {
    const d = offer
    if (!d || restoring || bookingRef.current) return
    setRestoring(true)
    setRestoreNote(null)
    let c: CustomerRow | null = null
    if (d.customerId) {
      const who = d.customerName ?? "the customer"
      try {
        const r = await getCustomer(d.customerId)
        if (r.ok && r.data) c = r.data
        else setRestoreNote(r.ok
          ? `${who} couldn't be found any more — find them again. Everything else has been put back.`
          : `Couldn't open ${who}'s record (${r.error}) — find them again. Everything else has been put back.`)
      } catch {
        setRestoreNote(`The Hub didn't answer while opening ${who}'s record — find them again. Everything else has been put back.`)
      }
    }
    const rs = d.rows.length ? d.rows : [blankRow("tote")]
    const ts = d.terms ?? termsDraft(usualTerms(c))
    // Back to the step they were on, but never past one that isn't complete any more.
    const firstGap = [!!c, rs.length > 0 && rs.length <= MAX_ROWS, !!parseTerms(ts).terms].findIndex(v => !v)
    const cap = firstGap < 0 ? 3 : firstGap
    const s = Math.min(d.step, cap)
    setCustomer(c)
    setCustomerMode("view")
    setRows(rs)
    setTerms(ts)
    setNotes(d.notes)
    setOwner(d.owner)
    setAgent(d.agent)
    setBookError(null)
    setFurthest(Math.max(s, Math.min(d.furthest, cap)))
    setStep(s)
    shownStep.current = -1 // scroll back to the top
    setOffer(null)
    setRestoring(false)
  }

  // ── Customer ──
  const pickCustomer = (c: CustomerRow) => {
    // Same person re-saved with the terms already changed for this receipt: keep the changes.
    const keepTerms = customer?.id === c.id && !sameTerms(terms, usualTerms(customer))
    setCustomer(c)
    setCustomerMode("view")
    if (!keepTerms) setTerms(termsDraft(usualTerms(c)))
    focusNext.current = true
  }

  // ── Terms ──
  const setTerm = (k: keyof ReceiptTerms, v: string) => setTerms(t => ({ ...t, [k]: v }))

  // ── Book in ──
  const bookIn = async () => {
    if (bookingRef.current || booked || !canBook || !customer || !parsed.terms) return
    bookingRef.current = true
    setBooking(true)
    setBookError(null)
    const sent = rows
    try {
      const res = await createReceipt({
        contactId: customer.id,
        terms: parsed.terms,
        containers: sent.map(r => ({ kind: r.kind, category: r.category.trim() || null, description: r.description.trim() || null })),
        notes: notes.trim() || null,
        ownerConfirmed: owner,
        agentConfirmed: agent,
      })
      if (!res.ok) {
        setBookError({ kind: "server", message: res.error })
        document.getElementById("gi-step-3-heading")?.scrollIntoView({ block: "start" })
        return
      }
      setBooked({
        receiptId: res.data.receiptId,
        // createReceipt hands the numbers back in the order the rows were sent.
        containers: res.data.containerIds.map((id, i) => ({
          id,
          kind: sent[i]?.kind ?? "tote",
          category: sent[i]?.category.trim() || null,
          description: sent[i]?.description.trim() || null,
        })),
        customer,
      })
    } catch {
      setBookError({ kind: "lost" })
      document.getElementById("gi-step-3-heading")?.scrollIntoView({ block: "start" })
    } finally {
      bookingRef.current = false
      setBooking(false)
    }
  }

  const reset = () => {
    setCustomer(null)
    setCustomerMode("view")
    setRows([blankRow("tote")])
    setTerms(termsDraft(DEFAULT_TERMS))
    setNotes("")
    setOwner(false)
    setAgent(false)
    setBookError(null)
    setRestoreNote(null)
    setBooked(null)
    setFurthest(0)
    setStep(0)
    shownStep.current = -1 // so the page scrolls back to the top even if it was already on step 0
  }

  if (booked) return <div className="@container"><DonePanel booked={booked} onAnother={reset} /></div>

  const errorBox: ReactNode = bookError && (
    <ErrorBox onDismiss={() => setBookError(null)}>
      {bookError.kind === "lost" ? (
        <>
          <b>The Hub didn&apos;t answer</b> — the connection may have dropped. The receipt may or may not have been made, so look in{" "}
          <Link href="/tools/warehouse/receipts" target="_blank" className="underline font-semibold">Receipts</Link> before pressing Book in again.
        </>
      ) : isNumberingError(bookError.message) ? (
        <>
          <b>Couldn&apos;t book in:</b> {bookError.message}{" "}
          <Link href="/tools/warehouse/settings" target="_blank" className="underline font-semibold">Open Goods In → Settings</Link>
          {" "}(a new tab, so nothing here is lost){isAdmin ? ", set it there" : " for an admin to set it"}, then press Book in again. Nothing has been booked yet.
        </>
      ) : (
        <><b>Couldn&apos;t book in:</b> {bookError.message} Nothing has been booked — fix it and press Book in again.</>
      )}
    </ErrorBox>
  )

  const firstProblem = ok.findIndex(v => !v)
  const barNote =
    step < 3 ? (ok[step] ? "" : blocked[step])
    : firstProblem >= 0 ? blocked[firstProblem]
    : missingNeeded.length > 0 ? "The number series isn't set up yet — see the note at the top."
    : ""

  const subs = [
    customer ? fullName(customer) : "Find or add",
    kindsPhrase(totes, pallets),
    parsed.terms ? `${parsed.terms.commission}% commission` : "Needs fixing",
    "",
  ]

  return (
    <div className="@container">
      <div ref={topRef} className="scroll-mt-4" />

      {offer && (
        <div className="mb-5 rounded-xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 text-sm text-indigo-900 dark:text-indigo-100">
          <p className="font-semibold">
            There&apos;s an unfinished check-in{offer.customerName ? <> for {offer.customerName}</> : null} in this tab
          </p>
          <p className="mt-1">
            {draftSummary(offer)}, left at {ukDateTime(new Date(offer.savedAt))}. Nothing from it has been booked in.
            {dirty && " Carrying on with it replaces what's on this screen now."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btnGo} disabled={restoring || booking} onClick={() => void carryOn()} aria-busy={restoring}>
              {restoring ? "Opening it…" : offer.customerName ? `Carry on with the check-in for ${offer.customerName}` : "Carry on with that check-in"}
            </button>
            <button type="button" className={btn} disabled={restoring} onClick={() => setOffer(null)}>Throw it away</button>
          </div>
        </div>
      )}

      {restoreNote && (
        <div className="mb-5">
          <ErrorBox onDismiss={() => setRestoreNote(null)}>{restoreNote}</ErrorBox>
        </div>
      )}

      {missingNeeded.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-semibold">Booking in can&apos;t finish yet</p>
          <p className="mt-1">
            The {listWords(missingNeeded.map(k => COUNTERS[k].label.toLowerCase().replace(/s$/, "")))} numbers haven&apos;t been set up, so the Hub has no number to give.{" "}
            {isAdmin ? "You can set where each series starts in " : "An admin sets where each series starts in "}
            <Link href="/tools/warehouse/settings" target="_blank" className="font-semibold underline">Goods In → Settings</Link>.
            {" "}You can fill everything in meanwhile — nothing is lost.
          </p>
          <button type="button" className={`${btn} mt-2`} disabled={checking} onClick={() => startChecking(() => router.refresh())}>
            {checking ? "Checking…" : "They've been set — check again"}
          </button>
        </div>
      )}

      <StepBar step={step} furthest={furthest} ok={ok} reachable={reachable} go={go} subs={subs} />

      {step > 0 && step < 3 && customer && (
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Booking in for <b className="text-gray-900 dark:text-white">{fullName(customer)}</b>
          {customer.vendorNo && <> · <span className="font-mono">{customer.vendorNo}</span></>}
          {" "}· {kindsPhrase(totes, pallets)}
        </p>
      )}

      <div className="min-h-[40vh]">
        {step === 0 && <CustomerStep customer={customer} mode={customerMode} setMode={setCustomerMode} onPick={pickCustomer} vendorSeries={vendorSeries} />}
        {step === 1 && <GoodsStep rows={rows} setRows={setRows} />}
        {step === 2 && (
          <TermsStep
            customer={customer}
            terms={terms}
            setTerm={setTerm}
            onReset={() => setTerms(termsDraft(usualTerms(customer)))}
            notes={notes}
            setNotes={setNotes}
            owner={owner}
            setOwner={setOwner}
            agent={agent}
            setAgent={setAgent}
          />
        )}
        {step === 3 && customer && (
          <CheckStep
            customer={customer}
            rows={rows}
            terms={parsed.terms}
            notes={notes}
            owner={owner}
            agent={agent}
            vendorSeries={vendorSeries}
            goTo={go}
            onRemoveBlank={() => setRows(rs => rs.filter(r => !isBlankRow(r)))}
            error={errorBox}
          />
        )}
      </div>

      {/* Back / Next — always in reach at the foot of the screen, however long the list gets. */}
      <div className="sticky bottom-0 z-10 -mx-4 sm:-mx-6 lg:-mx-8 mt-8 border-t border-gray-200 dark:border-gray-800 bg-gray-50/95 dark:bg-[#141416]/95 backdrop-blur px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {step > 0 && <button type="button" className={btn} onClick={() => go(step - 1)} disabled={booking}>← Back</button>}
          {barNote && (
            <p className="order-last basis-full text-sm text-gray-600 dark:text-gray-400 @2xl:order-none @2xl:basis-auto @2xl:flex-1 @2xl:min-w-0 @2xl:text-right">{barNote}</p>
          )}
          <div className="ml-auto">
            {step < 3 ? (
              <button ref={nextRef} type="button" className={btnGo} disabled={!ok[step]} onClick={() => go(step + 1)}>
                Next: {STEPS[step + 1].title} →
              </button>
            ) : (
              <button type="button" className={`${btnGo} !min-h-14 !px-8 !text-base`} disabled={booking || !canBook} onClick={() => void bookIn()} aria-busy={booking}>
                {booking
                  ? <><span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> Booking in {kindsPhrase(totes, pallets)}…</>
                  : rows.length ? <>Book in {kindsPhrase(totes, pallets)}</> : "Book in"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** "3 totes, 1 pallet listed" — what the unfinished check-in bar says is in the kept draft. */
function draftSummary(d: CheckInDraft) {
  const { totes, pallets } = countKinds(d.rows)
  return d.rows.length ? `${kindsPhrase(totes, pallets)} listed` : "Nothing listed yet"
}

/** "receipt, tote and pallet" */
function listWords(ws: string[]) {
  return ws.length <= 1 ? ws.join("") : `${ws.slice(0, -1).join(", ")} and ${ws[ws.length - 1]}`
}

function StepBar({ step, furthest, ok, reachable, go, subs }: {
  step: number
  furthest: number
  ok: boolean[]
  reachable: (i: number) => boolean
  go: (i: number) => void
  subs: string[]
}) {
  return (
    <nav aria-label="Check-in steps" className="mb-6">
      <ol className="grid grid-cols-4 gap-1.5 @lg:gap-2">
        {STEPS.map((s, i) => {
          const current = i === step
          const done = !current && i <= furthest && ok[i] && reachable(i) && i < STEPS.length - 1
          const canGo = !current && reachable(i) && i <= furthest + 1
          return (
            <li key={s.short} className="min-w-0">
              <button
                type="button"
                onClick={() => go(i)}
                disabled={!canGo}
                aria-current={current ? "step" : undefined}
                className={`flex h-full w-full min-h-14 flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-center transition-colors @2xl:flex-row @2xl:justify-start @2xl:gap-3 @2xl:px-3 @2xl:text-left ${
                  current
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50"
                    : canGo
                      ? "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-400 dark:hover:border-indigo-500"
                      : "border-dashed border-gray-300 dark:border-gray-700 cursor-default"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    current ? "bg-indigo-600 text-white" : done ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className="min-w-0 max-w-full">
                  <span className={`block truncate text-xs font-semibold @2xl:text-sm ${current ? "text-indigo-800 dark:text-indigo-200" : "text-gray-800 dark:text-gray-200"}`}>
                    <span className="@2xl:hidden">{s.short}</span>
                    <span className="hidden @2xl:inline">{s.title}</span>
                    <span className="sr-only">{current ? " (this step)" : done ? " (done)" : ""}</span>
                  </span>
                  {subs[i] && <span className="hidden truncate text-xs text-gray-500 dark:text-gray-400 @4xl:block">{subs[i]}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
