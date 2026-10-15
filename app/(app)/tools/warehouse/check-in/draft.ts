import type { ContainerKind } from "@/lib/goods-in/model"
import { TERM_FIELDS, newKey, type GoodsRow, type TermsDraft } from "./shared"

// Check in — a half-finished check-in kept in this browser TAB's sessionStorage, so following a
// link out of the check-in (the Goods In sidebar, the top bar, the back link) doesn't throw the
// counter's work away. The screen offers it back ("Carry on with the check-in for …") rather than
// restoring it silently.
//
// Only the customer's id and name are kept — their record is read fresh when the draft is picked
// up again, so nothing more of a customer's details sits in the browser than the screen already
// showed. Storage can be missing or refuse (a private window, blocked site data), so every read
// and write is wrapped and the screen works exactly the same without it.

const KEY = "goods-in:check-in-draft"

export type CheckInDraft = {
  v: 1
  /** Whose draft it is — a shared iPad's next user isn't offered someone else's. */
  userId: string
  customerId: string | null
  customerName: string | null
  rows: GoodsRow[]
  terms: TermsDraft | null
  notes: string
  owner: boolean
  agent: boolean
  step: number
  furthest: number
  savedAt: number
}

const isKind = (k: unknown): k is ContainerKind => k === "tote" || k === "pallet"
const clampStep = (n: unknown) => (typeof n === "number" && Number.isInteger(n) ? Math.min(3, Math.max(0, n)) : 0)

/** The draft kept for this person in this tab, checked over — or null. */
export function readDraft(userId: string): CheckInDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<CheckInDraft> | null
    if (!d || d.v !== 1 || d.userId !== userId) return null
    const rows: GoodsRow[] = (Array.isArray(d.rows) ? d.rows : [])
      .filter((r): r is GoodsRow => !!r && isKind((r as GoodsRow).kind))
      // Fresh keys: the counter behind newKey() starts again on every page load.
      .map(r => ({ key: newKey(), kind: r.kind, category: String(r.category ?? ""), description: String(r.description ?? "") }))
    const t = d.terms as TermsDraft | null | undefined
    const terms = t && typeof t === "object" && TERM_FIELDS.every(f => typeof t[f.key] === "string") ? t : null
    const step = clampStep(d.step)
    return {
      v: 1,
      userId,
      customerId: typeof d.customerId === "string" && d.customerId ? d.customerId : null,
      customerName: typeof d.customerName === "string" && d.customerName ? d.customerName : null,
      rows,
      terms,
      notes: typeof d.notes === "string" ? d.notes : "",
      owner: d.owner === true,
      agent: d.agent === true,
      step,
      furthest: Math.max(step, clampStep(d.furthest)),
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
