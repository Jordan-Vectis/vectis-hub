"use server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { titleFromDescription } from "@/lib/lot-title"
import { auth } from "@/auth"
import { uploadBufferToR2, deleteObjectsFromR2 } from "@/lib/r2"
import {
  logLotCreated, logLotsCreated, logLotDeleted, logLotFieldChanges, logLotPhoto,
  buildLotEventRow, writeLotEvents, type LotLogCtx,
} from "@/lib/lot-log"
import { headers } from "next/headers"
import { evaluateIdleGate, logIdleDecision, clockLooksTampered } from "@/lib/idle-gate"
import { buildToteMap, checkLot, toteLookupVariants } from "@/lib/tote-check"
import { ukDayStartUtc } from "@/lib/cataloguing-reports"
import { getDepartmentAccessForSession, canSeeAuction } from "@/lib/departments"
import { shouldKeepFlag } from "@/lib/measurement-check"

// titleFromDescription lives in lib/lot-title.ts so the Locking Check can VERIFY against the
// exact rule this generates with — see the note there.

/**
 * Does this cataloguer write their own descriptions?
 *
 * ⚠ If so, EVERY lot they create is marked aiExcluded — here on the server, not by them
 * remembering to tick a box. Cataloguers were typing a description and leaving the box
 * unticked, so hand-written lots sat in the AI's scope and could be overwritten by a run.
 * The wizard also hides Key Points for them, but that is only the visible half; this is the
 * half that guarantees it whichever screen the lot came from.
 *
 * Migration-safe: the column arrives with the SQL, not the deploy, so a missing column
 * behaves exactly as before rather than breaking lot creation.
 */
async function writesOwnDescriptions(userId: string): Promise<boolean> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { manualDescriptions: true } })
    return !!u?.manualDescriptions
  } catch { return false }
}

async function requireCataloguer() {
  const session = await auth()
  if (!session) throw new Error("Access denied")
  // ADMIN/CATALOGUER always allowed; any other role allowed if granted the
  // Cataloguing app (mirrors the cataloguing layout's hasAppAccess gate — a role
  // list alone wrongly locks out custom roles like Manager that have the app).
  if (session.user.role === "ADMIN" || session.user.role === "CATALOGUER") return session
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true } })
  if ((dbUser?.allowedApps ?? []).includes("CATALOGUING")) return session
  throw new Error("Access denied")
}

// Throws for non-admin users when the auction has been marked as Added to BC.
async function requireNotBCLocked(auctionId: string, session: Awaited<ReturnType<typeof requireCataloguer>>) {
  if (session.user.role === "ADMIN") return
  const auction = await prisma.catalogueAuction.findUnique({ where: { id: auctionId }, select: { addedToBC: true } })
  if (auction?.addedToBC) throw new Error("This auction has been added to BC and is locked. Only admins can make changes.")
}

function changedByOf(session: Awaited<ReturnType<typeof requireCataloguer>>): string {
  return session.user.name ?? session.user.email ?? "Unknown"
}

// A short id grouping every lot event from one bulk action.
function newBatchId(): string {
  return crypto.randomUUID()
}

// Every loggable field + the identifiers/auction code, for before/after diffing.
const LOGGABLE_SELECT = {
  id: true, auctionId: true, barcode: true, title: true,
  keyPoints: true, description: true, estimateLow: true, estimateHigh: true,
  aiEstimateLow: true, aiEstimateHigh: true, startingBid: true, reserve: true,
  currentBid: true, hammerPrice: true, condition: true, vendor: true, tote: true,
  receipt: true, receiptUniqueId: true, category: true, subCategory: true, brand: true,
  notes: true, extraDetails: true, status: true, aiExcluded: true, aiUpgraded: true,
  addedToBC: true, reviewFlag: true, reviewFlaggedBy: true, aiFlagNote: true,
  auction: { select: { code: true } },
} as const

// Update one lot AND log every changed field. Replaces a bare
// prisma.catalogueLot.update so no single-lot edit escapes the change log.
async function updateLotLogged(lotId: string, data: Record<string, any>, ctx: LotLogCtx) {
  const old = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: LOGGABLE_SELECT })
  await prisma.catalogueLot.update({ where: { id: lotId }, data })
  if (old) {
    await logLotFieldChanges(
      old, data,
      { id: old.id, auctionId: old.auctionId, barcode: old.barcode, title: old.title },
      old.auction?.code ?? "", ctx,
    )
  }
  return old
}

// ── Bulk-action undo ─────────────────────────────────────────────────────────
// Records a per-lot before/after snapshot for every mass action that edits lot
// fields, so Manage Lots can offer a multi-step, conflict-safe Undo. Backed by
// its own table (NOT the change log — that stores display labels + best-effort
// rows, too lossy to reverse). Scoped to the actor.

type UndoField = { before: unknown; after: unknown }
type UndoEntry = { lotId: string; fields: Record<string, UndoField> }

async function recordBulkUndo(
  auctionId: string,
  session: Awaited<ReturnType<typeof requireCataloguer>>,
  label: string,
  entries: UndoEntry[],
) {
  const real = entries.filter((e) => Object.keys(e.fields).length > 0)
  if (real.length === 0) return
  try {
    await prisma.catalogueBulkUndo.create({
      data: { auctionId, actorId: session.user.id, actorName: changedByOf(session), label, entries: real as any },
    })
  } catch { /* undo is a convenience — never fail the actual action if this write fails */ }
}

// Loose equality for the conflict check: a lot is only rolled back on a field
// whose CURRENT value still equals what the action set it to. Compare on a
// normalised string so null/""/boolean/number all line up.
function sameValue(a: unknown, b: unknown): boolean {
  return String(a ?? "") === String(b ?? "")
}

// The most recent undoable actions for THIS user on this auction (newest first).
export async function listBulkUndos(auctionId: string) {
  const session = await requireCataloguer()
  const rows = await prisma.catalogueBulkUndo.findMany({
    where: { auctionId, actorId: session.user.id, undone: false },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, label: true, createdAt: true },
  })
  return rows.map((r) => ({ id: r.id, label: r.label, at: r.createdAt.toISOString() }))
}

// Reverse one recorded bulk action. Conflict-safe: a lot (or a single field) that
// has changed since the action is skipped, never clobbered.
export async function undoBulk(undoId: string): Promise<{ ok: boolean; restored?: number; skipped?: number; label?: string; error?: string }> {
  try {
    const session = await requireCataloguer()
    const rec = await prisma.catalogueBulkUndo.findFirst({ where: { id: undoId, actorId: session.user.id, undone: false } })
    if (!rec) return { ok: false, error: "That action has already been undone, or isn't yours to undo." }
    await requireNotBCLocked(rec.auctionId, session)

    const entries = (Array.isArray(rec.entries) ? rec.entries : []) as UndoEntry[]
    const ctx: LotLogCtx = { changedBy: changedByOf(session), source: "undo", batchId: newBatchId() }
    let restored = 0, skipped = 0

    for (const e of entries) {
      const lot = await prisma.catalogueLot.findFirst({ where: { id: e.lotId, auctionId: rec.auctionId }, select: LOGGABLE_SELECT }) as Record<string, any> | null
      if (!lot) { skipped++; continue }
      // Only restore fields still holding the value this action set.
      const restore: Record<string, any> = {}
      for (const [col, fv] of Object.entries(e.fields)) {
        if (sameValue(lot[col], fv.after)) restore[col] = fv.before
      }
      if (Object.keys(restore).length === 0) { skipped++; continue }
      // Title tracks the description — regenerate it if we're rolling one back.
      if ("description" in restore) restore.title = titleFromDescription(String(restore.description ?? ""))
      await updateLotLogged(e.lotId, restore, ctx)
      restored++
    }

    await prisma.catalogueBulkUndo.update({ where: { id: rec.id }, data: { undone: true } })
    revalidatePath(`/tools/cataloguing/auctions/${rec.auctionId}`)
    return { ok: true, restored, skipped, label: rec.label }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't undo that." }
  }
}

export async function createAuction(formData: FormData) {
  await requireCataloguer()
  const code = (formData.get("code") as string).toUpperCase().trim()
  const name = formData.get("name") as string
  const auctionDate = formData.get("auctionDate") as string
  const auctionType = formData.get("auctionType") as string
  const eventName = formData.get("eventName") as string
  const auction = await prisma.catalogueAuction.create({
    data: { code, name, auctionDate: auctionDate ? new Date(auctionDate) : null, auctionType: auctionType || "GENERAL", eventName: eventName || null }
  })
  revalidatePath("/tools/cataloguing/auctions")
  return auction.id
}

export async function updateAuction(id: string, formData: FormData) {
  await requireCataloguer()
  const code = (formData.get("code") as string).toUpperCase().trim()
  const name = formData.get("name") as string
  const auctionDate = formData.get("auctionDate") as string
  const auctionType = formData.get("auctionType") as string
  const eventName = formData.get("eventName") as string
  const notes       = (formData.get("notes") as string)?.trim() || null
  const locked      = formData.get("locked")      === "true"
  const finished    = formData.get("finished")    === "true"
  const complete    = formData.get("complete")    === "true"
  const catalogued  = formData.get("catalogued")  === "true"
  const addedToBC   = formData.get("addedToBC")   === "true"
  const photography = formData.get("photography") === "true"
  const aiRan       = formData.get("aiRan")       === "true"
  // Review tab matching mode — only ever "strict" or "relaxed"
  const reviewKpMode = formData.get("reviewKpMode") === "relaxed" ? "relaxed" : "strict"
  await prisma.catalogueAuction.update({
    where: { id },
    data: { code, name, auctionDate: auctionDate ? new Date(auctionDate) : null, auctionType: auctionType || "GENERAL", eventName: eventName || null, notes, locked, finished, complete, catalogued, addedToBC, photography, aiRan, reviewKpMode }
  })
  revalidatePath("/tools/cataloguing/auctions")
  revalidatePath(`/tools/cataloguing/auctions/${id}`)
}

export async function deleteAuction(id: string) {
  await requireCataloguer()
  await prisma.catalogueAuction.delete({ where: { id } })
  revalidatePath("/tools/cataloguing/auctions")
}

export async function generateTitlesFromDescriptions(auctionId: string, lotIds: string[]) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  const batchId = newBatchId()
  const lots = await prisma.catalogueLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, description: true } })
  await Promise.all(lots.map(l => {
    const title = titleFromDescription(l.description ?? "")
    if (!title || title === "Untitled") return Promise.resolve()
    return updateLotLogged(l.id, { title }, { changedBy: changedByOf(session), source: "bulk", batchId })
  }))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}


/**
 * Write an accepted condition onto each lot. ⚠ Only ever called from the review list where a
 * PERSON has accepted each suggestion — the AI route that produces them writes nothing itself.
 * Logged like every other lot mutation (RULES: every path logs), with its own source so an
 * AI-suggested grade is identifiable in the change log for ever.
 */
export async function bulkSetLotConditions(auctionId: string, updates: { id: string; condition: string }[]) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  const batchId = newBatchId()
  const clean = updates.filter(u => u.id && (u.condition ?? "").trim())
  await Promise.all(clean.map(u =>
    updateLotLogged(u.id, { condition: u.condition.trim() }, { changedBy: changedByOf(session), source: "ai_condition", batchId })
  ))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { ok: true as const, updated: clean.length }
}

