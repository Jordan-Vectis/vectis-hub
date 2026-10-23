"use server"

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { revalidatePath } from "next/cache"
import { GoodsInAccessError, requireGoodsIn } from "@/lib/goods-in/access"
import { NumberingNotSetError, takeNumbers } from "@/lib/goods-in/numbers"
import {
  DEFAULT_TERMS, LABEL_GIVEN_UP_NOTE, THROWN_AWAY_NOTE, labelsGivenUp, normaliseCode, usualTermsFrom, type ContainerKind, type ReceiptTerms,
} from "@/lib/goods-in/model"
import { CUSTOMER_INCLUDE, PERSON_NAME, customerRow, personName, snapshot } from "@/lib/goods-in/customer-row"
import { AGREEMENT_UNREAD, findAgreement, readAgreement, type AgreementTerms } from "@/lib/goods-in/agreement"
import type { CustomerRow, Result } from "@/lib/actions/goods-in"

// Goods In → Check in: the check-in is SAVED AS IT GOES, so every tote and pallet has its real
// number on the screen and its label can be printed before the customer has left the counter
// (Jack, 2026-10-16: "this needs to show the tote number and also needs to be able to print the
// tote labels etc from this"). SERVER ONLY (server actions).
//
// • A check-in is a receipt with status "draft" ("not booked in yet") from the moment the clerk
//   reaches the goods step. That first save takes the receipt number; each tote or pallet row takes
//   its number as soon as it exists. Nothing about a draft counts as booked in until Book in turns
//   it "open" (RULES.md → Goods In).
// • Numbers are never reused. A removed row, or a tote switched to a pallet, gives its number up for
//   good — the counter has already moved past it, so it is simply a gap.
// • Anything that has MOVED (a GoodsInMovement, or a location recorded on it) is never deleted or
//   re-numbered here: its history must still read.
// • A tote or pallet whose LABEL was printed is never lost without trace: taking one off the
//   check-in (removed, or switched between tote and pallet) adds a LABEL_GIVEN_UP_NOTE line to the
//   receipt's notes, which throwing the check-in away reads back (so it is voided, not deleted); and
//   one the screen never had (another tab, an older copy) is refused rather than taken off unseen.
// • Every action that writes locks the receipt row FIRST (SELECT … FOR UPDATE), then its totes and
//   pallets in id order, so two tabs on the same check-in queue instead of interleaving, and a
//   double-tapped Book in books once.
// • Terms are the customer's usual ones unless the clerk changed them for this receipt — check-in
//   no longer has a Terms step and never asks. "Usual" = their Fees & agreement tab: fees from
//   GoodsInCustomer, reserve from GoodsInAgreement, DEFAULT_TERMS where either is blank. The
//   agreement (and its special arrangement, copied into the customer snapshot) is read tolerantly
//   and BEFORE each transaction (lib/goods-in/agreement.ts): it needs Run Migrations, and a failed
//   query inside a transaction would abort the save.
//
// ⚠ Each action RETURNS { ok, error } rather than throwing (a thrown server-action error is redacted
// in production — RULES.md). Nothing here reads or writes Business Central.

/** One row on the goods step. `key` is the browser's own id for the row (stable, echoed back). */
export type CheckInRowInput = { key: string; id: string | null; kind: ContainerKind; category: string; description: string }
export type CheckInRowSaved = {
  key: string; id: string; kind: ContainerKind
  category: string | null; description: string | null
  labelPrintedAt: string | null   // ISO
}
export type CheckInInput = {
  receiptId: string | null          // null = not saved yet
  customerId: string
  rows: CheckInRowInput[]           // in screen order, ≤ 200
  /**
   * The numbers this screen had and has taken off (removed rows). When it is sent, a tote or pallet
   * with a printed label that is on the receipt but neither on the screen nor in this list (another
   * tab added it, or the screen is an older copy) is refused, naming it, instead of being taken off
   * unseen. Left out, every tote or pallet the rows don't mention is taken off, as before.
   */
  removed?: string[]
  terms?: Partial<ReceiptTerms> | null
  notes?: string | null
  ownerConfirmed?: boolean
  agentConfirmed?: boolean
}
export type CheckInLoaded = {
  receiptId: string; customerId: string; customer: CustomerRow | null
  rows: CheckInRowSaved[]           // key = id for loaded rows, in createdAt/id order
  terms: ReceiptTerms; notes: string | null; ownerConfirmed: boolean; agentConfirmed: boolean
  createdByName: string | null; updatedAt: string
}
export type UnfinishedCheckIn = {
  receiptId: string; customerId: string; customer: string; rows: number; createdByName: string | null; updatedAt: string
  /** Started by the person asking. */
  mine: boolean
}

