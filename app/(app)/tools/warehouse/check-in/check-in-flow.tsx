"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react"
import { getCustomer, type CustomerRow } from "@/lib/actions/goods-in"
import { getAgreement, type CustomerAgreement } from "@/lib/actions/goods-in-agreement"
import { bookInCheckIn, discardCheckIn, loadCheckIn, type CheckInInput, type CheckInLoaded } from "@/lib/actions/goods-in-checkin"
import { COUNTERS, DEFAULT_TERMS, type CounterKey, type ReceiptTerms } from "@/lib/goods-in/model"
import { ErrorBox, btn, btnDanger, btnGo, mono, ukDateTime } from "../_components/ui"
import CheckStep from "./check-step"
import CustomerStep, { type CustomerMode } from "./customer-step"
import DonePanel, { type Booked } from "./done-panel"
import { clearDraft, readDraft, writeDraft, type CheckInDraft } from "./draft"
import GoodsStep from "./goods-step"
import { useCheckInSaving, type SaveAnswer, type SaveWhen } from "./save-engine"
import {
  LABELS_TAB, MAX_ROWS, NOTE, agreementOf, blankRow, countKinds, equalTerms, fullName, isBlankRow, isNumberingError, isPrinted, kindsPhrase, labelText,
  labelsUrl, listNumbers, mergeSaved, parseTerms, rowFromSaved, sameTerms, termsDraft, usualTerms,
  type GoodsRow, type TermsDraft, type UnfinishedCheckIn,
} from "./shared"

// Goods In → Check in: the counter's main screen. Three steps on one page — Customer, What
// they've brought, Check & book in — each reachable again from the step bar.
//
// From the moment the clerk reaches the goods step the check-in is saved in the Hub as a receipt
// that ISN'T BOOKED IN YET (status "draft"): it takes its receipt number then, and every tote and
// pallet row takes its real number as soon as it exists, so labels can be printed from the goods
// step (Jack, 2026-10-16). Nothing about it counts as booked in until Book in. The saving is
// save-engine.ts: one save at a time, straight away for adds/removes/kind changes/customer/step,
// a moment after typing stops. Numbers are never used twice — a removed row, or a tote switched to
// a pallet, gives its number up for good, and the screen says so before it happens.
//
// The terms are not a step any more (Jack: "it's more the checking in asking for fees part you
// have done is annoying"): every receipt uses the customer's usual terms (the standard terms where
// they have none), shown as one line on Check & book in with a "Change for this receipt". Their
// fees, reserve and any special arrangement are set once, on their customer page → Fees &
// agreement; this screen reads that (getAgreement) whenever the customer changes and whenever the
// tab comes back into view — so a change made there in another tab shows here — and terms not
// changed for this receipt follow it. Until it has been read, or before Run Migrations, the fees
// on their record and the standard reserve apply — Book in waits for the first read (a few seconds
// at most), and a read that fails says so on Check & book in with Try again, never silently.
//
// A check-in left part way is kept in the Hub (and, for this tab, in sessionStorage — draft.ts)
// and offered back: "Carry on" here, from Receipts, the dashboard or the customer's page. Starting
// another customer's while one with rows is open asks first: keep it for later, or throw it away.
//
// Works the same on the counter iPad, a desktop and with a USB/Bluetooth scanner: big targets,
// the cursor where the next thing is typed, Enter moves you on, and the layout follows the width
// the page actually has (container queries — the Warehouse sidebar takes a slice of the screen).

const STEPS = [
  { title: "Customer", short: "Customer" },
  { title: "What they've brought", short: "Goods" },
  { title: "Check & book in", short: "Book in" },
] as const
const LAST = STEPS.length - 1
/** A failed read of their Fees & agreement is tried once more after this long. */
const AGREEMENT_RETRY_MS = 3_000
/** The longest Book in waits for the first read of their Fees & agreement. */
const AGREEMENT_WAIT_MS = 6_000

type BookError = { kind: "server"; message: string } | { kind: "lost" }
/** What was printed: row key → its number, and row key → what its label says. */
type Printed = { ids: Map<string, string>; texts: Map<string, string> }
type PrintNote =
  | { kind: "opened"; count: number }
  | { kind: "blocked"; url: string; printed: Printed; after?: () => void }
  | { kind: "error"; message: string }
type Notice = { tone: "ok" | "warn"; text: string }
/** Labels printed under one customer's name, before the check-in was moved to another (or the name changed). */
type Relabel = { was: string; keys: string[]; ids: string[] }

/** A save the Hub refused for good — retrying can't help, so the status line offers what does. */
const reopenNeeded = (m: string) => /open the check-in again/i.test(m)
const thrownAwayMsg = (m: string) => /was thrown away/i.test(m)
const bookedOrVoidMsg = (m: string) => /has already been booked in|has been voided/i.test(m)