export async function setStartingBids(auctionId: string, updates: { id: string; startingBid: number }[]) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  const batchId = newBatchId()
  await Promise.all(updates.map(u =>
    updateLotLogged(u.id, { startingBid: u.startingBid }, { changedBy: changedByOf(session), source: "bulk", batchId })
  ))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function applyAiDescriptions(
  auctionId: string,
  updates: { id: string; description: string; aiEstimateLow: number | null; aiEstimateHigh: number | null }[]
) {
  const session = await requireCataloguer()
  const batchId = newBatchId()
  await Promise.all(
    updates.map(u =>
      updateLotLogged(u.id, {
        description:    u.description,
        title:          titleFromDescription(u.description),
        aiEstimateLow:  u.aiEstimateLow,
        aiEstimateHigh: u.aiEstimateHigh,
        aiUpgraded:     true,
      }, { changedBy: changedByOf(session), source: "ai_apply", batchId })
    )
  )
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function applyAiDescriptionOne(
  auctionId: string,
  update: { id: string; description: string; aiEstimateLow?: number | null; aiEstimateHigh?: number | null }
) {
  const session = await requireCataloguer()
  await updateLotLogged(update.id, {
    description:    update.description,
    title:          titleFromDescription(update.description),
    // Only update estimate fields if explicitly provided — omitting preserves existing values
    ...(update.aiEstimateLow  !== undefined ? { aiEstimateLow:  update.aiEstimateLow  } : {}),
    ...(update.aiEstimateHigh !== undefined ? { aiEstimateHigh: update.aiEstimateHigh } : {}),
    aiUpgraded:     true,
  }, { changedBy: changedByOf(session), source: "ai_apply" })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

// Write ONLY the AI estimate to a lot, leaving the description/title untouched.
// The AI estimate lives in its own fields (aiEstimateLow/aiEstimateHigh) and never
// touches the real estimate, so the pipeline saves it as soon as it's generated —
// independent of the auto-apply / review toggle, which only governs the description.
export async function applyAiEstimateOne(
  auctionId: string,
  update: { id: string; aiEstimateLow: number; aiEstimateHigh: number }
) {
  const session = await requireCataloguer()
  await updateLotLogged(update.id, {
    aiEstimateLow:  update.aiEstimateLow,
    aiEstimateHigh: update.aiEstimateHigh,
  }, { changedBy: changedByOf(session), source: "ai_apply" })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

// Lot Wizard "remember last" — the user's last Tote / Vendor / Receipt, stored on their
// account so they follow them across devices (shared iPads). Any signed-in user; their own row.
export async function getLastLotFields() {
  const session = await auth()
  if (!session) return { tote: "", vendor: "", receipt: "" }
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { lastTote: true, lastVendor: true, lastReceipt: true },
  })
  return { tote: u?.lastTote ?? "", vendor: u?.lastVendor ?? "", receipt: u?.lastReceipt ?? "" }
}

export async function saveLastLotFields(fields: { tote?: string; vendor?: string; receipt?: string }) {
  const session = await auth()
  if (!session) return
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      lastTote:    (fields.tote ?? "").trim()    || null,
      lastVendor:  (fields.vendor ?? "").trim()  || null,
      lastReceipt: (fields.receipt ?? "").trim() || null,
    },
  })
}

// ── Change Vendor (Manage Lots → Tools) ─────────────────────────────────────
// Type a tote OR a receipt, and the vendor/receipt behind it is looked up in the
// BC-synced tote data — the same table the wizard's tote box reads — so the
// answer matches what Tote Check will say afterwards.
//
// Replaced "Pull Vendor/Receipt from Totes", which only filled BLANKS and read
// the separate INTERNAL warehouse tables, so it could neither correct a wrong
// vendor nor see a tote that only exists in BC.
export async function lookupToteOrReceipt(query: string): Promise<{
  ok: boolean
  error?: string
  kind?: "tote" | "receipt"
  tote?: string | null
  receipt?: string | null
  vendor?: string | null
  vendorName?: string | null
  toteCount?: number
}> {
  try {
    await requireCataloguer()
    const q = query.trim()
    if (!q) return { ok: false, error: "Type a tote or receipt number." }

    // Prisma's `in` is case-sensitive and these get hand-typed.
    const variants = [q, q.toUpperCase(), q.toLowerCase()]

    const byTote = await prisma.warehouseTote.findFirst({
      where:  { toteNo: { in: variants } },
      select: { toteNo: true, receiptNo: true, vendorNo: true, vendorName: true },
    })
    if (byTote) {
      return {
        ok: true, kind: "tote",
        tote: byTote.toteNo, receipt: byTote.receiptNo,
        vendor: byTote.vendorNo, vendorName: byTote.vendorName,
      }
    }

    const byReceipt = await prisma.warehouseTote.findMany({
      where:  { receiptNo: { in: variants } },
      select: { toteNo: true, receiptNo: true, vendorNo: true, vendorName: true },
    })
    if (byReceipt.length === 0) {
      return { ok: false, error: `Nothing in the BC tote data matches "${q}". Check the number, or refresh the data on BC Warehouse → Data Sync.` }
    }
    // A receipt normally has one vendor across its totes. If BC disagrees with
    // itself, say so rather than picking one at random.
    const vendors = [...new Set(byReceipt.map(t => (t.vendorNo ?? "").trim()).filter(Boolean))]
    if (vendors.length > 1) {
      return { ok: false, error: `Receipt ${q} has more than one vendor in BC (${vendors.join(", ")}) — enter a tote instead.` }
    }
    const first = byReceipt[0]
    return {
      ok: true, kind: "receipt",
      tote: null, receipt: first.receiptNo,
      vendor: first.vendorNo, vendorName: first.vendorName,
      toteCount: byReceipt.length,
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Lookup failed" }
  }
}

// Put the looked-up vendor/receipt onto the chosen lots.
//
// ⚠ Requires an explicit selection — deliberately NO "else the whole auction"
// fallback like the description tools have. Moving every lot in a sale onto one
// vendor by a mis-click is not a mistake worth making easy.
//
// ⚠ An existing receiptUniqueId is PRESERVED; one is only minted where it's
// missing (same rule as everywhere else — see RULES → Lot Identifiers).
export async function setLotsVendorReceipt(
  auctionId: string,
  lotIds: string[],
  // `tote` (optional) also rewrites the lot's tote — used by End of Day → BC
  // where the flagged problem IS a mistyped tote. Manage Lots doesn't pass it,
  // so its behaviour is unchanged.
  input: { vendor: string; receipt: string; tote?: string },
): Promise<{ ok: boolean; error?: string; updated?: number }> {
  try {
    const session = await requireCataloguer()
    await requireNotBCLocked(auctionId, session)

    if (lotIds.length === 0) return { ok: false, error: "Tick the lots you want to change first." }
    const vendor  = input.vendor.trim()
    const receipt = input.receipt.trim()
    const tote    = (input.tote ?? "").trim()
    if (!vendor && !receipt && !tote) return { ok: false, error: "Nothing to set." }

    const lots = await prisma.catalogueLot.findMany({
      where:  { id: { in: lotIds }, auctionId },
      select: { id: true, vendor: true, receipt: true, receiptUniqueId: true, tote: true },
    })
    if (lots.length === 0) return { ok: false, error: "None of those lots are in this auction." }

    // ⚠ NO unique IDs minted here any more (2026-08-06) — a blank stays blank
    // until 🔗 BC Match imports BC's own ID by barcode. Existing IDs are still
    // never touched.
    const ctx: LotLogCtx = { changedBy: changedByOf(session), source: "vendor_change", batchId: newBatchId() }
    const undo: { lotId: string; fields: Record<string, { before: unknown; after: unknown }> }[] = []
    let updated = 0

    for (const lot of lots) {
      const data: Record<string, string> = {}
      if (vendor  && lot.vendor  !== vendor)  data.vendor  = vendor
      if (receipt && lot.receipt !== receipt) data.receipt = receipt
      if (tote    && lot.tote    !== tote)    data.tote    = tote
      if (Object.keys(data).length === 0) continue

      const fields: Record<string, { before: unknown; after: unknown }> = {}
      if (data.vendor  !== undefined) fields.vendor  = { before: lot.vendor,  after: data.vendor }
      if (data.receipt !== undefined) fields.receipt = { before: lot.receipt, after: data.receipt }
      if (data.tote    !== undefined) fields.tote    = { before: lot.tote,    after: data.tote }

      await updateLotLogged(lot.id, data, ctx)
      undo.push({ lotId: lot.id, fields })
      updated++
    }

    await recordBulkUndo(auctionId, session, `Change vendor / receipt (${updated})`, undo)
    revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
    return { ok: true, updated }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't change those lots" }
  }
}

// End of Day → BC intervention: the SAME set as above, applied to a selection
// that can span several sales. Groups by auction and loops the single-auction
// action, so logging, per-sale Undo (Manage Lots → Undo), BC locking and the
// unique-ID minting rule all behave exactly as they do from Manage Lots.
export async function setLotsVendorReceiptAcrossAuctions(
  lots: { auctionId: string; lotId: string }[],
  input: { vendor: string; receipt: string; tote?: string },
): Promise<{ ok: boolean; error?: string; updated: number; lockedSales: number }> {
  let updated = 0, lockedSales = 0
  try {
    const byAuction = new Map<string, string[]>()
    for (const l of lots) {
      if (!l.auctionId || !l.lotId) continue
      if (!byAuction.has(l.auctionId)) byAuction.set(l.auctionId, [])
      byAuction.get(l.auctionId)!.push(l.lotId)
    }
    if (byAuction.size === 0) return { ok: false, error: "Tick the lots you want to change first.", updated, lockedSales }

    for (const [auctionId, lotIds] of byAuction) {
      const res = await setLotsVendorReceipt(auctionId, lotIds, input)
      if (!res.ok) { lockedSales++; continue }
      updated += res.updated ?? 0
    }
    return { ok: true, updated, lockedSales }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't change those lots", updated, lockedSales }
  }
}

// ── Tote Check → "Match BC" ─────────────────────────────────────────────────
// Corrects every lot whose Vendor / Receipt disagrees with the BC tote data.
// BC is treated as correct, so the LOT is what gets rewritten.
//
// ⚠ Where the Hub held a WRONG value (not merely a blank), that wrong value was
// most likely pushed into BC when the sale went over — so before overwriting it
// we write a CatalogueBcCorrection row. That row is the only remaining record of
// the discrepancy once the lot is fixed, and it drives the BC Corrections tab.
//
// ⚠ receiptUniqueId is deliberately NOT re-minted. It is an identity field (AI
// runs, receipt matching, anything already in BC) and rewriting hundreds of them
// as a side effect of a tidy-up is a separate, deliberate decision — see RULES →
// Lot Identifiers. Corrected lots will therefore still report "unique_id_mismatch"
// on the Tote Check tab; that is honest, not a bug.
// One planned (or applied) fix from the tote autocorrect — what changes on
// which lot, so the End of Day button can SHOW the work before doing it.
export type AutocorrectChange = {
  barcode: string | null
  uniqueId: string | null
  tote: string | null
  sale?: string
  oldReceipt?: string | null; newReceipt?: string | null
  oldVendor?: string | null;  newVendor?: string | null
  vendorName?: string | null   // the tote's vendor name, for readable previews
  wasWrong: boolean            // true = a value changes (BC correction); false = a blank being filled
}

export async function autocorrectLotsFromTotes(auctionId: string, apply: boolean = true): Promise<{
  ok: boolean
  error?: string
  updated?: number
  corrections?: number
  skipped?: number
  changes?: AutocorrectChange[]
}> {
  try {
    const session = await requireCataloguer()
    // Same rule as everywhere else: an auction that's gone to BC is admin-only.
    // Checked in preview mode too — a preview promising fixes that apply would
    // then refuse is worse than reporting the sale as locked up front.
    await requireNotBCLocked(auctionId, session)

    const lots = await prisma.catalogueLot.findMany({
      where:  { auctionId },
      select: {
        id: true, barcode: true, receiptUniqueId: true, title: true,
        vendor: true, tote: true, receipt: true,
      },
      orderBy: { createdAt: "asc" },
    })

    const variants = toteLookupVariants(lots)
    const totes = variants.length > 0
      ? await prisma.warehouseTote.findMany({
          where:  { toteNo: { in: variants } },
          select: { toteNo: true, receiptNo: true, vendorNo: true, vendorName: true },
        })
      : []
    const toteMap = buildToteMap(totes)

    const ctx: LotLogCtx = { changedBy: changedByOf(session), source: "tote_autocorrect", batchId: newBatchId() }
    let updated = 0, corrections = 0, skipped = 0
    const changes: AutocorrectChange[] = []

    for (const lot of lots) {
      const { issues, tote } = checkLot(lot, toteMap)
      // Nothing to correct against — a missing or unknown tote is reported, not
      // guessed at.
      if (!tote) { if (issues.length) skipped++; continue }

      const data: Record<string, string> = {}
      if (issues.includes("receipt_mismatch") || issues.includes("receipt_missing")) {
        if (tote.receiptNo) data.receipt = tote.receiptNo
      }
      if (issues.includes("vendor_mismatch") || issues.includes("vendor_missing")) {
        if (tote.vendorNo) data.vendor = tote.vendorNo
      }
      if (Object.keys(data).length === 0) continue

      // Only a WRONG value means BC needs putting right. A blank one was never
      // pushed as anything, so filling it in isn't a BC correction.
      const wasWrong = issues.includes("receipt_mismatch") || issues.includes("vendor_mismatch")

      changes.push({
        barcode: lot.barcode, uniqueId: lot.receiptUniqueId, tote: lot.tote,
        ...(data.receipt ? { oldReceipt: lot.receipt, newReceipt: data.receipt } : {}),
        ...(data.vendor  ? { oldVendor:  lot.vendor,  newVendor:  data.vendor  } : {}),
        vendorName: tote.vendorName, wasWrong,
      })

      // Preview mode stops here — same plan, nothing written.
      if (!apply) { updated++; if (wasWrong) corrections++; continue }

      await updateLotLogged(lot.id, data, ctx)
      updated++

      if (wasWrong) {
        await prisma.catalogueBcCorrection.upsert({
          where:  { auctionId_lotId: { auctionId, lotId: lot.id } },
          create: {
            auctionId, lotId: lot.id,
            barcode: lot.barcode, receiptUniqueId: lot.receiptUniqueId, title: lot.title,
            tote: lot.tote,
            oldVendor: lot.vendor, oldReceipt: lot.receipt,
            newVendor: tote.vendorNo, newReceipt: tote.receiptNo,
            correctedBy: changedByOf(session),
          },
          // Re-running the button must not resurrect a ticked-off correction as
          // new work, so `done` is left alone on update.
          update: {
            barcode: lot.barcode, receiptUniqueId: lot.receiptUniqueId, title: lot.title,
            tote: lot.tote,
            oldVendor: lot.vendor, oldReceipt: lot.receipt,
            newVendor: tote.vendorNo, newReceipt: tote.receiptNo,
            correctedBy: changedByOf(session),
          },
        })
        corrections++
      }
    }

    if (apply) revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
    return { ok: true, updated, corrections, skipped, changes }
  } catch (e: any) {
    // Returned, not thrown — production redacts a thrown server action's message
    // and the BC lock message is one the user needs to read (RULES).
    return { ok: false, error: e?.message ?? "Couldn't correct the lots" }
  }
}

// End of Day → BC "Mass re-map": typed `wrong → right` pairs, e.g. a mistyped
// tote that a whole batch of lots was catalogued under. Each line's RIGHT side
// is verified against the BC tote data (same lookup as Change Vendor — an
// unknown number can never be applied), and its WRONG side selects every
// NOT-yet-in-BC lot in a non-complete sale whose tote OR receipt matches.
// Lots already in BC are deliberately out of scope — their wrong values went
// into BC and belong to the BC Corrections flow, not a Hub-side remap.
//
// preview=true only reports what each line would do; apply runs the SAME
// setLotsVendorReceipt machinery as everywhere else (logged, per-sale Undo,
// unique IDs preserved, BC-locked sales skipped). Lines run in order, so a
// later line sees an earlier line's changes.
export type RemapLineResult = {
  from: string
  to: string
  ok: boolean
  error?: string
  kind?: "tote" | "receipt"
  tote?: string | null
  receipt?: string | null
  vendor?: string | null
  vendorName?: string | null
  matched: number
  updated?: number
  lockedSales?: number
}

const MAX_REMAP_LINES = 100

export async function massRemapPendingLots(
  lines: { from: string; to: string }[],
  apply: boolean,
): Promise<{ ok: boolean; error?: string; results: RemapLineResult[] }> {
  try {
    await requireCataloguer()
    if (lines.length === 0)               return { ok: false, error: "Type at least one change first.", results: [] }
    if (lines.length > MAX_REMAP_LINES)   return { ok: false, error: `Too many lines — ${MAX_REMAP_LINES} at most per run.`, results: [] }

    const caseVariants = (v: string) => [...new Set([v, v.toUpperCase(), v.toLowerCase()])]
    const results: RemapLineResult[] = []

    for (const raw of lines) {
      const from = (raw.from ?? "").trim().toUpperCase()
      const to   = (raw.to   ?? "").trim().toUpperCase()
      const base: RemapLineResult = { from, to, ok: false, matched: 0 }
      if (!from || !to) { results.push({ ...base, error: "Needs both a wrong value and a right one." }); continue }
      if (from === to)  { results.push({ ...base, error: "Both sides are the same." }); continue }

      // RIGHT side must exist in the BC data — same rule as everywhere else.
      const looked = await lookupToteOrReceipt(to)
      if (!looked.ok) { results.push({ ...base, error: looked.error ?? `"${to}" isn't in the BC data.` }); continue }

      // WRONG side selects pending lots by tote OR receipt (a value lives in
      // one of the two; matching both costs nothing and can't cross-match).
      const candidates = await prisma.catalogueLot.findMany({
        where: {
          auction: { complete: false },
          OR: [{ tote: { in: caseVariants(from) } }, { receipt: { in: caseVariants(from) } }],
        },
        select: { id: true, auctionId: true, barcode: true, receiptUniqueId: true },
      })

      // Not-yet-in-BC only (barcode first, unique ID fallback — the usual rule).
      const bcs  = candidates.map(l => l.barcode).filter((v): v is string => !!v)
      const uids = candidates.map(l => l.receiptUniqueId).filter((v): v is string => !!v)
      const inBcRows = (bcs.length || uids.length)
        ? await prisma.warehouseItem.findMany({
            where: { OR: [
              ...(bcs.length  ? [{ barcode:  { in: bcs.flatMap(caseVariants) } }]  : []),
              ...(uids.length ? [{ uniqueId: { in: uids.flatMap(caseVariants) } }] : []),
            ] },
            select: { barcode: true, uniqueId: true },
          })
        : []
      const inBcBarcode  = new Set(inBcRows.map(w => w.barcode?.toUpperCase()).filter(Boolean))
      const inBcUniqueId = new Set(inBcRows.map(w => w.uniqueId.toUpperCase()))
      const pending = candidates.filter(l =>
        !((l.barcode && inBcBarcode.has(l.barcode.toUpperCase())) ||
          (l.receiptUniqueId && inBcUniqueId.has(l.receiptUniqueId.toUpperCase()))))

      const line: RemapLineResult = {
        ...base, ok: true, matched: pending.length,
        kind: looked.kind, tote: looked.tote, receipt: looked.receipt,
        vendor: looked.vendor, vendorName: looked.vendorName,
      }

      if (apply && pending.length > 0) {
        const res = await setLotsVendorReceiptAcrossAuctions(
          pending.map(l => ({ auctionId: l.auctionId, lotId: l.id })),
          {
            vendor:  looked.vendor ?? "",
            receipt: looked.receipt ?? "",
            ...(looked.kind === "tote" && looked.tote ? { tote: looked.tote } : {}),
          },
        )
        line.updated     = res.updated
        line.lockedSales = res.lockedSales
        if (!res.ok && res.error) { line.ok = false; line.error = res.error }
      }

      results.push(line)
    }

    return { ok: true, results }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't run the re-map", results: [] }
  }
}

// End of Day → BC "fix what BC can prove" button: the SAME correction as the
// Tote Check tab's Match BC, run across every sale contributing lots to
// tonight's sheet. Deliberately a loop over autocorrectLotsFromTotes — one fix
// choke-point, so this button can never fix something different from what that
// tab (and the End of Day checks, which share lib/tote-check.ts) report.
// A BC-locked sale fails ITS OWN call for non-admins and is reported as
// skipped; the rest still get fixed.
export async function autocorrectLotsForAuctions(auctionIds: string[], apply: boolean = true): Promise<{
  ok: boolean
  error?: string
  updated: number
  corrections: number
  skipped: number
  lockedSales: number
  changes: AutocorrectChange[]
}> {
  let updated = 0, corrections = 0, skipped = 0, lockedSales = 0
  const changes: AutocorrectChange[] = []
  try {
    const ids = [...new Set(auctionIds)].filter(Boolean)
    const codes = ids.length
      ? new Map((await prisma.catalogueAuction.findMany({
          where: { id: { in: ids } }, select: { id: true, code: true },
        })).map(a => [a.id, a.code]))
      : new Map<string, string>()
    for (const id of ids) {
      const res = await autocorrectLotsFromTotes(id, apply)
      if (!res.ok) { lockedSales++; continue }
      updated     += res.updated     ?? 0
      corrections += res.corrections ?? 0
      skipped     += res.skipped     ?? 0
      for (const c of res.changes ?? []) changes.push({ ...c, sale: codes.get(id) ?? "" })
    }
    return { ok: true, updated, corrections, skipped, lockedSales, changes }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't correct the lots", updated, corrections, skipped, lockedSales, changes }
  }
}

// End of Day check panels — "Ignore this warning". For flags the team KNOWS
// are stale (usually the BC sync hasn't caught up), a lot + check-type pair
// can be filed under "ignored" so the panels show live problems only. The
// check itself still runs and nothing on the lot changes; fully reversible
// via restoreEodChecks. Stored in the DB so it survives refreshes and every
// admin sees the same picture. duplicate_barcode is never ignorable (it
// changes what goes on the sheet) — the page doesn't offer it and the API
// keeps enforcing it server-side when building the panels.
export async function dismissEodChecks(pairs: { lotId: string; checkKey: string }[]): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    const session = await requireCataloguer()
    const clean = pairs.filter(p => p.lotId && p.checkKey && p.checkKey !== "duplicate_barcode").slice(0, 400)
    if (!clean.length) return { ok: false, error: "Nothing ticked to ignore." }
    await prisma.$transaction(clean.map(p => prisma.eodCheckDismissal.upsert({
      where:  { lotId_checkKey: { lotId: p.lotId, checkKey: p.checkKey } },
      create: { lotId: p.lotId, checkKey: p.checkKey, dismissedBy: changedByOf(session) },
      update: {},
    })))
    return { ok: true, count: clean.length }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't ignore those warnings" }
  }
}

