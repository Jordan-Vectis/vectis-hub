import type { ContainerKind } from "@/lib/goods-in/model"
import { TERM_FIELDS, newKey, type GoodsRow, type TermsDraft } from "./shared"

// Check in — a half-finished check-in kept in this browser TAB's sessionStorage, so following a
// link out of the check-in (the Goods In sidebar, the top bar, the back link) doesn't throw the
// counter's work away. The screen offers it back ("Carry on with the check-in for …") rather than
// restoring it silently.
//
// v2 (2026-10-16): the check-in is saved in the Hub as a receipt that isn't booked in yet from the
// goods step on, so the draft keeps that receipt's number. Carrying on from it reads the receipt
// back from the Hub (loadCheckIn) — the Hub is the truth — and only lays this tab's own text over
// it when the tab had changes the Hub hadn't confirmed yet (`pending`). A v1 draft (from before
// numbers were given as rows are added) has no receipt and restores exactly as it used to.
//
// Only the customer's id and name are kept — their record is read fresh when the draft is picked
// up again, so nothing more of a customer's details sits in the browser than the screen already
// showed. Storage can be missing or refuse (a private window, blocked site data), so every read
// and write is wrapped and the screen works exactly the same without it.

const KEY = "goods-in:check-in-draft"

/** The last step a draft can be on (Customer · What they've brought · Check & book in). */
const LAST_STEP = 2

export type CheckInDraft = {
  v: 2
  /** Whose draft it is — a shared iPad's next user isn't offered someone else's. */
  userId: string
  /** The receipt it is saved as (not booked in yet), or null before the goods step was reached. */
  receiptId: string | null
  customerId: string | null
  customerName: string | null
  rows: GoodsRow[]
  terms: TermsDraft | null
  notes: string
  owner: boolean
  agent: boolean
  step: number
  furthest: number
  /** The tab had changes the Hub hadn't confirmed when this was written. */
  pending: boolean
  savedAt: number
}

const isKind = (k: unknown): k is ContainerKind => k === "tote" || k === "pallet"
const clampStep = (n: unknown) => (typeof n === "number" && Number.isInteger(n) ? Math.min(LAST_STEP, Math.max(0, n)) : 0)
const str = (v: unknown) => (typeof v === "string" && v ? v : null)

/** The draft kept for this person in this tab, checked over — or null. */
export function readDraft(userId: string): CheckInDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as (Partial<Omit<CheckInDraft, "v">> & { v?: number }) | null
    if (!d || (d.v !== 1 && d.v !== 2) || d.userId !== userId) return null
    const v2 = d.v === 2
    const rows: GoodsRow[] = (Array.isArray(d.rows) ? d.rows : [])
      .filter((r): r is GoodsRow => !!r && isKind((r as GoodsRow).kind))
      .map(r => {
        // A v1 draft's rows were never numbered.
        const id = v2 ? str(r.id) : null
        return {
          // Fresh keys: the counter behind newKey() starts again on every page load.
          key: newKey(),
          id,
          idKind: id && isKind(r.idKind) ? r.idKind : null,
          kind: r.kind,
          category: String(r.category ?? ""),
          description: String(r.description ?? ""),
          labelPrintedAt: id ? str(r.labelPrintedAt) : null,
        }
      })
    const t = d.terms as TermsDraft | null | undefined
    const terms = t && typeof t === "object" && TERM_FIELDS.every(f => typeof t[f.key] === "string") ? t : null
    const step = clampStep(d.step)
    return {
      v: 2,
      userId,
      receiptId: v2 ? str(d.receiptId) : null,
      customerId: str(d.customerId),
      customerName: str(d.customerName),
      rows,
      terms,
      notes: typeof d.notes === "string" ? d.notes : "",
      owner: d.owner === true,
      agent: d.agent === true,
      step,
      furthest: Math.max(step, clampStep(d.furthest)),
      // A v1 draft was never saved anywhere, so all of it is the tab's own.
      pending: v2 ? d.pending === true : true,
      savedAt: typeof d.savedAt === "number" ? d.savedAt : Date.now(),
    }
  } catch {
    return null
  }
}

export function writeDraft(d: CheckInDraft) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* storage unavailable or full — the screen still works, the draft just isn't kept */
  }
}

export function clearDraft() {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}