type Tx = Prisma.TransactionClient

const MAX_ROWS = 200
const MAX_CATEGORY = 80
const MAX_DESCRIPTION = 500
// Up to three round trips per new row (number, free check) plus the rest — 200 rows at once is far
// past Prisma's default 5-second transaction, so this gets createReceipt's allowance.
const TX_OPTIONS = { timeout: 20_000 }

/** A message meant for the person, passed through as it is. */
class Refusal extends Error {}

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof Refusal || e instanceof NumberingNotSetError || e instanceof GoodsInAccessError) return { ok: false, error: e.message }
  const msg = String((e as { message?: string })?.message ?? e)
  if ((e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") || /expired transaction|transaction already closed/i.test(msg)) {
    return { ok: false, error: "The Hub took too long to save the check-in, so nothing was changed — try again." }
  }
  // Two tabs (or a tab and a label print) changing the same totes at the same moment: Postgres stops
  // one and rolls it back, so "nothing was saved" is true.
  if ((e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") || /40P01|deadlock detected|40001|could not serialize/i.test(msg)) {
    return { ok: false, error: "Something else was changing this check-in at that moment, so nothing was saved — try again." }
  }
  if (/does not exist|relation .*GoodsIn/i.test(msg)) return { ok: false, error: "Goods In isn't set up on this environment yet — an admin needs to press Run Migrations." }
  console.error("goods-in check-in action error:", e)
  return { ok: false, error: msg.length < 200 ? msg : "Something went wrong — please try again." }
}

const who = () => requireGoodsIn("warehouse")

const blank = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
const cut = (v: unknown, max: number) => {
  const s = blank(v)
  return s && s.length > max ? s.slice(0, max).trimEnd() : s
}
const listed = (ids: string[]) => (ids.length <= 8 ? ids.join(", ") : `${ids.slice(0, 8).join(", ")} and ${ids.length - 8} more`)
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)
const asKind = (k: string | null | undefined): ContainerKind => (k === "pallet" ? "pallet" : "tote")
const londonNow = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date())
/** The customer as the receipt keeps them, with their special arrangement as it stands now. */
const snapJson = (c: CustomerRow, vendorNo: string | null, a: AgreementTerms) =>
  ({ ...snapshot(c, { specialArrangement: a.specialArrangement }), vendorNo }) as unknown as Prisma.InputJsonValue

// ─── Notes ─────────────────────────────────────────────────────────────────────────────────
// A draft's notes are what the clerk typed, followed by any LABEL_GIVEN_UP_NOTE lines the Hub keeps
// there itself. The screen is sent (and sends back) only the typed part, so a save can never drop
// the record of a printed label.

const isRecordLine = (l: string) => l.startsWith(LABEL_GIVEN_UP_NOTE)
function splitNotes(notes: string | null | undefined): { typed: string | null; record: string[] } {
  const lines = (notes ?? "").split(/\r?\n/)
  return { typed: blank(lines.filter(l => !isRecordLine(l)).join("\n")), record: lines.filter(isRecordLine) }
}
/** The notes to save: what was typed (or, when nothing was sent, what was there), every record line already kept, then `add`. */
function draftNotes(sent: string | null | undefined, existing: string | null, add: string | null): string | null {
  const was = splitNotes(existing)
  const typed = sent === undefined ? was.typed : splitNotes(sent).typed
  const out = [typed, ...was.record, add].filter((x): x is string => !!x)
  return out.length ? out.join("\n") : null
}
const givenUpLine = (ids: string[], byName: string | null) =>
  `${LABEL_GIVEN_UP_NOTE}: ${ids.join(", ")} (${londonNow()}${byName ? `, by ${byName}` : ""}).`

// ─── Rows ──────────────────────────────────────────────────────────────────────────────────

type CleanRow = { key: string; id: string | null; kind: ContainerKind; category: string | null; description: string | null }