// End of Day → BC "BC Match (all sales)": the overnight macro puts every Hub
// sale's lots into ONE BC sale, so the morning's BC Lines export spans several
// Hub sales at once. This matches the export's rows to Hub lots BY BARCODE
// across every NON-COMPLETE sale, compares receipts (same rule as the per-sale
// 🔗 BC Match in Auction Manager: only a row whose receipt AGREES imports), and
// on apply loops the existing per-sale `bulkAssignUniqueIds` — the ONE
// UniqueID-import choke-point — grouped by auction. BC-locked sales fail their
// own call for non-admins and are counted, the rest proceed.
export type EodMatchRow = {
  barcode: string
  bcReceipt: string
  bcUniqueId: string
  ourReceipt: string | null
  ourUniqueId: string | null
  sale: string
  status: "match" | "mismatch" | "not_found"
}

const MAX_MATCH_ROWS = 10_000

export async function matchBcLinesAcrossAuctions(
  rows: { barcode: string; bcReceipt: string; bcUniqueId: string }[],
  apply: boolean,
): Promise<{
  ok: boolean
  error?: string
  counts: { match: number; mismatch: number; notFound: number; pendingNotInExport: number }
  rows: EodMatchRow[]            // capped for display — counts are the truth
  pendingNotInExport: { barcode: string; sale: string }[]
  updated: number
  skipped: number
  lockedSales: number
}> {
  const empty = { counts: { match: 0, mismatch: 0, notFound: 0, pendingNotInExport: 0 }, rows: [], pendingNotInExport: [], updated: 0, skipped: 0, lockedSales: 0 }
  try {
    await requireCataloguer()
    if (!rows.length)                 return { ok: false, error: "The export has no rows.", ...empty }
    if (rows.length > MAX_MATCH_ROWS) return { ok: false, error: `Too many rows — ${MAX_MATCH_ROWS.toLocaleString()} at most per upload.`, ...empty }

    const lots = await prisma.catalogueLot.findMany({
      where:  { auction: { complete: false }, barcode: { not: null } },
      select: {
        id: true, auctionId: true, barcode: true, receipt: true, receiptUniqueId: true,
        auction: { select: { code: true } },
      },
    })
    const byBarcode = new Map(lots.map(l => [l.barcode!.toLowerCase().trim(), l]))

    const resultRows: EodMatchRow[] = []
    const matchedBarcodes = new Set<string>()
    const counts = { match: 0, mismatch: 0, notFound: 0, pendingNotInExport: 0 }
    const toApply = new Map<string, { barcode: string; uniqueId: string }[]>()   // auctionId → pairs

    for (const r of rows) {
      const key = r.barcode.toLowerCase().trim()
      if (!key) continue
      const lot = byBarcode.get(key)
      if (!lot) {
        counts.notFound++
        resultRows.push({ barcode: r.barcode, bcReceipt: r.bcReceipt, bcUniqueId: r.bcUniqueId, ourReceipt: null, ourUniqueId: null, sale: "", status: "not_found" })
        continue
      }
      matchedBarcodes.add(key)
      const receiptAgrees = (lot.receipt ?? "").trim().toUpperCase() === r.bcReceipt.trim().toUpperCase()
      const status = receiptAgrees ? "match" as const : "mismatch" as const
      counts[status]++
      resultRows.push({
        barcode: r.barcode, bcReceipt: r.bcReceipt, bcUniqueId: r.bcUniqueId,
        ourReceipt: lot.receipt, ourUniqueId: lot.receiptUniqueId,
        sale: lot.auction?.code ?? "", status,
      })
      if (status === "match" && r.bcUniqueId.trim()) {
        if (!toApply.has(lot.auctionId)) toApply.set(lot.auctionId, [])
        toApply.get(lot.auctionId)!.push({ barcode: r.barcode, uniqueId: r.bcUniqueId })
      }
    }

    // The other direction: lots still waiting for a Unique ID whose barcode the
    // export doesn't cover — i.e. what this run did NOT bring back from BC.
    const pendingNotInExport = lots
      .filter(l => !l.receiptUniqueId && !matchedBarcodes.has(l.barcode!.toLowerCase().trim()))
      .map(l => ({ barcode: l.barcode!, sale: l.auction?.code ?? "" }))
    counts.pendingNotInExport = pendingNotInExport.length

    let updated = 0, skipped = 0, lockedSales = 0
    if (apply) {
      for (const [auctionId, pairs] of toApply) {
        try {
          const res = await bulkAssignUniqueIds(auctionId, pairs)
          updated += res.updated
          skipped += res.skipped
        } catch {
          lockedSales++
        }
      }
    }

    // ⚠ The display cap must keep the rows a person actually needs to READ. A flat
    // slice(0, 1000) in export order cut everything past row 1,000 — so on a big export the
    // tiles said "3 receipt disagrees" while clicking the tile showed nothing, because all
    // three sat beyond the cap (Jordan, 2026-08-19). Mismatches are why anyone opens the list,
    // so they survive first, then not-found, and matches fill whatever room is left.
    const mismatchRows = resultRows.filter(r => r.status === "mismatch").slice(0, 500)
    const notFoundRows = resultRows.filter(r => r.status === "not_found").slice(0, 300)
    const matchRows    = resultRows.filter(r => r.status === "match")
      .slice(0, Math.max(0, 1000 - mismatchRows.length - notFoundRows.length))
    return {
      ok: true, counts,
      rows: [...mismatchRows, ...notFoundRows, ...matchRows],
      pendingNotInExport: pendingNotInExport.slice(0, 500),
      updated, skipped, lockedSales,
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't match the export", ...empty }
  }
}

export async function restoreEodChecks(pairs: { lotId: string; checkKey: string }[]): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    await requireCataloguer()
    const clean = pairs.filter(p => p.lotId && p.checkKey).slice(0, 400)
    if (!clean.length) return { ok: false, error: "Nothing to restore." }
    const res = await prisma.eodCheckDismissal.deleteMany({
      where: { OR: clean.map(p => ({ lotId: p.lotId, checkKey: p.checkKey })) },
    })
    return { ok: true, count: res.count }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't restore those warnings" }
  }
}

