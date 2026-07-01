import { prisma } from "@/lib/prisma"

// ─── Lot change log — one place every lot mutation records to ──────────────────
//
// The CatalogueLotEvent table is the audit trail for lots. Every path that
// creates, edits or deletes a lot (or its photos) should call one of the
// helpers below so the /admin/lot-log page shows who did what, when, and in
// which tool. Do NOT write CatalogueLotEvent rows directly — go through here.

export type LotLogCtx = {
  changedBy: string
  source: string            // which tool made the change (see schema comment)
  batchId?: string | null   // groups one user action that touched many lots
}

// The lot fields we diff for created/updated events, with their display labels.
export const LOT_FIELD_LABELS: Record<string, string> = {
  barcode:        "Barcode",
  title:          "Title",
  keyPoints:      "Key Points",
  description:    "Description",
  estimateLow:    "Estimate Low",
  estimateHigh:   "Estimate High",
  aiEstimateLow:  "AI Estimate Low",
  aiEstimateHigh: "AI Estimate High",
  startingBid:    "Starting Bid",
  reserve:        "Reserve",
  currentBid:     "Current Bid",
  hammerPrice:    "Hammer Price",
  condition:      "Condition",
  vendor:         "Vendor",
  tote:           "Tote",
  receipt:        "Receipt",
  receiptUniqueId:"Receipt Unique ID",
  category:       "Category",
  subCategory:    "Sub-Category",
  brand:          "Brand",
  notes:          "Parcel Size",
  extraDetails:   "Extra Details",
  status:         "Status",
  aiExcluded:     "AI Excluded",
  aiUpgraded:     "AI Upgraded",
  addedToBC:      "Added to BC",
  reviewFlag:     "Review Flag",
  reviewFlaggedBy:"Review Flagged By",
  aiFlagNote:     "AI Flag Note",
}

// Minimal lot shape the log needs to identify a lot.
export type LotRef = {
  id: string
  auctionId: string
  barcode?: string | null
  title?: string | null
}

type EventRow = {
  id: string
  lotId: string
  auctionId: string
  auctionCode: string
  lotBarcode: string | null
  lotTitle: string | null
  action: string
  source: string | null
  batchId: string | null
  field: string
  oldValue: string | null
  newValue: string | null
  changedBy: string
}

function baseOf(lot: LotRef, auctionCode: string) {
  return {
    lotId: lot.id,
    auctionId: lot.auctionId,
    auctionCode: auctionCode ?? "",
    lotBarcode: lot.barcode ?? null,
    lotTitle: (lot.title ?? null)?.slice(0, 83) ?? null,
  }
}

function row(
  base: ReturnType<typeof baseOf>,
  action: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  ctx: LotLogCtx,
): EventRow {
  return {
    id: crypto.randomUUID(),
    ...base,
    action,
    source: ctx.source ?? null,
    batchId: ctx.batchId ?? null,
    field,
    oldValue: oldValue || null,
    newValue: newValue || null,
    changedBy: ctx.changedBy,
  }
}

// Write a batch of prepared event rows (used internally + for bulk).
// Audit logging is BEST-EFFORT — it must never break the actual lot operation.
// If the write fails (e.g. the action/source/batchId columns aren't migrated
// yet, or a transient DB error), swallow it so the cataloguer's save still
// succeeds; the event is simply not recorded.
export async function writeLotEvents(rows: EventRow[]) {
  if (!rows.length) return
  try {
    await prisma.catalogueLotEvent.createMany({ data: rows })
  } catch (e) {
    console.error("lot-log: failed to write change events (not fatal):", e)
  }
}