/** The rows as sent, checked: each a tote or pallet, keys and numbers once each. */
function cleanRows(raw: unknown): CleanRow[] {
  // Never read a missing list as "no rows" — that would take every tote off the check-in.
  if (!Array.isArray(raw)) throw new Refusal("The check-in's rows didn't arrive — try again.")
  if (raw.length > MAX_ROWS) throw new Refusal("That's more than 200 totes and pallets on one receipt — split it into two receipts.")
  const keys = new Set<string>()
  const ids = new Set<string>()
  return raw.map((r): CleanRow => {
    const row = (r && typeof r === "object" ? r : {}) as Partial<CheckInRowInput>
    if (row.kind !== "tote" && row.kind !== "pallet") throw new Refusal("Every row must be a tote or a pallet.")
    const key = typeof row.key === "string" ? row.key : ""
    if (!key || keys.has(key)) throw new Refusal("Two rows on the screen got mixed up — open the check-in again and carry on.")
    keys.add(key)
    const id = typeof row.id === "string" && row.id.trim() ? normaliseCode(row.id) : null
    if (id) {
      if (ids.has(id)) throw new Refusal(`${id} is on the list twice — remove one of them.`)
      ids.add(id)
    }
    return { key, id, kind: row.kind, category: cut(row.category, MAX_CATEGORY), description: cut(row.description, MAX_DESCRIPTION) }
  })
}

/** The numbers the screen says it took off — null when it didn't say (every unmentioned one goes). */
function cleanRemoved(raw: unknown): Set<string> | null {
  if (!Array.isArray(raw)) return null
  const out = new Set<string>()
  for (const v of raw.slice(0, 1000)) if (typeof v === "string" && v.trim()) out.add(normaliseCode(v))
  return out
}

type HeldReceipt = { id: string; status: string | null; customerId: string | null; vendorNo: string | null; notes: string | null }
type HeldContainer = { id: string; kind: string; category: string | null; description: string | null; labelPrintedAt: Date | null; locationCode: string | null }

/** The receipt row, locked for the rest of the transaction — or null when there is none. */
async function lockReceipt(tx: Tx, id: string): Promise<HeldReceipt | null> {
  const rows = await tx.$queryRaw<HeldReceipt[]>`
    SELECT "id", "status", "customerId", "vendorNo", "notes" FROM "GoodsInReceipt" WHERE "id" = ${id} FOR UPDATE`
  return rows[0] ?? null
}

/**
 * The receipt's totes and pallets, locked in id order, and which of them have moved. Locking them
 * (not just the receipt) matters: a Scan to move or a label print touches the tote, not the receipt,
 * so it now waits for this save — and a move that lands first is seen here, never deleted with it.
 */
async function lockContainers(tx: Tx, receiptId: string): Promise<{ held: HeldContainer[]; moved: Set<string> }> {
  const held = await tx.$queryRaw<HeldContainer[]>`
    SELECT "id", "kind", "category", "description", "labelPrintedAt", "locationCode"
    FROM "GoodsInContainer" WHERE "receiptId" = ${receiptId} ORDER BY "id" FOR UPDATE`
  const ids = held.map(h => h.id)
  const withMoves = ids.length
    ? await tx.goodsInMovement.findMany({ where: { containerId: { in: ids } }, select: { containerId: true }, distinct: ["containerId"] })
    : []
  const moved = new Set(withMoves.map(m => m.containerId).filter((x): x is string => !!x))
  for (const h of held) if (h.locationCode) moved.add(h.id)
  return { held, moved }
}

/** Why a receipt that was asked for as a check-in isn't one (any more). */
function notADraft(id: string, r: { status: string | null; notes: string | null } | null): string {
  if (!r) return `${id} was thrown away.`
  if (r.status === "void") return (r.notes ?? "").includes(THROWN_AWAY_NOTE) ? `${id} was thrown away.` : `${id} has been voided — open it from Receipts.`
  return `${id} has already been booked in — open it from Receipts.`
}

/**
 * Make the receipt's totes and pallets match the rows on the screen, in one go:
 *  - a numbered row keeps its number (category and description saved when they changed);
 *  - a numbered row whose kind changed gives its number up and takes a new one of the new kind;
 *  - a row with no number takes the next tote or pallet number — in screen order;
 *  - a tote or pallet no row mentions is deleted.
 * Deleting or re-numbering anything that has moved is refused, naming it, before anything is written;
 * so is taking off, unseen, one with a printed label that the screen never had (`asked` is the list
 * the screen says it removed — null when it didn't send one). `removedPrinted` is what was taken off
 * after its label was printed, for the caller to record in the notes.
 */