// Tick / untick one BC correction. Any signed-in cataloguer — this is a shared
// worklist, not a per-user one.
//
// ⚠ Keyed on the LOT, not on a row id, and it UPSERTS. The list is live: most
// rows are a mismatch computed on the spot and have no saved row yet, and
// ticking one is what first records it. The snapshot is only written on create —
// on a row Match BC already wrote, the stored values are the ones that were
// real at the time and must not be replaced by whatever the lot says now.
export async function setBcCorrectionDone(input: {
  auctionId: string
  lotId:     string
  done:      boolean
  snapshot?: {
    barcode:         string | null
    receiptUniqueId: string | null
    title:           string | null
    tote:            string | null
    oldVendor:       string | null
    oldReceipt:      string | null
    newVendor:       string | null
    newReceipt:      string | null
  }
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireCataloguer()
    const { auctionId, lotId, done, snapshot } = input
    const doneFields = done
      ? { done: true,  doneBy: changedByOf(session), doneAt: new Date() }
      : { done: false, doneBy: null, doneAt: null }

    await prisma.catalogueBcCorrection.upsert({
      where:  { auctionId_lotId: { auctionId, lotId } },
      create: { auctionId, lotId, ...(snapshot ?? {}), ...doneFields },
      update: doneFields,
    })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't save" }
  }
}

// (The Lot Wizard "Resume lot" draft actions — saveLotDraft / getLotDraft /
// clearLotDraft over CatalogueLotDraft, built 2026-07-31 — were REMOVED on
// Jordan's instruction 2026-08-07 ("it seems very buggy"). The table remains
// in the DB, inert. Don't rebuild without discussing it.)

// Is this barcode already assigned to a lot ANYWHERE in the app? Deliberately
// a live server lookup rather than a check against the lots the page happens to
// have loaded — a stale client can't see a lot another cataloguer just created
// on a different device, which is exactly when a duplicate gets minted.
//
// Both identifier fields are checked: the wizard's barcode box legitimately
// accepts an internal barcode OR a unique ID (RULES.md → Lot Identifiers), and
// either one landing twice means the same physical item catalogued twice.
//
// Returns rather than throws — a thrown server action is redacted in production
// (RULES.md), and the caller needs to tell "not a duplicate" apart from
// "couldn't check" so it never silently waves a duplicate through.
// ⚠ Raw SQL on purpose, and it must stay that way. Prisma's `mode: "insensitive"`
// compiles to ILIKE, which Postgres cannot serve from a btree index — so the
// obvious findFirst version sequentially scans every lot ever catalogued, on
// every press of Next. `LOWER(col) = LOWER($1)` matches the functional indexes
// created in run-migrations (CatalogueLot_barcode_lower_idx /
// CatalogueLot_receiptUniqueId_lower_idx), turning it into an index lookup.
// Those indexes cannot be declared in schema.prisma — Prisma has no syntax for
// expression indexes — so they live in the migrations list alone.
export async function checkBarcodeAssigned(barcode: string): Promise<{
  ok: boolean
  error?: string
  taken?: {
    title: string
    barcode: string | null
    receiptUniqueId: string | null
    auctionCode: string
    auctionName: string
    sameAuctionId: string | null
    createdByName: string | null
  } | null
}> {
  try {
    await requireCataloguer()
    const code = (barcode ?? "").trim()
    if (!code) return { ok: true, taken: null }

    const rows = await prisma.$queryRaw<Array<{
      title: string
      barcode: string | null
      receiptUniqueId: string | null
      createdByName: string | null
      auctionId: string
      auctionCode: string | null
      auctionName: string | null
    }>>`
      SELECT l."title", l."barcode", l."receiptUniqueId", l."createdByName", l."auctionId",
             a."code" AS "auctionCode", a."name" AS "auctionName"
      FROM "CatalogueLot" l
      LEFT JOIN "CatalogueAuction" a ON a."id" = l."auctionId"
      WHERE LOWER(l."barcode") = LOWER(${code})
         OR LOWER(l."receiptUniqueId") = LOWER(${code})
      ORDER BY l."createdAt" ASC
      LIMIT 1
    `

    const hit = rows[0]
    if (!hit) return { ok: true, taken: null }
    return {
      ok: true,
      taken: {
        title:           hit.title,
        barcode:         hit.barcode,
        receiptUniqueId: hit.receiptUniqueId,
        auctionCode:     hit.auctionCode ?? "",
        auctionName:     hit.auctionName ?? "",
        sameAuctionId:   hit.auctionId,
        createdByName:   hit.createdByName,
      },
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not check the barcode" }
  }
}

export async function togglePublished(id: string, published: boolean) {
  await requireCataloguer()
  await prisma.catalogueAuction.update({ where: { id }, data: { published } })
  revalidatePath("/tools/cataloguing/auctions")
  revalidatePath(`/tools/cataloguing/auctions/${id}`)
  revalidatePath("/auctions")
}

// Toggle the "complete" flag from the auctions list — moves the auction between
// the Active and Completed tables.
export async function toggleAuctionComplete(id: string, value: boolean) {
  await requireCataloguer()
  await prisma.catalogueAuction.update({ where: { id }, data: { complete: value } })
  revalidatePath("/tools/cataloguing/auctions")
}

// Result of the create-lot idle gate — returned to the client instead of
// creating the lot when a working-hours gap since the cataloguer's last save
// hasn't been accounted for.
export type IdleGateBlock = { needsIdle: true; idleMs: number; sinceMs: number }

// The idle gate logic now lives in lib/idle-gate.ts (evaluateIdleGate), shared
// with the last-activity endpoint so the on-screen popup and the save-block use
// the same server-authoritative decision. createLot below evaluates it, records
// the decision (with what the device clock claimed), and blocks if unaccounted.

// How many lots THIS cataloguer has saved via the Add Lot wizard so far today
// (UK working day). Read from CatalogueTimingLog, whose savedAt is stamped with
// the SERVER's clock — so the count survives the app being closed/reopened and
// resets itself at UK midnight (a new day simply has no rows yet). The wizard's
// "X lots today" badge seeds from this instead of an in-memory tally that was
// lost on every reload. WIZARD saves only (the Add Lot flow), across all auctions.
export async function getMyLotsToday(): Promise<number> {
  const session = await auth()
  if (!session) return 0
  return prisma.catalogueTimingLog.count({
    where: {
      userId:  session.user.id,
      method:  "WIZARD",
      savedAt: { gte: ukDayStartUtc(new Date()) },
    },
  })
}

export async function createLot(auctionId: string, formData: FormData) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  const data = extractLotData(formData)
  const createdByName = session.user.name ?? session.user.email ?? "Unknown"

  // Backstop against runaway auto-creation (a barcode scanner stuck in
  // continuous mode was minting duplicate lots + phantom timing logs): refuse an
  // identical barcode in the same auction within a short window. Real
  // cataloguing never re-uses a barcode, so this only blocks the runaway case.
  const bc = (formData.get("barcode") as string | null)?.trim()
  if (bc) {
    const dup = await prisma.catalogueLot.findFirst({
      where:  { auctionId, barcode: bc, createdAt: { gte: new Date(Date.now() - 60_000) } },
      select: { id: true },
    })
    if (dup) return
  }

  // Idle gate — before any photo upload, so a blocked attempt leaves no orphan
  // R2 objects. Evaluated server-side (server clock + DB save times, London
  // working hours), so a fiddled phone clock can't shrink the gap. We ALSO record
  // the decision plus what the device claimed (clientNow/clientTz), which exposes
  // a phone set to a US timezone / odd time to dodge the 9–5 check. The client
  // shows the popup and, once a reason is logged, re-saves (which then passes).
  // ⚠ Measured to when this lot was STARTED, not to now. Measuring to the save folds the
  // lot's own working minutes into the break — back from lunch at 13:25, ten minutes on a
  // lot, saved 13:35, reported as a 70-minute absence (Jordan, 2026-08-17).
  const idleGate  = await evaluateIdleGate(
    session.user.id, "lot-start",
    parseInt(formData.get("durationMs") as string ?? "") || null,
  )
  const clientNow = parseInt(formData.get("clientNow") as string ?? "") || null
  const clientTz  = ((formData.get("clientTz") as string) || "").trim() || null
  const userAgent = (await headers()).get("user-agent")
  const tampered  = clockLooksTampered(clientNow, clientTz, idleGate.nowMs)
  // Log the interesting saves (any gate action) and ANY tampered-clock save; skip
  // the ordinary rapid-save case so the table stays small.
  const boring = idleGate.reason === "UNDER_THRESHOLD" || idleGate.reason === "TIMER_OFF" || idleGate.reason === "NO_HISTORY"
  if (!boring || tampered) {
    await logIdleDecision({ gate: idleGate, userId: session.user.id, userName: createdByName, auctionId, clientNow, clientTz, userAgent })
  }
  if (idleGate.blocked) return { needsIdle: true, idleMs: idleGate.idleMs, sinceMs: idleGate.since?.getTime() ?? Date.now() } satisfies IdleGateBlock

  const photoFiles = formData.getAll("photo") as File[]
  const imageUrls: string[] = []
  for (let i = 0; i < photoFiles.length; i++) {
    const f = photoFiles[i]
    if (f && f.size > 0) {
      const ext = f.name.split(".").pop() || "jpg"
      const buf = Buffer.from(await f.arrayBuffer())
      const key = await uploadBufferToR2(buf, `lot-photos/${auctionId}/${data.barcode || "lot"}-${Date.now()}-${i}.${ext}`, f.type || "image/jpeg")
      imageUrls.push(key)
    }
  }

  // ⚠ NO unique ID is minted at creation (changed 2026-08-06, Jordan's call).
  // The Hub used to mint a provisional {receipt}-N here under an advisory lock,
  // but per the real workflow those IDs were placeholders that 🔗 BC Match
  // overwrote with BC's OWN UniqueIDs after the overnight import anyway — two
  // numbering systems racing each other for no benefit. receiptUniqueId now
  // stays NULL until BC Match imports BC's value (bulkAssignUniqueIds, matched
  // by barcode). The BARCODE is the lot's identifier until then.
  // ⚠ Forced on for a cataloguer who writes their own descriptions — see writesOwnDescriptions.
  const forcedExcluded = await writesOwnDescriptions(session.user.id)
  const lot = await prisma.catalogueLot.create({
    data: { ...data, aiExcluded: data.aiExcluded || forcedExcluded, auctionId, createdByName, imageUrls, receiptUniqueId: null },
    include: { auction: { select: { code: true } } },
  })

  await logLotCreated(lot, lot.auction?.code ?? "", { changedBy: createdByName, source: "lot_create" })

  // ALWAYS log the save — even when the client sends durationMs = 0.
  //
  // durationMs is 0 whenever the scan timer never started (barcodeStartedAt was
  // null at save). On a phone the barcode can be filled without a keystroke
  // (autofill / a scanner keyboard-app injecting the value / paste), which never
  // fires the input's onChange, so the timer never starts. Previously this write
  // was gated on `durationMs > 0`, so those saves left NO CatalogueTimingLog at
  // all — which (a) starved the server idle gate of a baseline (it measures from
  // the last timing log, so it could never fire for that user) and (b) hid the
  // user entirely from /admin/idle-gaps and the cataloguing reports, which are
  // built from these rows. Writing unconditionally, with the SERVER's savedAt,
  // anchors the whole idle system to server time regardless of the device.
  // durationMs = 0 marks an untimed save; report speed stats ignore those rows.
  const durationMs  = parseInt(formData.get("durationMs")  as string ?? "0") || 0
  const keyPointsMs = parseInt(formData.get("keyPointsMs") as string ?? "0") || 0
  await prisma.catalogueTimingLog.create({
    data: {
      auctionId,
      lotId:       lot.id,
      userId:      session.user.id,
      userName:    createdByName,
      method:      "WIZARD",
      durationMs,
      keyPointsMs: keyPointsMs > 0 ? keyPointsMs : null,
    },
  })

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function createPhotoOnlyLot(auctionId: string, formData: FormData) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)

  const toteNumber = (formData.get("tote") as string)?.trim() || null
  const notes      = (formData.get("notes") as string)?.trim() || null
  const photoFiles = formData.getAll("itemPhoto") as File[]

  const imageUrls: string[] = []
  for (let i = 0; i < photoFiles.length; i++) {
    const f = photoFiles[i]
    if (f && f.size > 0) {
      const ext = f.name.split(".").pop() || "jpg"
      const buf = Buffer.from(await f.arrayBuffer())
      const key = await uploadBufferToR2(buf, `lot-photos/${auctionId}/${Date.now()}-${i}.${ext}`, f.type || "image/jpeg")
      imageUrls.push(key)
    }
  }

  const createdByName = session.user.name ?? session.user.email ?? "Unknown"
  const lot = await prisma.catalogueLot.create({
    data: { auctionId, title: "", description: "", tote: toteNumber || null, notes, status: "ENTERED", imageUrls, createdByName,
      aiExcluded: await writesOwnDescriptions(session.user.id) },
    include: { auction: { select: { code: true } } },
  })

  await logLotCreated(lot, lot.auction?.code ?? "", { changedBy: createdByName, source: "photo_only" })

  // Log timing if provided
  const durationMs = parseInt(formData.get("durationMs") as string ?? "0") || 0
  if (durationMs > 0) {
    await prisma.catalogueTimingLog.create({
      data: {
        auctionId,
        lotId:     lot.id,
        userId:    session.user.id,
        userName:  createdByName,
        method:    "PHOTO_ONLY",
        durationMs,
      },
    })
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function updateLot(lotId: string, auctionId: string, formData: FormData) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  const data = extractLotData(formData)

  // receiptUniqueId is auto-assigned on creation and managed by dedicated routes (bulk-assign,
  // sequencing). If the form doesn't include this field, preserve the existing value rather than
  // overwriting it with null — which is what happens when the wizard is saved without the field.
  const hasUniqueIdField = formData.has("receiptUniqueId")
  const { receiptUniqueId, ...dataWithoutUniqueId } = data
  const updateData = hasUniqueIdField ? data : dataWithoutUniqueId

  const old = await prisma.catalogueLot.findUnique({
    where: { id: lotId },
    select: {
      barcode: true, title: true, keyPoints: true, description: true,
      estimateLow: true, estimateHigh: true, startingBid: true, reserve: true,
      hammerPrice: true, condition: true, vendor: true, tote: true, receipt: true,
      receiptUniqueId: true, category: true, subCategory: true, brand: true,
      notes: true, extraDetails: true, status: true, aiExcluded: true,
      auction: { select: { code: true } },
    },
  })

  await prisma.catalogueLot.update({ where: { id: lotId }, data: updateData })

  if (old) {
    await logLotFieldChanges(
      old, updateData,
      { id: lotId, auctionId, barcode: updateData.barcode ?? old.barcode ?? null, title: updateData.title ?? old.title ?? null },
      old.auction?.code ?? "",
      { changedBy: changedByOf(session), source: "lot_editor" },
    )
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function deleteLot(lotId: string, auctionId: string) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  // Snapshot before deleting so the log keeps a record of who deleted what.
  const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, include: { auction: { select: { code: true } } } })
  // Delete the lot's cataloguing timing logs with it. CatalogueTimingLog.lotId is
  // not a FK, so without this the log is orphaned and keeps counting forever in
  // the reports as a "phantom" lot that no longer exists.
  await prisma.$transaction([
    prisma.catalogueTimingLog.deleteMany({ where: { lotId } }),
    prisma.catalogueLot.delete({ where: { id: lotId } }),
  ])
  if (lot) await logLotDeleted(lot, lot.auction?.code ?? "", { changedBy: changedByOf(session), source: "lot_editor" })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function toggleLotAiUpgraded(lotId: string, auctionId: string, value: boolean) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  await updateLotLogged(lotId, { aiUpgraded: value }, { changedBy: changedByOf(session), source: "lot_editor" })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