// A short, human-readable summary of the details on a lot — used for the
// "created" and "deleted" rows so you can see at a glance what was entered.
export function summariseLot(lot: Record<string, any>): string {
  const p: string[] = []
  if (lot.barcode)          p.push(`Barcode ${lot.barcode}`)
  if (lot.receiptUniqueId)  p.push(`UID ${lot.receiptUniqueId}`)
  if (lot.vendor)           p.push(`Vendor ${lot.vendor}`)
  if (lot.tote)             p.push(`Tote ${lot.tote}`)
  if (lot.receipt)          p.push(`Receipt ${lot.receipt}`)
  if (lot.category)         p.push(`Cat ${lot.category}${lot.subCategory ? " / " + lot.subCategory : ""}`)
  if (lot.brand)            p.push(`Brand ${lot.brand}`)
  if (lot.estimateLow != null || lot.estimateHigh != null) p.push(`Est £${lot.estimateLow ?? "?"}–£${lot.estimateHigh ?? "?"}`)
  if (lot.condition)        p.push(`Condition ${lot.condition}`)
  if (lot.notes)            p.push(`Parcel ${lot.notes}`)
  if (lot.status && lot.status !== "ENTERED") p.push(`Status ${lot.status}`)
  if (lot.keyPoints?.trim()) p.push(`Key points: ${lot.keyPoints.trim().replace(/\s+/g, " ").slice(0, 120)}`)
  if (lot.description?.trim()) {
    const d = lot.description.trim().replace(/\s+/g, " ")
    p.push(`Desc: ${d.slice(0, 120)}${d.length > 120 ? "…" : ""}`)
  }
  const photos = Array.isArray(lot.imageUrls) ? lot.imageUrls.length : 0
  if (photos) p.push(`${photos} photo${photos !== 1 ? "s" : ""}`)
  return p.join(" · ") || "(no details entered)"
}

// A lot was created — records who/when + a summary of the details entered.
export async function logLotCreated(lot: Record<string, any> & LotRef, auctionCode: string, ctx: LotLogCtx) {
  await writeLotEvents([row(baseOf(lot, auctionCode), "created", "Lot created", null, summariseLot(lot), ctx)])
}

// Many lots were created at once (bulk create / mass create) — one insert.
export async function logLotsCreated(lots: (Record<string, any> & LotRef)[], auctionCode: string, ctx: LotLogCtx) {
  await writeLotEvents(lots.map(l => row(baseOf(l, auctionCode), "created", "Lot created", null, summariseLot(l), ctx)))
}

// A lot was deleted — records who/when + what it was.
export async function logLotDeleted(lot: Record<string, any> & LotRef, auctionCode: string, ctx: LotLogCtx) {
  await writeLotEvents([row(baseOf(lot, auctionCode), "deleted", "Lot deleted", summariseLot(lot), null, ctx)])
}

// Diff two lot snapshots and log every differing field (default action "updated").
// Pass only the fields you changed in `after` — anything absent is treated as unchanged.
export async function logLotFieldChanges(
  before: Record<string, any>,
  after: Record<string, any>,
  ref: LotRef,
  auctionCode: string,
  ctx: LotLogCtx,
  action: string = "updated",
): Promise<number> {
  const base = baseOf(ref, auctionCode)
  const rows: EventRow[] = []
  for (const key of Object.keys(LOT_FIELD_LABELS)) {
    if (!(key in after)) continue                 // field wasn't part of this change
    const oldVal = String(before?.[key] ?? "")
    const newVal = String(after?.[key] ?? "")
    if (oldVal !== newVal) rows.push(row(base, action, LOT_FIELD_LABELS[key], oldVal, newVal, ctx))
  }
  await writeLotEvents(rows)
  return rows.length
}

// A single named field changed (for flags / one-off values).
export async function logLotFieldChange(
  lot: LotRef, auctionCode: string, fieldLabel: string,
  oldVal: unknown, newVal: unknown, ctx: LotLogCtx,
) {
  await writeLotEvents([row(baseOf(lot, auctionCode), "updated", fieldLabel, String(oldVal ?? ""), String(newVal ?? ""), ctx)])
}

// A photo was added / removed / reordered.
export async function logLotPhoto(
  lot: LotRef, auctionCode: string,
  action: "photo_added" | "photo_removed" | "photo_reordered",
  ctx: LotLogCtx, detail?: string,
) {
  const label = action === "photo_added" ? "Photo added" : action === "photo_removed" ? "Photo removed" : "Photos reordered"
  const base = baseOf(lot, auctionCode)
  await writeLotEvents([row(
    base, action, label,
    action === "photo_removed" ? (detail ?? null) : null,
    action === "photo_added" ? (detail ?? null) : (action === "photo_reordered" ? (detail ?? null) : null),
    ctx,
  )])
}

// Build (but don't write) a per-lot field-change row — for bulk operations that
// collect many rows and write them in one createMany with a shared batchId.
export function buildLotEventRow(
  lot: LotRef, auctionCode: string, action: string,
  fieldLabel: string, oldVal: unknown, newVal: unknown, ctx: LotLogCtx,
): EventRow {
  return row(baseOf(lot, auctionCode), action, fieldLabel, String(oldVal ?? ""), String(newVal ?? ""), ctx)
}