async function syncRows(
  tx: Tx, receiptId: string, rows: CleanRow[], asked: Set<string> | null, byName: string | null,
): Promise<{ rows: CheckInRowSaved[]; removed: string[]; removedPrinted: string[] }> {
  const { held, moved } = await lockContainers(tx, receiptId)
  const byId = new Map(held.map(h => [h.id, h]))

  const strangers = rows.filter(r => r.id && !byId.has(r.id)).map(r => r.id!)
  if (strangers.length) {
    throw new Refusal(`${listed(strangers)} ${strangers.length === 1 ? "isn't" : "aren't"} on ${receiptId} any more — open the check-in again to see it as it is now.`)
  }
  const switched = rows.filter(r => r.id && byId.get(r.id)!.kind !== r.kind)
  const mentioned = new Set(rows.map(r => r.id).filter((x): x is string => !!x))
  const dropped = held.filter(h => !mentioned.has(h.id)).map(h => h.id)

  // Labelled, and not on this screen, and not removed from it: another tab added it, or this screen
  // is an older copy. Its label is out there, so it is never taken off without the clerk seeing it.
  // (One with no label printed is simply taken off — a save whose answer was lost numbered it, and
  // the retry has numbered that row again; its number becomes a gap.)
  if (asked) {
    const unseen = dropped.filter(id => !asked.has(id) && byId.get(id)!.labelPrintedAt)
    if (unseen.length) {
      const one = unseen.length === 1
      throw new Refusal(`${listed(unseen)} ${one ? "is" : "are"} on ${receiptId} with ${one ? "its label" : "labels"} printed, but not on this screen — open the check-in again to see it as it is now.`)
    }
  }

  const stuckSwitch = switched.filter(r => moved.has(r.id!))
  if (stuckSwitch.length) {
    const ids = stuckSwitch.map(r => r.id!)
    throw new Refusal(ids.length === 1
      ? `${ids[0]} has already been moved to a location, so it can't be changed to a ${stuckSwitch[0].kind} — it keeps its number. Add a new ${stuckSwitch[0].kind} row instead.`
      : `${listed(ids)} have already been moved to a location, so they can't be changed — they keep their numbers. Add new rows instead.`)
  }
  const stuckDrop = dropped.filter(id => moved.has(id))
  if (stuckDrop.length) {
    const one = stuckDrop.length === 1
    throw new Refusal(`${listed(stuckDrop)} ${one ? "has" : "have"} already been moved to a location, so ${one ? "it can't" : "they can't"} be taken off this check-in — put ${one ? "it" : "them"} back on the list.`)
  }

  const removed = [...switched.map(r => r.id!), ...dropped]
  const removedPrinted = removed.filter(id => byId.get(id)!.labelPrintedAt)
  if (removed.length) await tx.goodsInContainer.deleteMany({ where: { id: { in: removed }, receiptId } })
  // Numbers the screen took off that were already gone (an answer it never got): gone, so it forgets them.
  const alreadyGone = asked ? [...asked].filter(id => !byId.has(id)) : []

  for (const r of rows) {
    const h = r.id ? byId.get(r.id) : undefined
    if (!h || h.kind !== r.kind) continue
    if (h.category !== r.category || h.description !== r.description) {
      await tx.goodsInContainer.update({ where: { id: h.id }, data: { category: r.category, description: r.description } })
    }
  }

  // New numbers, handed out in the order the rows are on the screen.
  const needs = rows.filter(r => !r.id || byId.get(r.id)!.kind !== r.kind)
  const totes = needs.filter(r => r.kind === "tote").length
  const pallets = needs.length - totes
  const toteNos = totes ? await takeNumbers(tx, "tote", totes) : []
  const palletNos = pallets ? await takeNumbers(tx, "pallet", pallets) : []
  const given = new Map<string, string>()
  let ti = 0, pi = 0
  for (const r of needs) given.set(r.key, r.kind === "tote" ? toteNos[ti++] : palletNos[pi++])
  if (needs.length) {
    await tx.goodsInContainer.createMany({
      data: needs.map(r => ({ id: given.get(r.key)!, receiptId, kind: r.kind, category: r.category, description: r.description, status: "booked", createdByName: byName })),
    })
  }

  return {
    rows: rows.map((r): CheckInRowSaved => {
      const fresh = given.get(r.key)
      const h = fresh ? null : byId.get(r.id!)!
      return { key: r.key, id: fresh ?? h!.id, kind: r.kind, category: r.category, description: r.description, labelPrintedAt: h ? iso(h.labelPrintedAt) : null }
    }),
    removed: [...removed, ...alreadyGone],
    removedPrinted,
  }
}