// Manual cataloguer tick — set after a lot has gone over to Business Central.
export async function toggleLotAddedToBC(lotId: string, auctionId: string, value: boolean) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  await updateLotLogged(lotId, { addedToBC: value }, { changedBy: changedByOf(session), source: "lot_editor" })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

// Log a bulk flag change: snapshot the flag before, update, log only the lots that changed.
async function logBulkFlag(lotIds: string[], auctionId: string, field: keyof typeof LOGGABLE_SELECT, label: string, value: boolean, ctx: LotLogCtx) {
  const before = await prisma.catalogueLot.findMany({
    where:  { id: { in: lotIds }, auctionId },
    select: { id: true, auctionId: true, barcode: true, title: true, [field]: true, auction: { select: { code: true } } } as any,
  })
  const rows = before
    .filter((l: any) => l[field] !== value)
    .map((l: any) => buildLotEventRow({ id: l.id, auctionId: l.auctionId, barcode: l.barcode, title: l.title }, l.auction?.code ?? "", "updated", label, l[field], value, ctx))
  await writeLotEvents(rows)
}

// Bulk set AI excluded — used by the mass-select action on Manage Lots.
export async function bulkSetLotsAiExcluded(lotIds: string[], auctionId: string, value: boolean) {
  const session = await requireCataloguer()
  if (lotIds.length === 0) return { count: 0 }
  const ctx = { changedBy: changedByOf(session), source: "bulk", batchId: newBatchId() }
  const changing = await prisma.catalogueLot.findMany({ where: { id: { in: lotIds }, auctionId, aiExcluded: { not: value } }, select: { id: true } })
  await logBulkFlag(lotIds, auctionId, "aiExcluded", "AI Excluded", value, ctx)
  const r = await prisma.catalogueLot.updateMany({ where: { id: { in: lotIds }, auctionId }, data: { aiExcluded: value } })
  await recordBulkUndo(auctionId, session, `${value ? "Exclude" : "Un-exclude"} from AI (${changing.length})`,
    changing.map((l) => ({ lotId: l.id, fields: { aiExcluded: { before: !value, after: value } } })))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { count: r.count }
}

// Bulk set — used by the mass-select action on Manage Lots.
export async function bulkSetLotsAddedToBC(lotIds: string[], auctionId: string, value: boolean) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  if (lotIds.length === 0) return { count: 0 }
  const ctx = { changedBy: changedByOf(session), source: "bulk", batchId: newBatchId() }
  const changing = await prisma.catalogueLot.findMany({ where: { id: { in: lotIds }, auctionId, addedToBC: { not: value } }, select: { id: true } })
  await logBulkFlag(lotIds, auctionId, "addedToBC", "Added to BC", value, ctx)
  const r = await prisma.catalogueLot.updateMany({ where: { id: { in: lotIds }, auctionId }, data: { addedToBC: value } })
  await recordBulkUndo(auctionId, session, `${value ? "Mark" : "Unmark"} added to BC (${changing.length})`,
    changing.map((l) => ({ lotId: l.id, fields: { addedToBC: { before: !value, after: value } } })))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { count: r.count }
}

// Mass action — remove ALL photos from the selected lots.
// deleteFromStorage=true also deletes the underlying R2 objects.
export async function bulkClearLotPhotos(lotIds: string[], auctionId: string, deleteFromStorage: boolean) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  if (lotIds.length === 0) return { count: 0 }

  const lots = await prisma.catalogueLot.findMany({
    where:  { id: { in: lotIds }, auctionId },
    select: { id: true, auctionId: true, barcode: true, title: true, imageUrls: true, auction: { select: { code: true } } },
  })

  if (deleteFromStorage) {
    const allKeys = lots.flatMap(l => l.imageUrls)
    await deleteObjectsFromR2(allKeys)
  }

  const r = await prisma.catalogueLot.updateMany({
    where: { id: { in: lotIds }, auctionId },
    data:  { imageUrls: [] },
  })

  const ctx = { changedBy: changedByOf(session), source: "bulk", batchId: newBatchId() }
  const rows = lots.filter(l => l.imageUrls.length > 0).map(l =>
    buildLotEventRow({ id: l.id, auctionId: l.auctionId, barcode: l.barcode, title: l.title }, l.auction?.code ?? "", "photo_removed", "Photos removed", `${l.imageUrls.length} photo${l.imageUrls.length !== 1 ? "s" : ""} cleared`, "", ctx))
  await writeLotEvents(rows)

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { count: r.count }
}

// These review-tab actions RETURN their error instead of throwing. In production
// Next.js redacts a thrown server-action error's message to a generic "Server
// Components render" string, so a cataloguer hitting the BC lock (or any error)
// saw gibberish. Returning the message lets the client show the real reason
// (e.g. "This auction has been added to BC and is locked. Only admins can…").
type ActionResult = { ok: boolean; error?: string }

// Review tab — raise or clear an error flag on a lot. flag = reason text, null clears it.
// NOT BC-locked: the Review tab is QA/corrections, which cataloguers are allowed to
// do even after the auction has gone to BC (the lock still applies everywhere else).
export async function setLotReviewFlag(lotId: string, auctionId: string, flag: string | null): Promise<ActionResult> {
  try {
    const session = await requireCataloguer()
    await updateLotLogged(lotId,
      flag?.trim()
        ? { reviewFlag: flag.trim(), reviewFlaggedBy: changedByOf(session), reviewFlaggedAt: new Date() }
        : { reviewFlag: null, reviewFlaggedBy: null, reviewFlaggedAt: null },
      { changedBy: changedByOf(session), source: "review_tab" },
    )
    revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't save the flag." }
  }
}

// Pipeline (set) + Review-tab "Ignore" (clear) — the AI's potential-mistake note.
// No BC lock here on purpose: the pipeline sets these on any auction, and dismissing
// a note is not a catalogue edit.
export async function saveAiFlagNote(lotId: string, flagNote: string | null): Promise<ActionResult> {
  try {
    const session = await requireCataloguer()
    let note = flagNote?.trim() || null
    // ⚠ A size that merely disagrees with the manufacturer's published spec is NOT a mistake —
    // we measure the item, and it may have been cut down or modified. Gated here as well as in
    // lib/pipeline-runner.ts, because this is the path the browser Auto Pipeline tab and the
    // Re-check Cataloguer Flags button write through. See lib/measurement-check.ts.
    if (note) {
      const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: { keyPoints: true } })
      if (!shouldKeepFlag(note, lot?.keyPoints ?? "")) note = null
    }
    await updateLotLogged(lotId, { aiFlagNote: note }, { changedBy: changedByOf(session), source: "ai_flag" })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't update the flag." }
  }
}

// Review tab — save a manually edited description for a lot.
// NOT BC-locked: Review-tab corrections are allowed after an auction has gone to BC
// (the lock still applies to the wizard, Manage Lots, bulk actions, delete, etc.).
export async function saveLotDescription(lotId: string, auctionId: string, description: string): Promise<ActionResult> {
  try {
    const session = await requireCataloguer()
    await updateLotLogged(lotId, { description, title: titleFromDescription(description), aiFlagNote: null }, { changedBy: changedByOf(session), source: "review_tab" })
    revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't save the description." }
  }
}