export default function CheckInFlow({ missingSeries, isAdmin, userId, initialCustomer = null, initialCheckIn = null, initialAgreement = null, unfinished: unfinishedAtLoad = [], hubOwns = false }: {
  /** Whether the Hub owns customers' details yet (lib/customers/ownership.ts); false = BC first. */
  hubOwns?: boolean
  /** Number series not yet set up in Settings (null = couldn't check). */
  missingSeries: CounterKey[] | null
  isAdmin: boolean
  /** Who is at the counter — a kept draft is only offered back to the person who left it. */
  userId: string
  /** The customer the page was opened for (?customer= from the Customers screens) — starts picked, with Next ready. */
  initialCustomer?: CustomerRow | null
  /** The check-in the page was opened to carry on (?receipt=). */
  initialCheckIn?: CheckInLoaded | null
  /** That customer's Fees & agreement, read by the page (null when it couldn't be). */
  initialAgreement?: CustomerAgreement | null
  /** Check-ins not booked in yet (the person's own first), offered on the Customer step. */
  unfinished?: UnfinishedCheckIn[]
}) {
  const router = useRouter()
  const [checking, startChecking] = useTransition()
  const opened = initialCheckIn

  const [step, setStep] = useState(() => (opened?.customer ? 1 : 0))
  const [furthest, setFurthest] = useState(() => (opened?.customer ? (opened.rows.length ? 2 : 1) : 0))
  const [customer, setCustomer] = useState<CustomerRow | null>(opened ? opened.customer : initialCustomer)
  const [customerMode, setCustomerMode] = useState<CustomerMode>("view")
  const [receiptId, setReceiptId] = useState<string | null>(opened?.receiptId ?? null)
  const [rows, setRows] = useState<GoodsRow[]>(() => (opened ? opened.rows.map(rowFromSaved) : [blankRow("tote")]))
  /** The Fees & agreement last read — used only while it is the customer on screen's (agreementOf). */
  const [agreement, setAgreement] = useState<CustomerAgreement | null>(initialAgreement)
  const [terms, setTerms] = useState<TermsDraft>(() => termsDraft(opened ? opened.terms : usualTerms(initialCustomer, initialAgreement)))
  const [termsOpen, setTermsOpen] = useState(false)
  const [notes, setNotes] = useState(opened?.notes ?? "")
  const [owner, setOwner] = useState(opened?.ownerConfirmed ?? false)
  const [agent, setAgent] = useState(opened?.agentConfirmed ?? false)
  /** Numbers the Hub has let go (rows removed and saved without them). */
  const [goneIds, setGoneIds] = useState<ReadonlySet<string>>(() => new Set())
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({})
  const [unfinished, setUnfinished] = useState(unfinishedAtLoad)
  const [hideUnfinished, setHideUnfinished] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [relabel, setRelabel] = useState<Relabel | null>(null)
  /** What each row's label said when it was printed here, by row key ("Printed — changed since"). */
  const [printedAs, setPrintedAs] = useState<Record<string, string>>({})
  // A check-in kept in this tab (sessionStorage), offered back — see below.
  const [offer, setOffer] = useState<CheckInDraft | null>(null)

  const [booking, setBooking] = useState(false)
  const bookingRef = useRef(false)
  const [bookError, setBookError] = useState<BookError | null>(null)
  const [booked, setBooked] = useState<Booked | null>(null)
  const [printing, setPrinting] = useState(false)
  const printingRef = useRef(false)
  const [printNote, setPrintNote] = useState<PrintNote | null>(null)

  const topRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const leaveRef = useRef<HTMLDivElement>(null)
  // Opened for a customer: their card shows with Next ready, exactly as if they'd just been picked.
  const focusNext = useRef(!!initialCustomer && !opened)
  const shownStep = useRef(step)
  const openedRef = useRef(opened)

  const parsedTerms = parseTerms(terms).terms
  const { totes, pallets } = countKinds(rows)

  // ── Saving (save-engine.ts) ──
  // What the Hub is sent: the whole check-in as it is on screen.
  const input: CheckInInput | null = customer
    ? {
        receiptId,
        customerId: customer.id,
        rows: rows.map(r => ({ key: r.key, id: r.id, kind: r.kind, category: r.category, description: r.description })),
        // Terms that can't be used aren't sent — the Hub keeps the last good ones until they're fixed.
        terms: parsedTerms,
        notes: notes.trim() || null,
        ownerConfirmed: owner,
        agentConfirmed: agent,
      }
    : null
  const applySaved = (a: SaveAnswer) => {
    setReceiptId(a.receiptId)
    // This screen has its own check-in in the Hub now: a different one kept in this tab is in the
    // unfinished lists anyway, so it stops being offered here.
    setOffer(o => (o && o.receiptId !== a.receiptId ? null : o))
    setRows(rs => mergeSaved(rs, a))
    if (a.removed.length) setGoneIds(g => new Set([...g, ...a.removed]))
    if (a.renumbered.length) {
      setRowNotes(n => ({
        ...n,
        ...Object.fromEntries(a.renumbered.map(r => [r.key, `${r.oldId} had already been given up, so this row gets a new number — if a label was printed for ${r.oldId}, throw it away.`])),
      }))
    }
  }
  const active = !!receiptId || furthest >= 1
  const saving = useCheckInSaving({ active, input }, applySaved)
  const numbering = saving.inFlight || (saving.pending && !saving.error)

  const editRows = (fn: (rs: GoodsRow[]) => GoodsRow[], when: SaveWhen) => {
    setRows(fn)
    saving.changed(when)
  }
  const setRowNote = (key: string, note: string | null) =>
    setRowNotes(n => {
      const m = { ...n }
      if (note) m[key] = note
      else delete m[key]
      return m
    })

  // ── Their Fees & agreement (the tab on their customer page) ──
  // Read whenever the customer changes, and again whenever this tab comes back into view — "Change
  // for this receipt" opens their Fees & agreement tab in a new tab. Terms on screen that are still
  // their usual ones follow it; terms changed for this receipt are left as they are. Nothing is
  // changed under a booking.
  const gotAgreement = useRef<(a: CustomerAgreement) => void>(() => {})
  useLayoutEffect(() => {
    gotAgreement.current = a => {
      if (!customer || a.customerId !== customer.id || booked || bookingRef.current) return
      const before = usualTerms(customer, agreement)
      const after = usualTerms(customer, a)
      setAgreement(a)
      if (!equalTerms(before, after) && sameTerms(terms, before)) {
        setTerms(termsDraft(after))
        saving.changed("now")
      }
    }
  })
  // Whether it has been read for the customer on screen — never a guess (design rule 7): until the
  // first answer Book in waits ("Reading their fees…", AGREEMENT_WAIT_MS at most), and a read that
  // fails says so on Check & book in, with Try again — the fees on their record and the standard
  // reserve are what's shown then. A failed RE-read (the tab coming back) keeps what was read before.
  const [agreementRead, setAgreementRead] = useState<{ customerId: string; state: "ok" | "failed" | "reading" } | null>(() => {
    const c = opened ? opened.customer : initialCustomer
    return c && initialAgreement?.customerId === c.id ? { customerId: c.id, state: "ok" } : null
  })
  const [agreementTry, setAgreementTry] = useState(0)
  const customerId = customer?.id ?? null
  useEffect(() => {
    if (!customerId) return
    const id = customerId
    let live = true
    let retried = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const settle = (state: "ok" | "failed") =>
      setAgreementRead(s => (state === "failed" && s?.customerId === id && s.state === "ok" ? s : { customerId: id, state }))
    const read = () => {
      getAgreement(id).then(
        r => {
          if (!live) return
          if (!r.ok) { failed(); return }
          gotAgreement.current(r.data)
          settle("ok")
        },
        () => failed(),
      )
    }
    const failed = () => {
      if (!live) return
      settle("failed")
      // One quiet try again a moment later (a Wi-Fi blip), then it waits for Try again or the tab coming back.
      if (!retried) { retried = true; retry = setTimeout(read, AGREEMENT_RETRY_MS) }
    }
    read()
    // Book in never waits on it for longer than this.
    const slow = setTimeout(() => {
      if (live) setAgreementRead(s => (s?.customerId === id && s.state !== "reading" ? s : { customerId: id, state: "failed" }))
    }, AGREEMENT_WAIT_MS)
    const back = () => { if (document.visibilityState === "visible") read() }
    document.addEventListener("visibilitychange", back)
    return () => {
      live = false
      clearTimeout(retry)
      clearTimeout(slow)
      document.removeEventListener("visibilitychange", back)
    }
  }, [customerId, agreementTry])
  const agreementState = !customer ? null : agreementRead?.customerId === customer.id ? agreementRead.state : "reading"
  const retryAgreement = () => {
    if (!customer) return
    setAgreementRead({ customerId: customer.id, state: "reading" })
    setAgreementTry(n => n + 1)
  }
  const shownAgreement = agreementOf(customer, agreement)

  const ok = [!!customer && customerMode === "view", rows.length > 0 && rows.length <= MAX_ROWS, !!parsedTerms]
  const blocked = [
    customer ? (customerMode === "edit" ? "Save or cancel the customer's details first." : "Pick the customer first.") : "Find or add the customer first.",
    rows.length === 0 ? "Add at least one tote or pallet." : `More than ${MAX_ROWS} — split it into two receipts.`,
    "Fix the terms marked in red.",
  ]
  const reachable = (i: number) => ok.slice(0, i).every(Boolean)
  // Not while their Fees & agreement is still being read for the first time (a few seconds at most).
  const readingFees = agreementState === "reading"
  const canBook = ok.every(Boolean) && !!customer && !!parsedTerms && !readingFees

  // Number series this check-in needs that aren't set up — saving it (and so numbering) would be refused.
  const needed: CounterKey[] = ["receipt", ...(totes ? (["tote"] as const) : []), ...(pallets ? (["pallet"] as const) : [])]
  const missingNeeded = missingSeries ? needed.filter(k => missingSeries.includes(k)) : []
  const vendorSeries = missingSeries ? !missingSeries.includes("vendor") : null

  // ── Moving between steps ──
  const go = (i: number) => {
    if (bookingRef.current || i === step || i < 0 || i > LAST) return
    if (i > step && !(reachable(i) && i <= furthest + 1)) return
    setStep(i)
    setFurthest(f => Math.max(f, i))
    // Reaching the goods step the first time saves the check-in: it takes its receipt number and
    // the first row its tote number. After that, a step change saves whatever is waiting.
    if (i >= 1 && furthest < 1 && !receiptId) saving.changed("now")
    else saving.saveNow()
  }

  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    topRef.current?.scrollIntoView({ block: "start" })
    // The customer search and the goods rows put the cursor where it's needed themselves; Check
    // hands focus to its heading — never to Book in, so a stray scan's Enter can't press it.
    if (step >= 2) document.getElementById(`gi-step-${step}-heading`)?.focus({ preventScroll: true })
  }, [step])

  // After picking a customer, Next is ready — Enter (or a tap) moves on.
  useEffect(() => {
    if (!focusNext.current || step !== 0 || customerMode !== "view" || !customer) return
    focusNext.current = false
    nextRef.current?.focus({ preventScroll: true })
  })

  // Arrived with ?receipt= (Carry on) or ?customer= (Book in from the Customers screens): the screen
  // has what it needs from the address, so take them off it. Book in and Throw it away refresh this
  // page on the server, and with ?receipt= still there that refresh would find the receipt booked in
  // (or gone) and send the clerk off the Done panel to the receipt page. Next keeps the browser's own
  // replaceState in step with its router.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      if (!p.has("receipt") && !p.has("customer")) return
      p.delete("receipt")
      p.delete("customer")
      const q = p.toString()
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`)
    } catch { /* the address simply keeps them */ }
  }, [])

  // Closing or reloading the tab while something hasn't reached the Hub: the browser's own
  // warning. A check-in that IS saved needs none — it's waiting in the Hub, not booked in.
  const unsaved = !booked && (saving.pending || saving.inFlight)
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [unsaved])

  // Something on screen that isn't simply the customer the page was opened for.
  const screenHasWork =
    (!!customer && customer.id !== initialCustomer?.id) || rows.length > 1 || rows.some(r => !isBlankRow(r)) || !!notes.trim() || owner || agent

  // Following a link elsewhere in the Hub fires no warning, so the check-in is also kept in this
  // tab (sessionStorage) and offered back when Check in is opened again (`offer`, above).
  const [offerAsk, setOfferAsk] = useState(false)
  const [draftChecked, setDraftChecked] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreNote, setRestoreNote] = useState<string | null>(null)

  /** Put a check-in read back from the Hub on screen, with this tab's own unsaved typing laid over it when there was some. */
  const showLoaded = (l: CheckInLoaded, mine?: CheckInDraft | null) => {
    let rs = l.rows.map(rowFromSaved)
    let ts = termsDraft(l.terms)
    let n = l.notes ?? ""
    let o = l.ownerConfirmed
    let a = l.agentConfirmed
    const typed = mine && mine.receiptId === l.receiptId && mine.pending && mine.savedAt > Date.parse(l.updatedAt) ? mine : null
    if (typed) {
      // Text only, onto rows the Hub has. A row the tab had with no number yet is NOT added: the
      // save made on leaving may well have numbered it already, and adding it again would give the
      // same tote two numbers.
      const byId = new Map(typed.rows.filter(r => r.id).map(r => [r.id!, r]))
      rs = rs.map(r => {
        const t = byId.get(r.id!)
        return t ? { ...r, category: t.category, description: t.description } : r
      })
      if (typed.terms) ts = typed.terms
      n = typed.notes
      o = typed.owner
      a = typed.agent
    }
    saving.reset()
    setReceiptId(l.receiptId)
    setCustomer(l.customer)
    setCustomerMode("view")
    setRows(rs)
    setTerms(ts)
    setTermsOpen(!parseTerms(ts).terms)
    setNotes(n)
    setOwner(o)
    setAgent(a)
    setBookError(null)
    setBooked(null)
    setGoneIds(new Set())
    setRowNotes({})
    setPrintNote(null)
    setRelabel(null)
    setPrintedAs({})
    setOffer(null)
    setStep(l.customer ? 1 : 0)
    setFurthest(l.customer ? (rs.length ? 2 : 1) : 0)
    shownStep.current = -1
    setUnfinished(u => u.filter(x => x.receiptId !== l.receiptId))
    if (!l.customer) setRestoreNote(`The customer on ${l.receiptId} couldn't be found — find them again.`)
    if (typed) saving.changed("now")
  }

  useEffect(() => {
    // Read after mount (the server has no sessionStorage, so reading while rendering would differ).
    const d = readDraft(userId)
    const here = openedRef.current
    if (d && here && d.receiptId === here.receiptId) {
      // The check-in this page was opened to carry on: this tab may have typing the Hub hadn't saved.
      if (d.pending) showLoaded(here, d)
    } else if (!here) {
      // (Opened to carry on a particular check-in, a different one kept in this tab isn't offered: if
      // it reached the Hub it is in the unfinished lists, and this screen's copy now replaces it here.)
      setOffer(d && (d.receiptId || d.customerId || d.rows.some(r => !isBlankRow(r)) || d.rows.length > 1 || d.notes.trim()) ? d : null)
    }
    setDraftChecked(true)
    // showLoaded is only needed once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    if (!draftChecked) return // don't overwrite a kept draft before it's been offered
    if (booked) { clearDraft(); return }
    if (!receiptId && !screenHasWork) { if (!offer) clearDraft(); return }
    writeDraft({
      v: 2, userId, receiptId, customerId: customer?.id ?? null, customerName: customer ? fullName(customer) : null,
      rows, terms, notes, owner, agent, step, furthest, pending: unsaved, savedAt: Date.now(),
    })
  }, [draftChecked, booked, screenHasWork, offer, userId, receiptId, customer, rows, terms, notes, owner, agent, step, furthest, unsaved])

  // ── Leaving a check-in for another: keep it for later, or throw it away ──
  const [leave, setLeave] = useState<{ go: () => void | Promise<void> } | null>(null)
  const [leaveBusy, setLeaveBusy] = useState<"keep" | "throw" | null>(null)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  useEffect(() => {
    if (leave) leaveRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [leave])

  /** Do `go` — first asking about the check-in on screen when it is saved with something on it. */
  const switchTo = async (goNext: () => void | Promise<void>) => {
    await saving.settle()
    const cur = saving.current()
    if (!booked && cur?.receiptId) {
      // Nothing written, ticked or printed on it: there is nothing to keep, so it is thrown away
      // without asking rather than left waiting in "Check-ins not finished".
      const nothing = cur.rows.every(r => !r.category.trim() && !r.description.trim()) && !rows.some(isPrinted) && !notes.trim() && !owner && !agent
      if (nothing) {
        saving.hold(true)
        const err = await discard(cur.receiptId, true)
        if (err) saving.hold(false) // it stays in the unfinished lists, to be thrown away from there
        else saving.reset()
        await goNext()
        return
      }
      setLeaveError(null)
      setLeave({ go: goNext })
      return
    }
    await goNext()
  }

  const thrownNotice = (id: string, r: { outcome: "deleted" | "voided"; printed: string[] }): Notice =>
    r.outcome === "deleted"
      ? { tone: "ok", text: `${id} has been thrown away.` }
      : r.printed.length
        ? { tone: "warn", text: `${id} has been thrown away. Labels had been printed for ${listNumbers(r.printed)}, so it's kept as a voided receipt — throw ${r.printed.length === 1 ? "that label" : "those labels"} away.` }
        : { tone: "warn", text: `${id} has been thrown away. Something on it had already been moved, so it's kept as a voided receipt.` }

  /** Throw a check-in away in the Hub. Null when done, or what went wrong. `quiet`: say nothing unless it had to be kept as void. */
  const discard = async (id: string, quiet = false): Promise<string | null> => {
    try {
      const r = await discardCheckIn(id)
      if (!r.ok) return r.error
      if (!quiet || r.data.outcome !== "deleted") setNotice(thrownNotice(id, r.data))
      setUnfinished(u => u.filter(x => x.receiptId !== id))
      return null
    } catch {
      return "The Hub didn't answer — it may not have been thrown away. Try again."
    }
  }

  const keepForLater = async () => {
    const l = leave
    if (!l || leaveBusy) return
    setLeaveBusy("keep")
    setLeaveError(null)
    try {
      const r = await saving.flush()
      if (!r.ok) { setLeaveError(`The last changes couldn't be saved, so it's still open here: ${r.error}`); return }
      const cur = saving.current()
      if (cur?.receiptId && customer) {
        const kept: UnfinishedCheckIn = {
          receiptId: cur.receiptId, customerId: customer.id, customer: fullName(customer), rows: cur.rows.length,
          createdByName: null, updatedAt: new Date().toISOString(), mine: true,
        }
        setUnfinished(u => [kept, ...u.filter(x => x.receiptId !== kept.receiptId)])
        setNotice({ tone: "ok", text: `${cur.receiptId} is kept, not booked in — carry on with it any time from Check in or Receipts.` })
      }
      setLeave(null)
      await l.go()
    } finally {
      setLeaveBusy(null)
    }
  }

  const throwAway = async () => {
    const l = leave
    if (!l || leaveBusy) return
    setLeaveBusy("throw")
    setLeaveError(null)
    try {
      await saving.settle()
      const id = saving.current()?.receiptId ?? receiptId
      if (id) {
        saving.hold(true)
        const err = await discard(id)
        if (err) { saving.hold(false); setLeaveError(err); return }
        saving.reset() // nothing of it is left to save
      }
      setLeave(null)
      await l.go()
    } finally {
      setLeaveBusy(null)
    }
  }

  // ── Carrying on ──
  /** Open a check-in from the Hub. True once there's nothing more to offer about it (opened, or it can't be). */
  const openCheckIn = async (id: string, mine?: CheckInDraft | null): Promise<boolean> => {
    setOpening(id)
    setRestoreNote(null)
    try {
      const r = await loadCheckIn(id)
      if (!r.ok) {
        setRestoreNote(`Couldn't carry on with ${id}: ${r.error}`)
        setUnfinished(u => u.filter(x => x.receiptId !== id))
        return true
      }
      showLoaded(r.data, mine)
      return true
    } catch {
      setRestoreNote(`The Hub didn't answer while opening ${id} — check the connection and try again.`)
      return false
    } finally {
      setOpening(null)
    }
  }

  const carryOnWith = (id: string) => {
    if (opening || bookingRef.current) return
    void switchTo(async () => { await openCheckIn(id) })
  }

  /** A kept draft that never reached the Hub (from before the goods step, or from before numbers were given as rows are added). */
  const restoreLocal = async (d: CheckInDraft) => {
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
    const rs = d.rows.length ? d.rows.map(r => ({ ...r, id: null, idKind: null, labelPrintedAt: null })) : [blankRow("tote")]
    const ts = d.terms ?? termsDraft(usualTerms(c, agreement))
    // Back to the step they were on, but never past one that isn't complete any more.
    const firstGap = [!!c, rs.length > 0 && rs.length <= MAX_ROWS].findIndex(v => !v)
    const cap = firstGap < 0 ? LAST : firstGap
    const s = Math.min(d.step, cap)
    saving.reset()
    setReceiptId(null)
    setCustomer(c)
    setCustomerMode("view")
    setRows(rs)
    setTerms(ts)
    setTermsOpen(!parseTerms(ts).terms)
    setNotes(d.notes)
    setOwner(d.owner)
    setAgent(d.agent)
    setBookError(null)
    setGoneIds(new Set())
    setRowNotes({})
    setPrintNote(null)
    setRelabel(null)
    setPrintedAs({})
    setFurthest(Math.max(s, Math.min(d.furthest, cap)))
    setStep(s)
    shownStep.current = -1 // scroll back to the top
    setOffer(null)
    setRestoring(false)
    // None of it is in the Hub yet: it's saved — and numbered — once it's on the goods step or past it.
    saving.changed("now")
  }

  const carryOn = () => {
    const d = offer
    if (!d || restoring || opening || bookingRef.current) return
    void switchTo(async () => {
      if (d.receiptId) { if (await openCheckIn(d.receiptId, d)) setOffer(null) }
      else await restoreLocal(d)
    })
  }

  const [offerBusy, setOfferBusy] = useState(false)
  const [offerError, setOfferError] = useState<string | null>(null)
  const throwOfferAway = async () => {
    const d = offer
    if (!d || offerBusy) return
    if (!d.receiptId) { setOffer(null); return } // never reached the Hub — nothing to throw away there
    setOfferBusy(true)
    setOfferError(null)
    const err = await discard(d.receiptId)
    setOfferBusy(false)
    if (err) { setOfferError(err); return }
    setOffer(null)
    setOfferAsk(false)
  }

  // ── Customer ──
  const pickCustomer = (c: CustomerRow) => {
    // Same person re-saved with the terms already changed for this receipt: keep the changes.
    const keepTerms = customer?.id === c.id && !sameTerms(terms, usualTerms(customer, agreement))
    // Each label carries the customer's name. Labels already printed on this check-in still say the
    // name they were printed with — once it's someone else (or their name is corrected), say so.
    if (receiptId && customer) {
      const onLabels = relabel?.was ?? customer.name
      const printedRows = relabel ? rows.filter(r => relabel.keys.includes(r.key) && isPrinted(r)) : rows.filter(isPrinted)
      setRelabel(printedRows.length && c.name !== onLabels ? { was: onLabels, keys: printedRows.map(r => r.key), ids: printedRows.map(r => r.id!) } : null)
    }
    setCustomer(c)
    setCustomerMode("view")
    if (!keepTerms) setTerms(termsDraft(usualTerms(c, agreement)))
    focusNext.current = true
    saving.changed("now")
  }

  // ── Terms, notes, declaration (typed — saved a moment after the last change) ──
  const setTerm = (k: keyof ReceiptTerms, v: string) => { setTerms(t => ({ ...t, [k]: v })); saving.changed("typing") }
  const resetTerms = () => { setTerms(termsDraft(usualTerms(customer, agreement))); saving.changed("now") }
  const changeNotes = (v: string) => { setNotes(v); saving.changed("typing") }
  const changeOwner = (v: boolean) => { setOwner(v); saving.changed("typing") }
  const changeAgent = (v: boolean) => { setAgent(v); saving.changed("typing") }

  // ── Labels ──
  const markPrinted = ({ ids, texts }: Printed) => {
    const at = new Date().toISOString()
    setRows(rs => rs.map(r => (ids.get(r.key) && ids.get(r.key) === r.id ? { ...r, labelPrintedAt: at } : r)))
    setRowNotes(n => Object.fromEntries(Object.entries(n).filter(([k]) => !ids.has(k))))
    setPrintedAs(p => ({ ...p, ...Object.fromEntries(texts) }))
  }

  /** Print these rows' labels (row keys). `after` runs once the labels have opened. */
  const printLabels = (keys: string[], after?: () => void) => {
    if (printingRef.current || keys.length === 0) return
    // The tab is opened NOW, inside the tap: iPad Safari blocks a window opened after waiting for
    // the Hub. It is pointed at the labels once every row has its number. One named tab is reused,
    // so printing label by label doesn't leave a tab behind for each one.
    let w: Window | null = null
    try { w = window.open("", LABELS_TAB) } catch { w = null }
    if (w) {
      try {
        w.document.title = "Labels"
        w.document.body.style.cssText = "font:16px system-ui,sans-serif;padding:24px;color:#555"
        w.document.body.textContent = "Getting the labels ready…"
      } catch { /* the tab still gets the labels */ }
      try { w.focus() } catch { /* it opened; it just may not come to the front */ }
    }
    printingRef.current = true
    setPrinting(true)
    setPrintNote(null)
    void (async () => {
      try {
        const r = await saving.flush()
        if (!r.ok) {
          w?.close()
          setPrintNote({ kind: "error", message: r.lost ? "the Hub didn't answer, so the rows couldn't be numbered. Check the connection and try again." : r.error })
          return
        }
        const now = saving.current()?.rows ?? []
        const found = keys.map(k => now.find(x => x.key === k)).filter((x): x is NonNullable<typeof x> => !!x)
        if (found.length === 0 || found.some(x => !x.id)) {
          w?.close()
          setPrintNote({ kind: "error", message: found.length ? "some rows haven't got their numbers yet — try again in a moment." : "those rows have been removed." })
          return
        }
        // The label shows the row as the Hub has it now — what was just saved.
        const printed: Printed = { ids: new Map(found.map(x => [x.key, x.id!])), texts: new Map(found.map(x => [x.key, labelText(x)])) }
        const url = labelsUrl([...printed.ids.values()])
        if (w && !w.closed) {
          w.location.href = url
          markPrinted(printed)
          setPrintNote({ kind: "opened", count: printed.ids.size })
          after?.()
        } else {
          w?.close()
          setPrintNote({ kind: "blocked", url, printed, after })
        }
      } finally {
        printingRef.current = false
        setPrinting(false)
      }
    })()
  }

  const printNoteNode: ReactNode = printNote && (
    printNote.kind === "opened" ? (
      <p role="status" className="text-xs text-gray-500 dark:text-gray-400 @xl:text-right">
        {printNote.count === 1 ? "The label has" : `${printNote.count} labels have`} opened in a new tab — print {printNote.count === 1 ? "it" : "them"} on the label printer.
      </p>
    ) : printNote.kind === "blocked" ? (
      <div role="status" className={`${NOTE.warn} flex flex-wrap items-center gap-x-3 gap-y-2 !py-2`}>
        <span className="flex-1 min-w-[12rem]">The browser didn&apos;t open a new tab for the labels.</span>
        <a
          href={printNote.url}
          target={LABELS_TAB}
          rel="noopener"
          className={btnGo}
          onClick={() => { markPrinted(printNote.printed); setPrintNote({ kind: "opened", count: printNote.printed.ids.size }); printNote.after?.() }}
        >
          Open the labels
        </a>
      </div>
    ) : (
      <ErrorBox onDismiss={() => setPrintNote(null)}>Couldn&apos;t print the labels: {printNote.message}</ErrorBox>
    )
  )

  // ── Book in ──
  const bookIn = async () => {
    if (bookingRef.current || booked || !canBook || !customer || !parsedTerms) return
    bookingRef.current = true
    setBooking(true)
    setBookError(null)
    const failed = (e: BookError) => {
      setBookError(e)
      document.getElementById("gi-step-2-heading")?.scrollIntoView({ block: "start" })
    }
    try {
      // Everything saved first — the receipt exists and every row has its number.
      const f = await saving.flush()
      // An earlier Book in whose answer was lost did go through, and a change since couldn't be saved
      // because of it: Book in again simply gets that booking back (bookInCheckIn returns it).
      const bookedAlready = !f.ok && !f.lost && /has already been booked in/i.test(f.error) && !!saving.current()?.receiptId
      if (!f.ok && !bookedAlready) { failed(f.lost ? { kind: "lost" } : { kind: "server", message: f.error }); return }
      const cur = saving.current()
      if (!cur?.receiptId) { failed({ kind: "server", message: "The check-in hasn't been saved yet." }); return }
      saving.hold(true) // a late keystroke mustn't save over a receipt that's just been booked in
      const res = await bookInCheckIn({ ...cur, receiptId: cur.receiptId, terms: parsedTerms })
      if (!res.ok) { saving.hold(false); failed({ kind: "server", message: res.error }); return }
      const byId = new Map(cur.rows.filter(r => r.id).map(r => [r.id!, r]))
      const shown = new Map(rows.map(r => [r.key, r]))
      const containers = res.data.containerIds.map((id, i) => {
        const r = byId.get(id) ?? cur.rows[i]
        const g = r ? shown.get(r.key) : undefined
        return {
          id,
          kind: r?.kind ?? ("tote" as const),
          category: r?.category.trim() || null,
          description: r?.description.trim() || null,
          labelPrintedAt: g && g.id === id ? g.labelPrintedAt : null,
        }
      })
      saving.reset()
      setBooked({ receiptId: res.data.receiptId, containers, customer, vendorNo: res.data.vendorNo ?? customer.vendorNo })
      setUnfinished(u => u.filter(x => x.receiptId !== res.data.receiptId))
    } catch {
      saving.hold(false)
      failed({ kind: "lost" })
    } finally {
      bookingRef.current = false
      setBooking(false)
    }
  }

  const startFresh = () => {
    saving.reset()
    setReceiptId(null)
    setCustomer(null)
    setCustomerMode("view")
    setRows([blankRow("tote")])
    setTerms(termsDraft(DEFAULT_TERMS))
    setTermsOpen(false)
    setNotes("")
    setOwner(false)
    setAgent(false)
    setBookError(null)
    setRestoreNote(null)
    setBooked(null)
    setGoneIds(new Set())
    setRowNotes({})
    setPrintNote(null)
    setRelabel(null)
    setPrintedAs({})
    setFurthest(0)
    setStep(0)
    shownStep.current = -1 // so the page scrolls back to the top even if it was already on step 0
  }

  if (booked) return <div className="@container"><DonePanel booked={booked} onAnother={startFresh} /></div>

  const errorBox: ReactNode = bookError && (
    <ErrorBox onDismiss={() => setBookError(null)}>
      {bookError.kind === "lost" ? (
        <>
          <b>The Hub didn&apos;t answer</b> — the connection may have dropped. Press Book in again: if it did go through, it won&apos;t be booked in twice.
        </>
      ) : isNumberingError(bookError.message) ? (
        <>
          <b>Couldn&apos;t book in:</b> {bookError.message}{" "}
          <Link href="/tools/warehouse/settings" target="_blank" className="underline font-semibold">Open Goods In → Settings</Link>
          {" "}(a new tab, so nothing here is lost){isAdmin ? ", set it there" : " for an admin to set it"}, then press Book in again. It hasn&apos;t been booked in yet.
        </>
      ) : (
        <>
          <b>Couldn&apos;t book in:</b> {bookError.message}
          {/* Thrown away or voided elsewhere: pressing again can't help, and the message says what it is. One that already says nothing was booked needs no second line. */}
          {thrownAwayMsg(bookError.message) || bookedOrVoidMsg(bookError.message) || /nothing was booked in/i.test(bookError.message) ? null : <> It hasn&apos;t been booked in — fix it and press Book in again.</>}
        </>
      )}
    </ErrorBox>
  )

  // The check-in as this screen has it — to lay over the Hub's copy when it is opened again.
  const draftNow = (): CheckInDraft => ({
    v: 2, userId, receiptId, customerId: customer?.id ?? null, customerName: customer ? fullName(customer) : null,
    rows, terms, notes, owner, agent, step, furthest, pending: true, savedAt: Date.now(),
  })
  /** The Hub has moved on from this screen's copy (another tab, or an answer that never arrived): read it again, keeping what was typed here. */
  const openAgain = () => {
    if (!receiptId || opening) return
    void openCheckIn(receiptId, draftNow())
  }
  /** This check-in was thrown away elsewhere: nothing more can be saved to it. */
  const leaveGone = () => {
    if (receiptId) setUnfinished(u => u.filter(x => x.receiptId !== receiptId))
    startFresh()
  }

  // "Saved" / "Saving…" / "Not saved — …" with Retry, beside the receipt number. Some refusals can't
  // be fixed by trying again — then the button is the thing that helps instead.
  const failedMsg = saving.error?.message ?? null
  const fixBtn = "inline-flex min-h-11 items-center px-1 font-semibold underline"
  const savingNow = (
    <span className="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-pulse" />Saving…
    </span>
  )
  const status: ReactNode = !active ? null
    : saving.inFlight ? savingNow
    : saving.error ? (
      <span role="alert" className="inline-flex flex-wrap items-center gap-x-2 text-red-700 dark:text-red-300">
        <span>
          {failedMsg == null ? "Not saved — the Hub didn't answer." : <>Not saved: {failedMsg}</>}
          {failedMsg && isNumberingError(failedMsg) && (
            <> <Link href="/tools/warehouse/settings" target="_blank" className="underline font-semibold">Open Goods In → Settings</Link></>
          )}
        </span>
        {failedMsg && receiptId && reopenNeeded(failedMsg) ? (
          <button type="button" className={fixBtn} disabled={!!opening} onClick={openAgain}>{opening === receiptId ? "Opening it…" : "Open it again"}</button>
        ) : failedMsg && thrownAwayMsg(failedMsg) ? (
          <button type="button" className={fixBtn} onClick={leaveGone}>Start a new check-in</button>
        ) : failedMsg && receiptId && bookedOrVoidMsg(failedMsg) ? (
          <Link href={`/tools/warehouse/receipts/${encodeURIComponent(receiptId)}`} className={fixBtn}>Open the receipt</Link>
        ) : (
          <button type="button" className={fixBtn} onClick={() => saving.saveNow()}>Retry</button>
        )}
      </span>
    )
    : saving.pending ? savingNow
    : receiptId ? <span className="text-gray-500 dark:text-gray-400"><span aria-hidden className="text-emerald-600 dark:text-emerald-400">✓</span> Saved</span>
    : null

  const firstProblem = ok.findIndex(v => !v)
  const barNote =
    step < LAST ? (ok[step] ? "" : blocked[step])
    : firstProblem >= 0 ? blocked[firstProblem]
    : missingNeeded.length > 0 ? "The number series isn't set up yet — see the note at the top."
    : ""

  const subs = [customer ? fullName(customer) : "Find or add", kindsPhrase(totes, pallets), ""]

  // The tab's kept check-in is offered only while this screen hasn't one of its own in the Hub.
  const shownOffer = receiptId ? null : offer
  // Only the person's OWN unfinished check-ins are offered here; everyone's are on the dashboard and Receipts.
  const others = unfinished.filter(u => u.mine && u.receiptId !== receiptId && u.receiptId !== shownOffer?.receiptId)
  const showUnfinished = step === 0 && !hideUnfinished && others.length > 0
  const printedHere = rows.filter(isPrinted).map(r => r.id!)
  // The customer on screen already has a check-in waiting (they came back with more, or a colleague
  // started one): say so once, so a second receipt isn't started by accident.
  const existing = customer ? unfinished.find(u => u.customerId === customer.id && u.receiptId !== receiptId) ?? null : null

  return (
    <div className="@container">
      <div ref={topRef} className="scroll-mt-4" />

      {notice && (
        <div role="status" className={`${notice.tone === "ok" ? NOTE.ok : NOTE.warn} mb-5 flex items-start gap-3`}>
          <span className="flex-1">{notice.text}</span>
          <button type="button" className="-my-3 inline-flex min-h-11 items-center px-2 text-xs underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {relabel && (
        <div role="status" className={`${NOTE.warn} mb-5`}>
          <p>
            The {relabel.ids.length === 1 ? "label" : "labels"} printed for <span className={`${mono} font-semibold`}>{listNumbers(relabel.ids)}</span> still
            {" "}{relabel.ids.length === 1 ? "says" : "say"} <b>{relabel.was}</b> — reprint {relabel.ids.length === 1 ? "it" : "them"}{customer ? <> so {relabel.ids.length === 1 ? "it shows" : "they show"} <b>{customer.name}</b></> : null}.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={btnGo} disabled={printing} onClick={() => printLabels(relabel.keys, () => setRelabel(null))} aria-busy={printing}>
              {printing ? "Getting the labels ready…" : relabel.ids.length === 1 ? "Reprint it" : "Reprint them"}
            </button>
            <button type="button" className={btn} onClick={() => setRelabel(null)}>Dismiss</button>
          </div>
          {step !== 1 && printNote && <div className="mt-3">{printNoteNode}</div>}
        </div>
      )}

      {leave && (
        <div ref={leaveRef} className={`${NOTE.warn} mb-5 scroll-mt-4`}>
          <p className="font-semibold">
            {customer ? <>{fullName(customer)}&apos;s check-in</> : "This check-in"} isn&apos;t booked in yet
          </p>
          <p className="mt-1">
            {receiptId && <>Receipt <span className={`${mono} font-semibold`}>{receiptId}</span> · </>}{kindsPhrase(totes, pallets)}.
            {" "}Keep it for later and it stays as it is, not booked in — anyone can carry on with it from Check in or Receipts. Or throw it away
            {printedHere.length ? <>: its numbers won&apos;t be used again, so throw away the labels printed for {listNumbers(printedHere)} too</> : null}.
          </p>
          {leaveError && <div className="mt-3"><ErrorBox onDismiss={() => setLeaveError(null)}>{leaveError}</ErrorBox></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnGo} disabled={!!leaveBusy} onClick={() => void keepForLater()} aria-busy={leaveBusy === "keep"}>
              {leaveBusy === "keep" ? "Saving it…" : "Keep it for later"}
            </button>
            <button type="button" className={btnDanger} disabled={!!leaveBusy} onClick={() => void throwAway()} aria-busy={leaveBusy === "throw"}>
              {leaveBusy === "throw" ? "Throwing it away…" : "Throw it away"}
            </button>
            <button type="button" className={btn} disabled={!!leaveBusy} onClick={() => setLeave(null)}>Stay on it</button>
          </div>
        </div>
      )}

      {shownOffer && (
        <div className={`${NOTE.info} mb-5`}>
          <p className="font-semibold">
            There&apos;s an unfinished check-in{shownOffer.customerName ? <> for {shownOffer.customerName}</> : null} in this tab
          </p>
          <p className="mt-1">
            {draftSummary(shownOffer)}, left at {ukDateTime(new Date(shownOffer.savedAt))}.{" "}
            {shownOffer.receiptId ? <>It&apos;s receipt <span className={`${mono} font-semibold`}>{shownOffer.receiptId}</span>, not booked in yet.</> : "Nothing from it has been booked in."}
            {screenHasWork && " Carrying on with it replaces what's on this screen now."}
          </p>
          {offerError && <div className="mt-3"><ErrorBox onDismiss={() => setOfferError(null)}>{offerError}</ErrorBox></div>}
          {offerAsk && shownOffer.receiptId ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="basis-full">
                Throw {shownOffer.receiptId} away? Its numbers won&apos;t be used again — any label already printed for it goes in the bin too.
              </span>
              <button type="button" className={btnDanger} disabled={offerBusy} onClick={() => void throwOfferAway()} aria-busy={offerBusy}>
                {offerBusy ? "Throwing it away…" : "Yes, throw it away"}
              </button>
              <button type="button" className={btn} disabled={offerBusy} onClick={() => setOfferAsk(false)}>Keep it</button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btnGo} disabled={restoring || booking || !!opening} onClick={carryOn} aria-busy={restoring || opening === shownOffer.receiptId}>
                {restoring || (opening && opening === shownOffer.receiptId) ? "Opening it…" : shownOffer.customerName ? `Carry on with the check-in for ${shownOffer.customerName}` : "Carry on with that check-in"}
              </button>
              <button type="button" className={btn} disabled={restoring || !!opening} onClick={() => (shownOffer.receiptId ? setOfferAsk(true) : setOffer(null))}>Throw it away</button>
            </div>
          )}
        </div>
      )}

      {restoreNote && (
        <div className="mb-5">
          <ErrorBox onDismiss={() => setRestoreNote(null)}>{restoreNote}</ErrorBox>
        </div>
      )}

      {showUnfinished && (
        <div className={`${NOTE.info} mb-5 !pt-1`}>
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <p className="font-semibold">Your check-ins not booked in yet</p>
            <button type="button" className="-mr-1 inline-flex min-h-11 items-center px-1 text-xs underline" onClick={() => setHideUnfinished(true)}>Hide</button>
          </div>
          <ul className="divide-y divide-indigo-200 dark:divide-indigo-800/60">
            {others.slice(0, 5).map(u => (
              <li key={u.receiptId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1">
                  <b>{u.customer}</b> · <span className={mono}>{u.receiptId}</span> · {u.rows} {u.rows === 1 ? "tote or pallet" : "totes and pallets"}
                  <span className="block text-xs text-indigo-800/80 dark:text-indigo-200/80">Last changed {ukDateTime(u.updatedAt)}</span>
                </span>
                <button
                  type="button"
                  className={btn}
                  disabled={!!opening || booking}
                  onClick={() => carryOnWith(u.receiptId)}
                  aria-label={`Carry on with ${u.customer}'s check-in`}
                  aria-busy={opening === u.receiptId}
                >
                  {opening === u.receiptId ? "Opening it…" : "Carry on"}
                </button>
              </li>
            ))}
          </ul>
          {others.length > 5 && (
            <p className="mt-1 text-xs">
              And {others.length - 5} more — see <Link href="/tools/warehouse/receipts?status=draft" className="inline-flex min-h-11 items-center underline font-semibold">Receipts</Link>.
            </p>
          )}
        </div>
      )}

      {missingNeeded.length > 0 && (
        <div className={`${NOTE.warn} mb-5`}>
          <p className="font-semibold">Numbers can&apos;t be given yet</p>
          <p className="mt-1">
            The {listWords(missingNeeded.map(k => COUNTERS[k].label.toLowerCase().replace(/s$/, "")))} numbers haven&apos;t been set up, so the Hub has no number to give — rows can&apos;t be numbered or labelled, and nothing can be booked in.{" "}
            {isAdmin ? "You can set where each series starts in " : "An admin sets where each series starts in "}
            <Link href="/tools/warehouse/settings" target="_blank" className="font-semibold underline">Goods In → Settings</Link>.
            {" "}You can fill everything in meanwhile — it&apos;s kept on this screen.
          </p>
          <button
            type="button"
            className={`${btn} mt-3`}
            disabled={checking}
            onClick={() => { startChecking(() => router.refresh()); saving.saveNow() }}
          >
            {checking ? "Checking…" : "They've been set — check again"}
          </button>
        </div>
      )}

      <StepBar step={step} furthest={furthest} ok={ok} reachable={reachable} go={go} subs={subs} />

      {/* Who it's for, and the receipt as the Hub has it — the same strip on both steps after Customer. */}
      {step >= 1 && customer && (
        <div className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-gray-200 dark:border-gray-800 pb-3 text-sm">
          <p className="min-w-0 text-gray-600 dark:text-gray-400">
            Booking in for <b className="text-gray-900 dark:text-white">{fullName(customer)}</b>
            {customer.vendorNo && <> · <span className={`${mono} text-gray-700 dark:text-gray-300`}>{customer.vendorNo}</span></>}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 text-gray-500 dark:text-gray-400">
            {receiptId ? (
              <>
                <span>Receipt <span className={`${mono} font-semibold text-gray-900 dark:text-white`}>{receiptId}</span></span>
                <span aria-hidden>·</span>
                <span>not booked in yet</span>
                {status && (
                  <>
                    <span aria-hidden>·</span>
                    {status}
                  </>
                )}
              </>
            ) : saving.error ? (
              status
            ) : (
              <span>{numbering ? "Taking a receipt number…" : "No receipt number yet"}</span>
            )}
          </div>
        </div>
      )}

      <div className="min-h-[40vh]">
        {step === 0 && (
          <CustomerStep
            customer={customer}
            mode={customerMode}
            setMode={setCustomerMode}
            onPick={pickCustomer}
            vendorSeries={vendorSeries}
            onAnother={receiptId ? () => void switchTo(startFresh) : undefined}
            existing={existing}
            onCarryOnExisting={existing ? () => carryOnWith(existing.receiptId) : undefined}
            opening={!!existing && opening === existing.receiptId}
            hubOwns={hubOwns}
          />
        )}
        {step === 1 && (
          <GoodsStep
            rows={rows}
            editRows={editRows}
            numbering={numbering}
            goneIds={goneIds}
            rowNotes={rowNotes}
            onRowNote={setRowNote}
            onPrint={printLabels}
            printing={printing}
            printNote={printNoteNode}
            printedAs={printedAs}
          />
        )}
        {step === 2 && customer && (
          <CheckStep
            customer={customer}
            agreement={shownAgreement}
            agreementUnread={agreementState === "failed" && !shownAgreement}
            onRetryAgreement={retryAgreement}
            rows={rows}
            terms={terms}
            setTerm={setTerm}
            onResetTerms={resetTerms}
            termsOpen={termsOpen}
            setTermsOpen={setTermsOpen}
            notes={notes}
            setNotes={changeNotes}
            owner={owner}
            setOwner={changeOwner}
            agent={agent}
            setAgent={changeAgent}
            vendorSeries={vendorSeries}
            numbering={numbering}
            goTo={go}
            onRemoveBlank={() => editRows(rs => rs.filter(r => !isBlankRow(r)), "now")}
            error={errorBox}
            printedAs={printedAs}
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
            {step < LAST ? (
              <button ref={nextRef} type="button" className={btnGo} disabled={!ok[step]} onClick={() => go(step + 1)}>
                Next: {STEPS[step + 1].title} →
              </button>
            ) : (
              <button type="button" className={`${btnGo} !min-h-14 !px-8 !text-base`} disabled={booking || !canBook} onClick={() => void bookIn()} aria-busy={booking}>
                {booking
                  ? <><span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> Booking in {kindsPhrase(totes, pallets)}…</>
                  : readingFees && ok.every(Boolean) ? "Reading their fees…"
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
      <ol className="grid grid-cols-3 gap-1.5 @lg:gap-2">
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