// ─── Terms ─────────────────────────────────────────────────────────────────────────────────

const TERM_RULES: { key: keyof ReceiptTerms; label: string; unit: "%" | "£"; max: number; whole?: boolean }[] = [
  { key: "commission", label: "commission", unit: "%", max: 100 },
  { key: "lottingFee", label: "lotting fee", unit: "£", max: 100_000 },
  { key: "photographyFee", label: "photography fee", unit: "£", max: 100_000 },
  { key: "unsoldFee", label: "unsold fee", unit: "£", max: 100_000 },
  { key: "reservePercent", label: "reserve", unit: "%", max: 100, whole: true },
]

/** One term as sent: its value, nothing (not sent), or why it can't be used. */
function readTerm(rule: (typeof TERM_RULES)[number], v: unknown): { value: number | null; error: string | null } {
  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return { value: null, error: null }
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim().replace(/^£/, "").replace(/%$/, "")) : NaN
  if (!Number.isFinite(n)) return { value: null, error: `the ${rule.label} isn't a number` }
  if (n < 0) return { value: null, error: `the ${rule.label} can't be less than 0` }
  if (n > rule.max) return { value: null, error: rule.unit === "%" ? `the ${rule.label} can't be more than ${rule.max}%` : `the ${rule.label} looks too big` }
  return { value: rule.whole ? Math.round(n) : Math.round(n * 100) / 100, error: null }
}

const termsIn = (t: unknown) => (t && typeof t === "object" ? (t as Record<string, unknown>) : {})

/** The customer's usual terms — their fees and their agreement's reserve, the standard ones where blank. */
const usualTerms = (c: CustomerRow, a: AgreementTerms): ReceiptTerms => usualTermsFrom(c, a.reservePercent)

/** A draft's terms: each one sent and readable, else `base`'s. A half-typed term never stops a save. */
function mergeTerms(sent: unknown, base: ReceiptTerms): ReceiptTerms {
  const t = termsIn(sent)
  const out = { ...base }
  for (const rule of TERM_RULES) {
    const r = readTerm(rule, t[rule.key])
    if (r.value !== null) out[rule.key] = r.value
  }
  return out
}

/** Only the terms sent and readable — what a save of an existing draft changes. */
function sentTerms(sent: unknown): Partial<ReceiptTerms> {
  const t = termsIn(sent)
  const out: Partial<ReceiptTerms> = {}
  for (const rule of TERM_RULES) {
    const r = readTerm(rule, t[rule.key])
    if (r.value !== null) out[rule.key] = r.value
  }
  return out
}

/** Book in's terms: every one needed and valid (an unusual value is fine; an impossible one isn't). */
function bookingTerms(sent: unknown): { terms: ReceiptTerms; error: null } | { terms: null; error: string } {
  const t = termsIn(sent)
  const out = {} as ReceiptTerms
  for (const rule of TERM_RULES) {
    const r = readTerm(rule, t[rule.key])
    if (r.error) return { terms: null, error: `Check the terms — ${r.error}.` }
    if (r.value === null) return { terms: null, error: `Check the terms — the ${rule.label} is missing.` }
    out[rule.key] = r.value
  }
  return { terms: out, error: null }
}

// ─── The actions ───────────────────────────────────────────────────────────────────────────

/**
 * Save the check-in so far as a draft receipt, numbering every row that hasn't got a number.
 * Called often (every add, remove and pause in typing), so it does NOT revalidate — the check-in
 * page must not re-render under the clerk.
 */