// Review tab — "the KEY POINTS were wrong, not the description."
//
// A cataloguer who types R4328 into the key points and R3428 into the description leaves the
// lot stuck on "needs attention" for ever, because the matcher is correct: that key point
// genuinely is not in the description. Editing the description cannot clear it — the wrong
// text is in the key points. This records the checker's verdict so it stops counting, and,
// when they correct the key points, leaves the CORRECTED text behind for any later AI run
// (the key points are what Batch, Key Points Check and Double Check are all measured against).
//
// ⚠ Passing `keyPoints` REWRITES the cataloguer's own record of the item. That is only ever
// done by a person looking at the lot, and every change is in the Lot Change Log.
// NOT BC-locked — same as the other Review-tab actions.
export async function resolveKeyPointsMistake(
  lotId: string,
  auctionId: string,
  opts: { keyPoints?: string | null; note?: string } = {},
): Promise<ActionResult> {
  try {
    const session = await requireCataloguer()
    const corrected = typeof opts.keyPoints === "string" && opts.keyPoints.trim().length > 0
    const data: Record<string, any> = {
      kpFixNote: (opts.note?.trim() || (corrected
        ? "Key points corrected — the cataloguer's notes were wrong"
        : "Cataloguer mistake — the key points were wrong, the description is right")).slice(0, 500),
      kpFixedBy: changedByOf(session),
      kpFixedAt: new Date(),
    }
    if (corrected) data.keyPoints = opts.keyPoints!.trim()
    await updateLotLogged(lotId, data, { changedBy: changedByOf(session), source: "review_tab" })
    revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't save that." }
  }
}

// Review tab — apply the reviewed corrections for a batch of AI-flagged lots in one go.
// ⚠ Everything here has been through a person: the fixes are generated, listed on screen, and
// only the rows still ticked reach this action. Nothing is written unseen.
// NOT BC-locked, in line with the other Review-tab actions.
export async function applyFlagFixes(
  auctionId: string,
  fixes: { lotId: string; description: string; keyPoints?: string | null }[],
): Promise<{ ok: boolean; applied: number; errors: string[]; failed: string[] }> {
  const errors: string[] = []
  const failed: string[] = []
  try {
    const session = await requireCataloguer()
    const batchId = newBatchId()
    const clean = fixes.filter(f => f.lotId && (f.description ?? "").trim())

    // Sequential, not Promise.all — each write reads the lot back to diff it for the change log,
    // and one bad row must not lose the rest of the batch.
    let applied = 0
    for (const f of clean) {
      try {
        const kp = (f.keyPoints ?? "").trim()
        await updateLotLogged(f.lotId, {
          description: f.description,
          title:       titleFromDescription(f.description),
          aiFlagNote:  null,
          // Correcting the key points is also the verdict "the cataloguer's notes were wrong",
          // so record it — otherwise the lot lands straight back in "needs attention" with the
          // old key point still absent from the new description.
          ...(kp ? {
            keyPoints: kp,
            kpFixNote: "Key points corrected while fixing an AI-flagged mistake",
            kpFixedBy: changedByOf(session),
            kpFixedAt: new Date(),
          } : {}),
        }, { changedBy: changedByOf(session), source: "review_tab", batchId })
        applied++
      } catch (e: any) {
        failed.push(f.lotId)
        errors.push(`${f.lotId}: ${e?.message ?? "failed"}`)
      }
    }

    revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
    return { ok: errors.length === 0, applied, errors, failed }
  } catch (e: any) {
    return { ok: false, applied: 0, errors: [e?.message ?? "Couldn't apply the fixes."], failed: fixes.map(f => f.lotId) }
  }
}

// Undo the above — the warning comes back. Never touches the key points text: if they were
// corrected, that correction stands (undoing a verdict must not silently restore wrong data).
export async function clearKeyPointsMistake(lotId: string, auctionId: string): Promise<ActionResult> {
  try {
    const session = await requireCataloguer()
    await updateLotLogged(lotId, { kpFixNote: null, kpFixedBy: null, kpFixedAt: null },
      { changedBy: changedByOf(session), source: "review_tab" })
    revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't undo that." }
  }
}

export async function saveLotExtraDetails(lotId: string, auctionId: string, extraDetails: string) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  await updateLotLogged(lotId, { extraDetails }, { changedBy: changedByOf(session), source: "review_tab" })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function createPhotoSession(formData: FormData) {
  const session = await requireCataloguer()

  const auctionId    = formData.get("auctionId") as string
  const lotBarcode   = (formData.get("lotBarcode") as string)?.trim() || null
  const customerRef  = (formData.get("customerRef") as string)?.trim() || null
  const notes        = (formData.get("notes") as string)?.trim() || null
  const barcodeFile  = formData.get("barcodePhoto") as File | null
  const itemFiles    = formData.getAll("itemPhoto") as File[]

  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const prefix    = `photo-sessions/${auctionId}/${sessionId}`

  let barcodePhotoKey: string | null = null
  if (barcodeFile && barcodeFile.size > 0) {
    const ext = barcodeFile.name.split(".").pop() || "jpg"
    const buf = Buffer.from(await barcodeFile.arrayBuffer())
    barcodePhotoKey = await uploadBufferToR2(buf, `${prefix}/barcode-${Date.now()}.${ext}`, barcodeFile.type || "image/jpeg")
  }

  const itemPhotoKeys: string[] = []
  for (let i = 0; i < itemFiles.length; i++) {
    const f = itemFiles[i]
    if (f && f.size > 0) {
      const ext = f.name.split(".").pop() || "jpg"
      const buf = Buffer.from(await f.arrayBuffer())
      const key = await uploadBufferToR2(buf, `${prefix}/item-${Date.now()}-${i}.${ext}`, f.type || "image/jpeg")
      itemPhotoKeys.push(key)
    }
  }

  const record = await prisma.cataloguePhotoSession.create({
    data: {
      auctionId,
      lotBarcode,
      customerRef,
      barcodePhotoKey,
      itemPhotoKeys,
      notes,
      status: "PENDING",
      createdById: session.user.id,
      createdByName: session.user.name ?? null,
    },
  })

  return {
    id: record.id,
    lotBarcode: record.lotBarcode,
    customerRef: record.customerRef,
    itemPhotoKeys: record.itemPhotoKeys,
    status: record.status,
    createdByName: record.createdByName,
    createdAt: record.createdAt.toISOString(),
  }
}

export async function fillLotsFromTotes(auctionId: string) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)

  const lots = await prisma.catalogueLot.findMany({
    where: { auctionId, tote: { not: null } },
    // ⚠ receiptUniqueId MUST be selected here — earlier versions of this
    // function didn't and ended up overwriting existing unique IDs with
    // null whenever a lot was missing its vendor but already had a receipt.
    select: { id: true, tote: true, vendor: true, receipt: true, receiptUniqueId: true },
  })

  if (lots.length === 0) return { updated: 0 }

  const toteIds = [...new Set(lots.map(l => l.tote!).filter(Boolean))]

  const toteMap = new Map<string, { vendor: string; receipt: string }>()
  for (const toteId of toteIds) {
    const container = await prisma.warehouseContainer.findUnique({
      where: { id: toteId },
      include: { receipt: true },
    })
    if (container) {
      toteMap.set(toteId, {
        vendor: container.receipt.contactId,
        receipt: container.receiptId,
      })
    }
  }

  // Pre-count existing sequenced lots per receipt base. We need an offset for
  // any lot that's MISSING a uniqueId (not just missing a receipt) — otherwise
  // a lot that already has a receipt set but no uniqueId would never get one.
  const receiptOffset: Record<string, number> = {}
  for (const lot of lots) {
    if (lot.receiptUniqueId) continue // already sequenced, no offset needed
    const targetReceipt = lot.receipt || toteMap.get(lot.tote!)?.receipt
    if (!targetReceipt) continue
    if (!(targetReceipt in receiptOffset)) {
      receiptOffset[targetReceipt] = await maxReceiptSuffix(targetReceipt)
    }
  }

  let updated = 0
  const fillCtx: LotLogCtx = { changedBy: changedByOf(session), source: "warehouse_fill", batchId: newBatchId() }
  for (const lot of lots) {
    if (!lot.tote) continue
    const info = toteMap.get(lot.tote)
    // Only skip if the tote lookup failed AND the lot has no receipt of its own.
    // If the lot already has a receipt, we can still assign a uniqueId — don't skip it.
    if (!info && !lot.receipt) continue

    // Work out the desired final state
    const desiredVendor  = lot.vendor  || info?.vendor  || null
    const desiredReceipt = lot.receipt || info?.receipt || null
    // Preserve existing uniqueId if there is one; only generate when missing
    let desiredUniqueId = lot.receiptUniqueId ?? null
    if (!desiredUniqueId && desiredReceipt) {
      receiptOffset[desiredReceipt] = (receiptOffset[desiredReceipt] ?? 0) + 1
      desiredUniqueId = `${desiredReceipt}-${receiptOffset[desiredReceipt]}`
    }

    const needsUpdate =
      (lot.vendor          ?? null) !== (desiredVendor   ?? null) ||
      (lot.receipt         ?? null) !== (desiredReceipt  ?? null) ||
      (lot.receiptUniqueId ?? null) !== (desiredUniqueId ?? null)

    if (needsUpdate) {
      await updateLotLogged(lot.id, {
        vendor:          desiredVendor,
        receipt:         desiredReceipt,
        receiptUniqueId: desiredUniqueId,
      }, fillCtx)
      updated++
    }
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { updated }
}

// Returns { ok, error } instead of throwing: production redacts thrown
// server-action messages, so a cataloguer hitting the BC lock (or any other
// expected failure) would see gibberish instead of the reason.
export async function uploadLotPhoto(
  lotId: string, auctionId: string, formData: FormData
): Promise<{ ok: true; imageUrls: string[] } | { ok: false; error: string }> {
  try {
    const session = await requireCataloguer()
    await requireNotBCLocked(auctionId, session)

    const file = formData.get("photo") as File
    if (!file || file.size === 0) return { ok: false, error: "No file provided" }

    const buf = Buffer.from(await file.arrayBuffer())
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key = await uploadBufferToR2(
      buf,
      `lot-photos/${auctionId}/${lotId}/${Date.now()}-${safeName}`,
      file.type || "image/jpeg"
    )

    const lot = await prisma.catalogueLot.update({
      where: { id: lotId },
      data: { imageUrls: { push: key } },
      include: { auction: { select: { code: true } } },
    })

    await logLotPhoto({ id: lot.id, auctionId: lot.auctionId, barcode: lot.barcode, title: lot.title }, lot.auction?.code ?? "", "photo_added", { changedBy: changedByOf(session), source: "photo_tab" }, safeName)
    return { ok: true, imageUrls: lot.imageUrls }
  } catch (e: any) {
    console.error("uploadLotPhoto error:", e)
    return { ok: false, error: e?.message ?? "Upload failed" }
  }
}

// Auction Manager ⭐ — star a sale so it sits in "Currently working on" at the top.
//
// ⚠ PER USER. Nothing about a starred sale is visible to anyone else, and starring is NOT a
// status: it must never be confused with catalogued / photographed / complete, which describe
// the sale itself. Deliberately not BC-locked — it changes nothing about the sale.
// Returns rather than throws (production redacts thrown server-action messages).
export async function toggleAuctionFavourite(
  auctionId: string,
): Promise<{ ok: boolean; favourite: boolean; error?: string }> {
  try {
    const session = await auth()
    if (!session?.user?.id) return { ok: false, favourite: false, error: "Not signed in" }
    const userId = session.user.id

    const existing = await prisma.catalogueAuctionFavourite.findUnique({
      where: { userId_auctionId: { userId, auctionId } },
      select: { userId: true },
    })
    if (existing) {
      await prisma.catalogueAuctionFavourite.delete({ where: { userId_auctionId: { userId, auctionId } } })
      revalidatePath("/tools/cataloguing/auctions")
      return { ok: true, favourite: false }
    }
    await prisma.catalogueAuctionFavourite.create({ data: { userId, auctionId } })
    revalidatePath("/tools/cataloguing/auctions")
    return { ok: true, favourite: true }
  } catch (e: any) {
    return { ok: false, favourite: false, error: e?.message ?? "Couldn't change that." }
  }
}

// Store the barcode LABEL photo that assigned this lot's photos during a smart
// scan. Deliberately kept in its own column, never pushed into imageUrls — it
// is an internal check aid and must not reach the website, BC or AI runs.
// Returns rather than throws (production redacts thrown server-action errors).
export async function uploadLotLabelPhoto(
  lotId: string, auctionId: string, formData: FormData
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  try {
    const session = await requireCataloguer()
    await requireNotBCLocked(auctionId, session)

    const file = formData.get("photo") as File
    if (!file || file.size === 0) return { ok: false, error: "No file provided" }

    const buf = Buffer.from(await file.arrayBuffer())
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key = await uploadBufferToR2(
      buf,
      `lot-labels/${auctionId}/${lotId}/${Date.now()}-${safeName}`,
      file.type || "image/jpeg"
    )

    const lot = await prisma.catalogueLot.update({
      where: { id: lotId },
      data: { labelPhotoUrl: key },
      include: { auction: { select: { code: true } } },
    })

    await logLotPhoto(
      { id: lot.id, auctionId: lot.auctionId, barcode: lot.barcode, title: lot.title },
      lot.auction?.code ?? "", "photo_label",
      { changedBy: changedByOf(session), source: "photo_tab" }, safeName,
    )
    return { ok: true, key }
  } catch (e: any) {
    console.error("uploadLotLabelPhoto error:", e)
    return { ok: false, error: e?.message ?? "Label photo upload failed" }
  }
}

