"use server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { uploadBufferToR2, deleteObjectsFromR2 } from "@/lib/r2"
import {
  logLotCreated, logLotsCreated, logLotDeleted, logLotFieldChanges, logLotPhoto,
  buildLotEventRow, writeLotEvents, type LotLogCtx,
} from "@/lib/lot-log"

// First 83 characters of the description — no sentence splitting, full stops do not break title
function titleFromDescription(desc: string): string {
  const text = (desc ?? "").replace(/[\r\n]+/g, " ").trim()
  if (!text) return "Untitled"
  return text.length > 83 ? text.slice(0, 82) + "…" : text
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
  await prisma.catalogueAuction.update({
    where: { id },
    data: { code, name, auctionDate: auctionDate ? new Date(auctionDate) : null, auctionType: auctionType || "GENERAL", eventName: eventName || null, notes, locked, finished, complete, catalogued, addedToBC, photography, aiRan }
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

  // Assign the receipt unique ID and create the lot atomically. A per-receipt
  // Postgres advisory lock serialises concurrent saves — rapid tablet
  // cataloguing fires these in parallel, and a plain count-then-create let two
  // saves read the same number and collide (the cause of skipped / duplicated
  // unique IDs). MAX(existing suffix)+1 — never COUNT — so a deleted lot or a
  // gap in the sequence never causes a number to be reused or skipped.
  const lot = await prisma.$transaction(async (tx) => {
    let receiptUniqueId: string | null = null
    if (data.receipt) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('vectis_receipt_uid'), hashtext(${data.receipt}))`
      const existing = await tx.catalogueLot.findMany({
        where:  { receiptUniqueId: { startsWith: data.receipt + "-" } },
        select: { receiptUniqueId: true },
      })
      let max = 0
      for (const e of existing) {
        const m = e.receiptUniqueId?.match(/-(\d+)$/)
        if (m) { const n = parseInt(m[1], 10); if (!isNaN(n) && n > max) max = n }
      }
      receiptUniqueId = `${data.receipt}-${max + 1}`
    }
    return tx.catalogueLot.create({
      data: { ...data, auctionId, createdByName, imageUrls, receiptUniqueId },
      include: { auction: { select: { code: true } } },
    })
  })

  await logLotCreated(lot, lot.auction?.code ?? "", { changedBy: createdByName, source: "lot_create" })

  // Log timing if provided
  const durationMs  = parseInt(formData.get("durationMs")  as string ?? "0") || 0
  const keyPointsMs = parseInt(formData.get("keyPointsMs") as string ?? "0") || 0
  if (durationMs > 0) {
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
  }

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
    data: { auctionId, title: "", description: "", tote: toteNumber || null, notes, status: "ENTERED", imageUrls, createdByName },
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
  await logBulkFlag(lotIds, auctionId, "aiExcluded", "AI Excluded", value, ctx)
  const r = await prisma.catalogueLot.updateMany({ where: { id: { in: lotIds }, auctionId }, data: { aiExcluded: value } })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { count: r.count }
}

// Bulk set — used by the mass-select action on Manage Lots.
export async function bulkSetLotsAddedToBC(lotIds: string[], auctionId: string, value: boolean) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  if (lotIds.length === 0) return { count: 0 }
  const ctx = { changedBy: changedByOf(session), source: "bulk", batchId: newBatchId() }
  await logBulkFlag(lotIds, auctionId, "addedToBC", "Added to BC", value, ctx)
  const r = await prisma.catalogueLot.updateMany({ where: { id: { in: lotIds }, auctionId }, data: { addedToBC: value } })
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

// Review tab — raise or clear an error flag on a lot. flag = reason text, null clears it.
export async function setLotReviewFlag(lotId: string, auctionId: string, flag: string | null) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  await updateLotLogged(lotId,
    flag?.trim()
      ? { reviewFlag: flag.trim(), reviewFlaggedBy: changedByOf(session), reviewFlaggedAt: new Date() }
      : { reviewFlag: null, reviewFlaggedBy: null, reviewFlaggedAt: null },
    { changedBy: changedByOf(session), source: "review_tab" },
  )
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

// Pipeline — save the AI's potential-cataloguer-mistake note to the lot.
export async function saveAiFlagNote(lotId: string, flagNote: string | null) {
  const session = await requireCataloguer()
  await updateLotLogged(lotId, { aiFlagNote: flagNote ?? null }, { changedBy: changedByOf(session), source: "ai_flag" })
}

// Review tab — save a manually edited description for a lot.
export async function saveLotDescription(lotId: string, auctionId: string, description: string) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)
  await updateLotLogged(lotId, { description, title: titleFromDescription(description), aiFlagNote: null }, { changedBy: changedByOf(session), source: "review_tab" })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
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

export async function uploadLotPhoto(lotId: string, auctionId: string, formData: FormData) {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)

  const file = formData.get("photo") as File
  if (!file || file.size === 0) throw new Error("No file provided")

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
  return lot.imageUrls
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

  // Seed each receipt base from its highest existing suffix (MAX, not COUNT),
  // then track in-batch additions. Keyed by UPPERCASE base to match the
  // per-row receiptBase below — otherwise the lookup misses and restarts at 0.
  const receiptOffset: Record<string, number> = {}
  for (const base of [...new Set(rows.map(r => r.receipt?.toUpperCase()).filter(Boolean) as string[])]) {
    receiptOffset[base] = await maxReceiptSuffix(base)
  }

  for (const r of rows) {
    const receiptBase = r.receipt ? r.receipt.toUpperCase() : null
    let receiptUniqueId: string | null = null
    if (receiptBase) {
      receiptOffset[receiptBase] = (receiptOffset[receiptBase] ?? 0) + 1
      receiptUniqueId = `${receiptBase}-${receiptOffset[receiptBase]}`
    }

    const lot = await prisma.catalogueLot.create({
      data: {
        auctionId,
        createdByName,
        title:          r.title || "",
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
        receipt:        receiptBase,
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

// Appends "Condition appears [condition]." to every lot that has a condition set
// but whose description doesn't already contain that phrase.
// Returns { updated, skipped } counts.
export async function bulkAddConditionsToDescriptions(
  auctionId: string
): Promise<{ updated: number; skipped: number }> {
  const session = await requireCataloguer()
  await requireNotBCLocked(auctionId, session)

  const lots = await prisma.catalogueLot.findMany({
    where:  { auctionId, condition: { not: null } },
    select: { id: true, condition: true, description: true },
  })

  let updated = 0
  let skipped = 0
  const ctx: LotLogCtx = { changedBy: changedByOf(session), source: "bulk", batchId: newBatchId() }

  for (const lot of lots) {
    const condition = lot.condition?.trim()
    if (!condition) { skipped++; continue }

    const condText = `Condition appears ${condition}.`

    // Skip if the condition text is already present in the description
    if ((lot.description ?? "").includes(condText)) { skipped++; continue }

    const newDesc = lot.description?.trimEnd()
      ? `${lot.description.trimEnd()} ${condText}`
      : condText

    await updateLotLogged(lot.id, { description: newDesc }, ctx)
    updated++
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { updated, skipped }
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
  const receiptStart = receiptBase ? await maxReceiptSuffix(receiptBase) : 0

  const data = Array.from({ length: opts.count }, (_, i) => ({
    auctionId,
    createdByName,
    barcode:         `${prefix}${String(maxBarcode + i + 1).padStart(3, "0")}`,
    title:           "",
    keyPoints:       "",
    description:     "",
    imageUrls:       [] as string[],
    vendor:          opts.vendor      || null,
    tote:            opts.tote        ? opts.tote.toUpperCase() : null,
    receipt:         receiptBase,
    receiptUniqueId: receiptBase ? `${receiptBase}-${receiptStart + i + 1}` : null,
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