export async function saveCheckIn(input: CheckInInput): Promise<Result<{ receiptId: string; rows: CheckInRowSaved[]; removed: string[] }>> {
  try {
    const me = await who()
    const rows = cleanRows(input?.rows)
    const customerId = blank(input?.customerId)
    if (!customerId) return { ok: false, error: "Choose the customer first." }
    const cust = await prisma.customer.findUnique({ where: { id: customerId }, include: CUSTOMER_INCLUDE })
    if (!cust) return { ok: false, error: "That customer couldn't be found — search for them again." }
    const c = customerRow(cust)
    // Their usual reserve and special arrangement — tolerant, and before the transaction (never inside it).
    const a = await readAgreement(c.id)
    const asked = blank(input.receiptId) ? normaliseCode(input.receiptId!) : null
    const takenOff = cleanRemoved(input.removed)

    const out = await prisma.$transaction(async tx => {
      if (!asked) {
        const [receiptId] = await takeNumbers(tx, "receipt", 1)
        await tx.goodsInReceipt.create({
          data: {
            id: receiptId, customerId: c.id, vendorNo: c.vendorNo, customer: snapJson(c, c.vendorNo, a),
            ...mergeTerms(input.terms, usualTerms(c, a)),
            ownerConfirmed: !!input.ownerConfirmed, agentConfirmed: !!input.agentConfirmed, notes: draftNotes(input.notes, null, null),
            status: "draft", createdById: me.id, createdByName: me.name,
          },
        })
        const synced = await syncRows(tx, receiptId, rows, takenOff, me.name)
        return { receiptId, rows: synced.rows, removed: synced.removed }
      }
      const receiptId = asked
      const r = await lockReceipt(tx, receiptId)
      if (!r || r.status !== "draft") throw new Refusal(notADraft(receiptId, r))
      // The rows first (they can refuse), then the receipt — with a record of any label given up.
      const synced = await syncRows(tx, receiptId, rows, takenOff, me.name)
      const add = synced.removedPrinted.length ? givenUpLine(synced.removedPrinted, me.name) : null
      // A different customer brings their own usual terms with them, unless terms were sent.
      const terms = r.customerId !== c.id ? mergeTerms(input.terms, usualTerms(c, a)) : sentTerms(input.terms)
      await tx.goodsInReceipt.update({
        where: { id: receiptId },
        data: {
          customerId: c.id, vendorNo: c.vendorNo, customer: snapJson(c, c.vendorNo, a), ...terms,
          ...(input.notes !== undefined || add ? { notes: draftNotes(input.notes, r.notes, add) } : {}),
          ...(input.ownerConfirmed !== undefined ? { ownerConfirmed: !!input.ownerConfirmed } : {}),
          ...(input.agentConfirmed !== undefined ? { agentConfirmed: !!input.agentConfirmed } : {}),
        },
      })
      return { receiptId, rows: synced.rows, removed: synced.removed }
    }, TX_OPTIONS)
    return { ok: true, data: out }
  } catch (e) { return fail(e) }
}

/**
 * Book the check-in in: the same row sync as saveCheckIn, then — in the same transaction — the terms
 * saved, a vendor number given only when the customer has none AND an admin has set the vendor
 * series up (as createReceipt), the customer's details copied afresh (with the special arrangement
 * from their Fees & agreement tab as it stands now, so a reprint shows what applied on the day), and the draft turned "open"
 * with the booking time and the booker's name. A second press (or a retry after a lost answer)
 * waits on the lock, finds it already open, and gets the receipt back rather than an error.
 */