export async function deleteLotPhoto(lotId: string, auctionId: string, key: string) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)

  const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: { id: true, auctionId: true, barcode: true, title: true, imageUrls: true, auction: { select: { code: true } } } })
  if (!lot) throw new Error("Lot not found")

  const updated = lot.imageUrls.filter(k => k !== key)
  await prisma.catalogueLot.update({ where: { id: lotId }, data: { imageUrls: updated } })

  await logLotPhoto({ id: lot.id, auctionId: lot.auctionId, barcode: lot.barcode, title: lot.title }, lot.auction?.code ?? "", "photo_removed", { changedBy: changedByOf(session), source: "photo_tab" }, key.split("/").pop())
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return updated
}

export async function reorderLotPhotos(lotId: string, auctionId: string, imageUrls: string[]) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  const lot = await prisma.catalogueLot.update({ where: { id: lotId }, data: { imageUrls }, include: { auction: { select: { code: true } } } })
  await logLotPhoto({ id: lot.id, auctionId: lot.auctionId, barcode: lot.barcode, title: lot.title }, lot.auction?.code ?? "", "photo_reordered", { changedBy: changedByOf(session), source: "photo_tab" }, `${imageUrls.length} photo${imageUrls.length !== 1 ? "s" : ""}`)
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return imageUrls
}

export async function importLots(auctionId: string, rows: {
  title: string; description: string
  keyPoints?: string; barcode?: string
  estimateLow: string; estimateHigh: string; reserve: string
  condition: string; status: string; vendor: string
  tote: string; receipt: string; category: string
  subCategory: string; brand: string; notes: string
}[]) {
  const session = await requireCataloguer()
  const createdByName = session.user.name ?? session.user.email ?? "Unknown"
  const auctionCode = (await prisma.catalogueAuction.findUnique({ where: { id: auctionId }, select: { code: true } }))?.code ?? ""
  const ctx: LotLogCtx = { changedBy: createdByName, source: "import", batchId: newBatchId() }

  // ⚠ NO unique IDs minted on import (2026-08-06) — they come from 🔗 BC Match
  // after the lots reach BC, matched by barcode. See createLot.
  const forcedExcluded = await writesOwnDescriptions(session.user.id)
  for (const r of rows) {
    const receiptUniqueId: string | null = null

    const lot = await prisma.catalogueLot.create({
      data: {
        auctionId,
        createdByName,
        title:          r.title || "",
        aiExcluded:     forcedExcluded,
        keyPoints:      r.keyPoints || r.description || "",
        barcode:        r.barcode?.toUpperCase() || null,
        description:    "",
        estimateLow:    r.estimateLow  ? parseInt(r.estimateLow)  : null,
        estimateHigh:   r.estimateHigh ? parseInt(r.estimateHigh) : null,
        reserve:        r.reserve      ? parseInt(r.reserve)      : null,
        hammerPrice:    null,
        condition:      r.condition    || null,
        status:         r.status       || "ENTERED",
        vendor:         r.vendor       || null,
        tote:           r.tote?.toUpperCase() || null,
        receipt:        r.receipt ? r.receipt.toUpperCase() : null,
        receiptUniqueId,
        category:       r.category    || null,
        subCategory:    r.subCategory || null,
        brand:          r.brand       || null,
        notes:          r.notes       || null,
        imageUrls:      [],
      },
    })
    await logLotCreated(lot, auctionCode, ctx)
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return rows.length
}

// Bulk-assign receiptUniqueId values from a spreadsheet mapping barcode → uniqueId.
// Only updates lots that belong to the given auction and whose barcode matches a row.
// Returns { updated, skipped } counts.
export async function bulkAssignUniqueIds(
  auctionId: string,
  pairs: { barcode: string; uniqueId: string }[]
): Promise<{ updated: number; skipped: number }> {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)

  // Fetch all lots in this auction that have a barcode
  const lots = await prisma.catalogueLot.findMany({
    where:  { auctionId, barcode: { not: null } },
    select: { id: true, barcode: true },
  })

  // Build barcode → lotId map (case-insensitive)
  const barcodeMap = new Map(lots.map(l => [l.barcode!.toLowerCase().trim(), l.id]))

  let updated = 0
  let skipped = 0
  const ctx: LotLogCtx = { changedBy: changedByOf(session), source: "bulk", batchId: newBatchId() }

  for (const { barcode, uniqueId } of pairs) {
    const lotId = barcodeMap.get(barcode.toLowerCase().trim())
    if (!lotId || !uniqueId.trim()) { skipped++; continue }
    await updateLotLogged(lotId, { receiptUniqueId: uniqueId.trim() }, ctx)
    updated++
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { updated, skipped }
}

const conditionText = (condition: string) => `Condition appears ${condition}.`

// Scope a bulk action to the selected lot ids, or the whole auction when none are
// selected — the house pattern (setStartingBids does the same). An empty array
// means "nothing selected → all"; a non-empty array constrains to those ids.
const scopeWhere = (auctionId: string, lotIds?: string[]) =>
  lotIds && lotIds.length ? { auctionId, id: { in: lotIds } } : { auctionId }

// Appends "Condition appears [condition]." to lots that have a condition set but
// whose description doesn't already contain it. Scoped to the selected lots when
// any are selected (previously it always hit every lot — the reported bug).
export async function bulkAddConditionsToDescriptions(
  auctionId: string,
  lotIds?: string[],
): Promise<{ updated: number; skipped: number }> {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)

  const lots = await prisma.catalogueLot.findMany({
    where:  { ...scopeWhere(auctionId, lotIds), condition: { not: null } },
    select: { id: true, condition: true, description: true },
  })

  let updated = 0
  let skipped = 0
  const ctx: LotLogCtx = { changedBy: changedByOf(session), source: "bulk", batchId: newBatchId() }
  const undo: UndoEntry[] = []

  for (const lot of lots) {
    const condition = lot.condition?.trim()
    if (!condition) { skipped++; continue }
    const condText = conditionText(condition)
    const oldDesc = lot.description ?? ""
    if (oldDesc.includes(condText)) { skipped++; continue }   // already present

    // ⚠ Joined with a NEW LINE, not a space (Jordan, 2026-08-19) — the condition is its own
    // statement, not the tail of the last sentence of the description.
    const newDesc = oldDesc.trimEnd() ? `${oldDesc.trimEnd()}\n${condText}` : condText
    await updateLotLogged(lot.id, { description: newDesc, title: titleFromDescription(newDesc) }, ctx)
    undo.push({ lotId: lot.id, fields: { description: { before: oldDesc, after: newDesc } } })
    updated++
  }

  await recordBulkUndo(auctionId, session, `Add conditions to descriptions (${updated})`, undo)
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { updated, skipped }
}

// The inverse: strip the "Condition appears [condition]." sentence this tool adds
// back out of the description, leaving the rest intact. ⚠ It must strip BOTH joins — the
// new line used since 2026-08-19 AND the single space used before it, because every lot
// conditioned before that change still carries the space form.
export async function bulkRemoveConditionsFromDescriptions(
  auctionId: string,
  lotIds?: string[],
): Promise<{ updated: number; skipped: number }> {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)

  const lots = await prisma.catalogueLot.findMany({
    where:  { ...scopeWhere(auctionId, lotIds), condition: { not: null } },
    select: { id: true, condition: true, description: true },
  })

  let updated = 0
  let skipped = 0
  const ctx: LotLogCtx = { changedBy: changedByOf(session), source: "bulk", batchId: newBatchId() }
  const undo: UndoEntry[] = []

  for (const lot of lots) {
    const condition = lot.condition?.trim()
    const oldDesc = lot.description ?? ""
    if (!condition || !oldDesc.includes(conditionText(condition))) { skipped++; continue }

    // Remove the sentence together with whatever joined it — newline first, then space,
    // then bare (a description that is nothing but the condition sentence).
    const condText = conditionText(condition)
    const newDesc = oldDesc
      .split(`\n${condText}`).join("")
      .split(` ${condText}`).join("")
      .split(condText).join("")
      .trim()
    if (newDesc === oldDesc) { skipped++; continue }
    await updateLotLogged(lot.id, { description: newDesc, title: titleFromDescription(newDesc) }, ctx)
    undo.push({ lotId: lot.id, fields: { description: { before: oldDesc, after: newDesc } } })
    updated++
  }

  await recordBulkUndo(auctionId, session, `Remove conditions from descriptions (${updated})`, undo)
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { updated, skipped }
}

// Clear descriptions — but ONLY on lots going through AI. aiExcluded lots have a
// hand-typed description that must be left alone, so they're never touched here.
export async function bulkClearDescriptions(
  auctionId: string,
  lotIds?: string[],
): Promise<{ updated: number; skippedExcluded: number }> {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)

  const lots = await prisma.catalogueLot.findMany({
    where:  { ...scopeWhere(auctionId, lotIds) },
    select: { id: true, description: true, aiExcluded: true },
  })

  let updated = 0
  let skippedExcluded = 0
  const ctx: LotLogCtx = { changedBy: changedByOf(session), source: "bulk", batchId: newBatchId() }
  const undo: UndoEntry[] = []

  for (const lot of lots) {
    if (lot.aiExcluded) { skippedExcluded++; continue }        // hand-typed — leave it
    const oldDesc = lot.description ?? ""
    if (!oldDesc.trim()) continue                              // already empty
    await updateLotLogged(lot.id, { description: "", title: titleFromDescription("") }, ctx)
    undo.push({ lotId: lot.id, fields: { description: { before: oldDesc, after: "" } } })
    updated++
  }

  await recordBulkUndo(auctionId, session, `Clear descriptions (${updated})`, undo)
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { updated, skippedExcluded }
}

// Highest existing line number for a receipt base, e.g. "R000123" → 4 when
// R000123-4 is the largest. Parses the numeric suffix and takes MAX — not
// COUNT — so deleted lots / gaps never cause a number to be reused. Used by the
// batch import / mass-create paths; the tablet wizard (createLot) does the same
// thing inside a transaction with an advisory lock for full race safety.
async function maxReceiptSuffix(base: string): Promise<number> {
  const existing = await prisma.catalogueLot.findMany({
    where:  { receiptUniqueId: { startsWith: base + "-" } },
    select: { receiptUniqueId: true },
  })
  let max = 0
  for (const e of existing) {
    const m = e.receiptUniqueId?.match(/-(\d+)$/)
    if (m) { const n = parseInt(m[1], 10); if (!isNaN(n) && n > max) max = n }
  }
  return max
}

export async function transferLots(lotIds: string[], sourceAuctionId: string, targetAuctionId: string) {
  const session = await requireCataloguer()
  await requireNotBCLocked(sourceAuctionId, session)
  // Snapshot lot identifiers + both auction codes before the move, so we can log the transfer.
  const before = await prisma.catalogueLot.findMany({
    where: { id: { in: lotIds }, auctionId: sourceAuctionId },
    select: { id: true, barcode: true, title: true },
  })
  const codes = await prisma.catalogueAuction.findMany({ where: { id: { in: [sourceAuctionId, targetAuctionId] } }, select: { id: true, code: true } })
  const sourceCode = codes.find(c => c.id === sourceAuctionId)?.code ?? ""
  const targetCode = codes.find(c => c.id === targetAuctionId)?.code ?? ""
  await prisma.$transaction([
    prisma.catalogueLot.updateMany({
      where: { id: { in: lotIds }, auctionId: sourceAuctionId },
      data: { auctionId: targetAuctionId },
    }),
    // Move the cataloguing timing logs WITH the lots. Without this they were
    // stranded in the source auction (which then shows 0 lots but inflated
    // report counts for everyone) — the phantom-count bug.
    prisma.catalogueTimingLog.updateMany({
      where: { lotId: { in: lotIds }, auctionId: sourceAuctionId },
      data: { auctionId: targetAuctionId },
    }),
  ])
  const ctx: LotLogCtx = { changedBy: changedByOf(session), source: "transfer", batchId: newBatchId() }
  await writeLotEvents(before.map(l =>
    buildLotEventRow({ id: l.id, auctionId: targetAuctionId, barcode: l.barcode, title: l.title }, targetCode, "updated", "Auction (transferred)", sourceCode, targetCode, ctx)
  ))
  revalidatePath(`/tools/cataloguing/auctions/${sourceAuctionId}`)
  revalidatePath(`/tools/cataloguing/auctions/${targetAuctionId}`)
  return lotIds.length
}