export async function bookInCheckIn(input: CheckInInput & { receiptId: string; terms: ReceiptTerms }): Promise<Result<{ receiptId: string; containerIds: string[]; vendorNo: string | null }>> {
  try {
    const me = await who()
    const id = blank(input?.receiptId) ? normaliseCode(input.receiptId) : null
    if (!id) return { ok: false, error: "This check-in hasn't been saved yet — wait a moment and press Book in again." }
    const rows = cleanRows(input.rows)
    const takenOff = cleanRemoved(input.removed)
    const customerId = blank(input.customerId)
    if (!customerId) return { ok: false, error: "Choose the customer first." }
    const t = bookingTerms(input.terms)
    // The special arrangement copied onto the receipt — read BEFORE the transaction (the table needs
    // Run Migrations, and a failed query inside the transaction would abort the booking), and
    // STRICTLY: a missing table is "no arrangement yet" (ready: false), but any other fault refuses
    // the booking below rather than book a receipt that silently leaves off what was agreed.
    const a = await findAgreement(customerId).catch((e: unknown) => {
      console.error("goods-in book in: couldn't read the customer's agreement:", e)
      return null
    })

    const out = await prisma.$transaction(async tx => {
      const r = await lockReceipt(tx, id)
      if (r && (r.status === null || r.status === "open" || r.status === "closed")) {
        // Already booked in — this is the second press, or a retry after the answer was lost.
        const held = await tx.goodsInContainer.findMany({ where: { receiptId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } })
        return { receiptId: id, containerIds: held.map(h => h.id), vendorNo: r.vendorNo }
      }
      if (!r || r.status !== "draft") throw new Refusal(notADraft(id, r))
      if (!a) throw new Refusal(AGREEMENT_UNREAD)
      if (rows.length === 0) throw new Refusal("Add at least one tote or pallet before booking in.")
      if (t.error !== null) throw new Refusal(t.error)

      // Hold the customer while their vendor number is decided, so two receipts for a new customer
      // booked at the same moment can't each give them a different one. (NO KEY: other receipts
      // pointing at the contact aren't held up.)
      await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR NO KEY UPDATE`
      const cust = await tx.customer.findUnique({ where: { id: customerId }, include: CUSTOMER_INCLUDE })
      if (!cust) throw new Refusal("That customer couldn't be found — search for them again.")
      const c = customerRow(cust)

      const synced = await syncRows(tx, id, rows, takenOff, me.name)
      const add = synced.removedPrinted.length ? givenUpLine(synced.removedPrinted, me.name) : null

      // A vendor number only when an admin has deliberately set that series up (BC still hands out
      // C-numbers for website sign-ups — see createReceipt).
      let vendorNo = c.vendorNo
      if (!vendorNo && (await tx.goodsInCounter.findUnique({ where: { key: "vendor" }, select: { key: true } }))) {
        vendorNo = (await takeNumbers(tx, "vendor", 1))[0]
        await tx.goodsInCustomer.upsert({ where: { customerId: c.id }, create: { customerId: c.id, vendorNo }, update: { vendorNo } })
      }

      const now = new Date()
      const booked = await tx.goodsInReceipt.updateMany({
        where: { id, status: "draft" },
        data: {
          status: "open", customerId: c.id, vendorNo, customer: snapJson(c, vendorNo, a), ...t.terms,
          // What was typed, then the record of any label printed for a number since given up.
          notes: draftNotes(input.notes, r.notes, add),
          ...(input.ownerConfirmed !== undefined ? { ownerConfirmed: !!input.ownerConfirmed } : {}),
          ...(input.agentConfirmed !== undefined ? { agentConfirmed: !!input.agentConfirmed } : {}),
          createdAt: now, updatedAt: now, createdById: me.id, createdByName: me.name,
        },
      })
      // Can't happen while the row is locked — but never report a booking that didn't take.
      if (booked.count !== 1) throw new Refusal(`${id} was changed by someone else at that moment — open it from Receipts to check it.`)
      return { receiptId: id, containerIds: synced.rows.map(s => s.id), vendorNo }
    }, TX_OPTIONS)
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: out }
  } catch (e) { return fail(e) }
}

/** Load a draft to carry on with. Anything else is refused, saying what it is (booked in / thrown away). */
export async function loadCheckIn(receiptId: string): Promise<Result<CheckInLoaded>> {
  try {
    await who()
    const id = blank(receiptId) ? normaliseCode(receiptId) : null
    if (!id) return { ok: false, error: "Say which check-in to carry on with." }
    const r = await prisma.goodsInReceipt.findUnique({
      where: { id },
      include: {
        person: { include: CUSTOMER_INCLUDE },
        containers: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, kind: true, category: true, description: true, labelPrintedAt: true } },
      },
    })
    if (!r) return { ok: false, error: `${id} couldn't be found — it may have been thrown away.` }
    if (r.status !== "draft") return { ok: false, error: notADraft(id, r) }
    // A check-in from before the customer database (keyed to an old test contact) can't be carried on.
    if (!r.person || !r.customerId) return { ok: false, error: `${id} was started against a customer who isn't on the customer database — open it from Receipts and throw it away.` }
    return {
      ok: true,
      data: {
        receiptId: r.id, customerId: r.customerId, customer: customerRow(r.person),
        rows: r.containers.map(k => ({ key: k.id, id: k.id, kind: asKind(k.kind), category: k.category, description: k.description, labelPrintedAt: iso(k.labelPrintedAt) })),
        terms: {
          commission: r.commission ?? DEFAULT_TERMS.commission,
          lottingFee: r.lottingFee ?? DEFAULT_TERMS.lottingFee,
          photographyFee: r.photographyFee ?? DEFAULT_TERMS.photographyFee,
          unsoldFee: r.unsoldFee ?? DEFAULT_TERMS.unsoldFee,
          reservePercent: r.reservePercent ?? DEFAULT_TERMS.reservePercent,
        },
        // Only what was typed: the Hub's own record lines stay on the receipt, out of the notes box.
        notes: splitNotes(r.notes).typed, ownerConfirmed: !!r.ownerConfirmed, agentConfirmed: !!r.agentConfirmed,
        createdByName: r.createdByName, updatedAt: r.updatedAt.toISOString(),
      },
    }
  } catch (e) { return fail(e) }
}

/**
 * Throw a check-in away. Deleted outright (its totes and pallets with it) when no label was printed
 * — for a tote still on it, or for one taken off it after printing (its LABEL_GIVEN_UP_NOTE line) —
 * and nothing moved; those numbers become gaps. Otherwise VOIDED, with a note naming the printed
 * labels (and anything moved), so a stray labelled tote can still be traced to it.
 */
export async function discardCheckIn(receiptId: string): Promise<Result<{ outcome: "deleted" | "voided"; printed: string[] }>> {
  try {
    const me = await who()
    const id = blank(receiptId) ? normaliseCode(receiptId) : null
    if (!id) return { ok: false, error: "Say which check-in to throw away." }
    const out = await prisma.$transaction(async tx => {
      const r = await lockReceipt(tx, id)
      // Already thrown away — a second press, or a retry after the answer was lost. What was asked
      // for is done, so say what happened to it rather than an error.
      if (!r) return { outcome: "deleted" as const, printed: [] as string[] }
      // Labels printed for numbers taken off the check-in before now still count (the notes record them).
      const withGivenUp = (ids: string[]) => [...ids, ...labelsGivenUp(r.notes).filter(g => !ids.includes(g))]
      if (r.status === "void" && (r.notes ?? "").includes(THROWN_AWAY_NOTE)) {
        const printed = await tx.goodsInContainer.findMany({ where: { receiptId: id, labelPrintedAt: { not: null } }, orderBy: { id: "asc" }, select: { id: true } })
        return { outcome: "voided" as const, printed: withGivenUp(printed.map(p => p.id)) }
      }
      if (r.status !== "draft") throw new Refusal(notADraft(id, r))

      const { held, moved } = await lockContainers(tx, id)
      const printed = withGivenUp(held.filter(h => h.labelPrintedAt).map(h => h.id))
      const movedIds = held.filter(h => moved.has(h.id)).map(h => h.id)
      if (printed.length === 0 && movedIds.length === 0) {
        await tx.goodsInReceipt.delete({ where: { id } })
        return { outcome: "deleted" as const, printed }
      }
      const why = [
        printed.length ? `labels had been printed for ${printed.join(", ")}` : null,
        movedIds.length ? `${movedIds.join(", ")} had already been moved to a location` : null,
      ].filter(Boolean).join("; ")
      const line = `${THROWN_AWAY_NOTE} — ${why} (${londonNow()}${me.name ? `, by ${me.name}` : ""}).`
      // The note goes on the END of the notes on the server, as updateReceipt's appendNote does.
      await tx.$executeRaw`
        UPDATE "GoodsInReceipt"
        SET "status" = 'void', "updatedAt" = now(), "notes" = concat_ws(chr(10), NULLIF("notes", ''), ${line}::text)
        WHERE "id" = ${id} AND "status" = 'draft'`
      return { outcome: "voided" as const, printed }
    }, TX_OPTIONS)
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: out }
  } catch (e) { return fail(e) }
}

/** Unfinished check-ins for the "carry on" offers: the caller's own first, then everyone else's, each newest first. At most 20. */
export async function listUnfinishedCheckIns(): Promise<Result<UnfinishedCheckIn[]>> {
  try {
    const me = await who()
    const select = {
      id: true, customerId: true, updatedAt: true, createdByName: true,
      person: PERSON_NAME,
      _count: { select: { containers: true } },
    } as const
    const orderBy = [{ updatedAt: "desc" as const }, { id: "desc" as const }]
    const [mine, others] = await Promise.all([
      prisma.goodsInReceipt.findMany({ where: { status: "draft", createdById: me.id }, orderBy, take: 20, select }),
      prisma.goodsInReceipt.findMany({ where: { status: "draft", OR: [{ createdById: null }, { createdById: { not: me.id } }] }, orderBy, take: 20, select }),
    ])
    const item = (r: (typeof mine)[number], own: boolean): UnfinishedCheckIn => ({
      receiptId: r.id, customerId: r.customerId ?? "", customer: personName(r.person), rows: r._count.containers,
      createdByName: r.createdByName, updatedAt: r.updatedAt.toISOString(), mine: own,
    })
    return { ok: true, data: [...mine.map(r => item(r, true)), ...others.map(r => item(r, false))].slice(0, 20) }
  } catch (e) { return fail(e) }
}