// One-off cleanup: remove cataloguing timing logs whose lot no longer exists
// ("deleted lot" / phantom rows that keep inflating the reports). Logs with a
// null lotId are legacy/legit and left alone. Admin-only, UI-triggered,
// idempotent. (deleteLot now removes logs at source, so this is for the history.)
export async function removeOrphanedTimingLogs(): Promise<{ count: number }> {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")
  const count = await prisma.$executeRaw`
    DELETE FROM "CatalogueTimingLog"
    WHERE "lotId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = "CatalogueTimingLog"."lotId")`
  revalidatePath("/tools/reports", "layout")  // invalidate the per-user pages too
  return { count }
}

// READ-ONLY diagnostic — dumps the orphaned ("deleted lot") timing logs so we
// can see where they actually come from instead of guessing: grouped by auction
// code, with distinct users, the key-points distribution, and a few raw sample
// rows (their own id + lotId). Admin-only.
export async function inspectOrphanedTimingLogs(): Promise<{
  total: number
  byAuction: {
    auctionCode: string | null
    auctionId: string
    count: number
    users: string[]
    zeroKeyPoints: number
    firstSeen: string | null
    lastSeen: string | null
    samples: { id: string; lotId: string | null; userName: string; method: string; durationMs: number; keyPointsMs: number | null; savedAt: string }[]
  }[]
}> {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")

  const rows = await prisma.$queryRaw<{
    id: string; auctionId: string; auctionCode: string | null; lotId: string | null
    userName: string; method: string; durationMs: number; keyPointsMs: number | null; savedAt: Date
  }[]>`
    SELECT t."id", t."auctionId", a."code" AS "auctionCode", t."lotId",
           t."userName", t."method", t."durationMs", t."keyPointsMs", t."savedAt"
    FROM "CatalogueTimingLog" t
    LEFT JOIN "CatalogueAuction" a ON a."id" = t."auctionId"
    WHERE t."lotId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId")
    ORDER BY t."savedAt" DESC`

  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const arr = groups.get(r.auctionId) ?? []
    arr.push(r)
    groups.set(r.auctionId, arr)
  }

  const byAuction = [...groups.entries()].map(([auctionId, list]) => ({
    auctionId,
    auctionCode: list[0].auctionCode,
    count: list.length,
    users: [...new Set(list.map(r => r.userName))],
    zeroKeyPoints: list.filter(r => !r.keyPointsMs).length,
    firstSeen: list.length ? list[list.length - 1].savedAt.toISOString() : null,
    lastSeen:  list.length ? list[0].savedAt.toISOString() : null,
    samples: list.slice(0, 8).map(r => ({
      id: r.id, lotId: r.lotId, userName: r.userName, method: r.method,
      durationMs: r.durationMs, keyPointsMs: r.keyPointsMs, savedAt: r.savedAt.toISOString(),
    })),
  })).sort((a, b) => b.count - a.count)

  return { total: rows.length, byAuction }
}

// Diagnostic — read the in-memory save-attempt buffer (see /api/catalogue/save-attempt)
// to see WHAT is activating the wizard's Save button. Admin-only.
export async function getSaveAttempts(): Promise<any[]> {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")
  const buf = (globalThis as { __saveAttempts?: any[] }).__saveAttempts ?? []
  return buf.slice(-200).reverse()
}

export async function massCreateLots(
  auctionId: string,
  auctionCode: string,
  opts: {
    count:       number
    vendor:      string
    tote:        string
    receipt:     string
    category:    string
    subCategory: string
  }
) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  const createdByName = session.user.name ?? session.user.email ?? "Unknown"

  // Work out the highest existing barcode suffix for this auction code so we
  // never produce a duplicate — e.g. F051003 → suffix 3
  const existingLots = await prisma.catalogueLot.findMany({
    where:  { auctionId },
    select: { barcode: true },
  })
  const prefix = auctionCode.toUpperCase()
  const maxBarcode = existingLots.reduce((max, l) => {
    if (!l.barcode) return max
    const b = l.barcode.toUpperCase()
    if (!b.startsWith(prefix)) return max
    const n = parseInt(b.slice(prefix.length))
    return !isNaN(n) && n > max ? n : max
  }, 0)

  const receiptBase = opts.receipt ? opts.receipt.toUpperCase() : null

  // ⚠ NO unique IDs minted on mass-create (2026-08-06) — they come from
  // 🔗 BC Match after the lots reach BC, matched by barcode. See createLot.
  const forcedExcluded = await writesOwnDescriptions(session.user.id)
  const data = Array.from({ length: opts.count }, (_, i) => ({
    auctionId,
    createdByName,
    aiExcluded:      forcedExcluded,
    barcode:         `${prefix}${String(maxBarcode + i + 1).padStart(3, "0")}`,
    title:           "",
    keyPoints:       "",
    description:     "",
    imageUrls:       [] as string[],
    vendor:          opts.vendor      || null,
    tote:            opts.tote        ? opts.tote.toUpperCase() : null,
    receipt:         receiptBase,
    receiptUniqueId: null as string | null,
    category:        opts.category    || null,
    subCategory:     opts.subCategory || null,
  }))

  await prisma.catalogueLot.createMany({ data })

  // createMany returns no ids — read the just-created lots back by their barcodes to log them.
  const created = await prisma.catalogueLot.findMany({
    where:  { auctionId, barcode: { in: data.map(d => d.barcode) } },
    select: LOGGABLE_SELECT,
  })
  await logLotsCreated(created as any, auctionCode, { changedBy: createdByName, source: "mass_create", batchId: newBatchId() })

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return data.length
}

// ── Lotting Up → real lots ────────────────────────────────────────────────────

export type LottingUpLotInput = {
  gid:          string          // the plan's group id, echoed back so the page can mark it added
  barcode:      string
  title:        string
  keyPoints:    string
  estimateLow:  number | null
  estimateHigh: number | null
}

export type LottingUpCreateResult = {
  ok:      boolean
  error?:  string
  created: { gid: string; barcode: string }[]
  skipped: { gid: string; barcode: string; reason: string }[]
}

/**
 * Create lots in THIS app from a Lotting Up plan. Nothing is sent to Business
 * Central — vendor/tote/receipt are copied from the BC-synced WarehouseTote
 * lookup the page already did, exactly as the lot wizard does.
 *
 * Deliberately NOT routed through createLot: that path carries the wizard's idle
 * gate, photo upload and a CatalogueTimingLog row with method "WIZARD". Lotting
 * up is not a wizard save, and writing those rows would put phantom saves into
 * the cataloguing speed stats and the idle-gate baseline. The lot change log
 * still records every creation, under source "lotting_up".
 *
 * ⚠ No unique ID is minted (receiptUniqueId stays NULL) — BC Match writes BC's
 * own value later, matched by barcode. The barcode is the identifier until then.
 */
export async function createLotsFromLottingUp(
  auctionId: string,
  details: { vendor: string; tote: string; receipt: string },
  lots: LottingUpLotInput[],
): Promise<LottingUpCreateResult> {
  const empty = { created: [], skipped: [] }
  try {
    const session = await requireCataloguer()
    await requireNotBCLocked(auctionId, session)
    const createdByName = changedByOf(session)

    const auction = await prisma.catalogueAuction.findUnique({
      where:  { id: auctionId },
      select: { code: true, auctionType: true, id: true },
    })
    if (!auction) return { ok: false, error: "That sale no longer exists.", ...empty }

    // A sale hidden from this user's departments must not be writable either —
    // hiding it from a list is not a restriction on its own.
    const access = await getDepartmentAccessForSession(session.user.id)
    if (!canSeeAuction(access, auction)) {
      return { ok: false, error: "You do not have access to that sale.", ...empty }
    }

    // Barcodes are the identifier here, so normalise them the same way every
    // other path does (strip non-ASCII, trim, upper) before any comparison.
    const clean = lots.map(l => ({
      ...l,
      barcode: (l.barcode ?? "").replace(/[^\x20-\x7E]/g, "").trim().toUpperCase(),
    }))

    const skipped: LottingUpCreateResult["skipped"] = []
    const queue:   typeof clean = []
    const seen     = new Set<string>()

    for (const l of clean) {
      if (!l.barcode) {
        skipped.push({ gid: l.gid, barcode: "", reason: "No barcode entered" })
      } else if (seen.has(l.barcode)) {
        skipped.push({ gid: l.gid, barcode: l.barcode, reason: "Same barcode used twice in this batch" })
      } else {
        seen.add(l.barcode)
        queue.push(l)
      }
    }

    // Barcode already on a lot ANYWHERE in the app — the same check the wizard
    // makes before saving. Skip those rather than minting a duplicate.
    if (queue.length) {
      const taken = await prisma.catalogueLot.findMany({
        where:  { barcode: { in: queue.map(l => l.barcode) } },
        select: { barcode: true, auction: { select: { code: true } } },
      })
      const takenMap = new Map(taken.map(t => [(t.barcode ?? "").toUpperCase(), t.auction?.code ?? ""]))
      for (let i = queue.length - 1; i >= 0; i--) {
        const code = takenMap.get(queue[i].barcode)
        if (code !== undefined) {
          skipped.push({
            gid:     queue[i].gid,
            barcode: queue[i].barcode,
            reason:  code ? `Already assigned to a lot in ${code.toUpperCase()}` : "Already assigned to a lot",
          })
          queue.splice(i, 1)
        }
      }
    }

    if (!queue.length) {
      return { ok: false, error: "Nothing was created — every lot was skipped.", created: [], skipped }
    }

    const vendor  = details.vendor.trim()             || null
    const tote    = details.tote.trim().toUpperCase() || null
    const receipt = details.receipt.trim().toUpperCase() || null
    const forcedLottingExcluded = await writesOwnDescriptions(session.user.id)

    await prisma.catalogueLot.createMany({
      data: queue.map(l => ({
        auctionId,
        createdByName,
        aiExcluded:      forcedLottingExcluded,
        barcode:         l.barcode,
        title:           (l.title ?? "").slice(0, 83),
        keyPoints:       l.keyPoints ?? "",
        description:     "",                 // filled later by the AI run from real photos
        imageUrls:       [] as string[],
        vendor,
        tote,
        receipt,
        receiptUniqueId: null as string | null,
        estimateLow:     l.estimateLow,
        estimateHigh:    l.estimateHigh,
        aiEstimateLow:   l.estimateLow,
        aiEstimateHigh:  l.estimateHigh,
      })),
    })

    // createMany returns no ids — read them back by barcode so every creation
    // reaches the lot change log.
    const created = await prisma.catalogueLot.findMany({
      where:  { auctionId, barcode: { in: queue.map(l => l.barcode) } },
      select: LOGGABLE_SELECT,
    })
    await logLotsCreated(created as any, auction.code, {
      changedBy: createdByName,
      source:    "lotting_up",
      batchId:   newBatchId(),
    })

    revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)

    return {
      ok:      true,
      created: queue.map(l => ({ gid: l.gid, barcode: l.barcode })),
      skipped,
    }
  } catch (e: any) {
    // Returned, never thrown — a thrown server action is redacted in production,
    // and the BC lock message is exactly what the user needs to read.
    console.error("createLotsFromLottingUp error:", e)
    return { ok: false, error: e?.message ?? "Could not create the lots.", ...empty }
  }
}

function extractLotData(formData: FormData) {
  const str = (key: string) => (formData.get(key) as string)?.trim() || null
  const up  = (key: string) => str(key)?.toUpperCase() || null
  return {
    barcode:     up("barcode"),
    title:       (formData.get("title") as string) || "",
    keyPoints:   (formData.get("keyPoints") as string) || "",
    description: (formData.get("description") as string) || "",
    estimateLow:  formData.get("estimateLow")  ? parseInt(formData.get("estimateLow") as string)  : null,
    estimateHigh: formData.get("estimateHigh") ? parseInt(formData.get("estimateHigh") as string) : null,
    startingBid:  formData.get("startingBid")  ? parseInt(formData.get("startingBid") as string)  : null,
    reserve:      formData.get("reserve")      ? parseInt(formData.get("reserve") as string)      : null,
    hammerPrice:  formData.get("hammerPrice")  ? parseInt(formData.get("hammerPrice") as string)  : null,
    condition:   str("condition"),
    vendor:      str("vendor"),
    tote:            up("tote"),
    receipt:         up("receipt"),
    receiptUniqueId: up("receiptUniqueId"),
    category:        str("category"),
    subCategory: str("subCategory"),
    brand:       str("brand"),
    notes:        str("notes"),
    extraDetails: str("extraDetails"),
    status:       (formData.get("status") as string) || "ENTERED",
    aiExcluded:   formData.get("aiExcluded") === "true",
  }
}
