"use server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { uploadBufferToR2 } from "@/lib/r2"

async function requireCataloguer() {
  const session = await auth()
  if (!session || !["ADMIN","CATALOGUER"].includes(session.user.role)) throw new Error("Access denied")
  return session
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
  const locked      = formData.get("locked")      === "true"
  const finished    = formData.get("finished")    === "true"
  const complete    = formData.get("complete")    === "true"
  const catalogued  = formData.get("catalogued")  === "true"
  const addedToBC   = formData.get("addedToBC")   === "true"
  const photography = formData.get("photography") === "true"
  const aiRan       = formData.get("aiRan")       === "true"
  await prisma.catalogueAuction.update({
    where: { id },
    data: { code, name, auctionDate: auctionDate ? new Date(auctionDate) : null, auctionType: auctionType || "GENERAL", eventName: eventName || null, locked, finished, complete, catalogued, addedToBC, photography, aiRan }
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
  await requireCataloguer()
  const lots = await prisma.catalogueLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, description: true } })
  await Promise.all(lots.map(l => {
    const firstLine = (l.description ?? "").split(/\.\s|\n/)[0].trim()
    const title = firstLine.slice(0, 83).trimEnd()
    if (!title) return Promise.resolve()
    return prisma.catalogueLot.update({ where: { id: l.id }, data: { title } })
  }))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}


export async function setStartingBids(auctionId: string, updates: { id: string; startingBid: number }[]) {
  await requireCataloguer()
  await Promise.all(updates.map(u =>
    prisma.catalogueLot.update({ where: { id: u.id }, data: { startingBid: u.startingBid } })
  ))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function applyAiDescriptions(
  auctionId: string,
  updates: { id: string; description: string; estimateLow: number | null; estimateHigh: number | null }[]
) {
  await requireCataloguer()
  await Promise.all(
    updates.map(u =>
      prisma.catalogueLot.update({
        where: { id: u.id },
        data: {
          description: u.description,
          // Only overwrite estimate if AI returned a value — never clear an existing estimate
          ...(u.estimateLow  !== null ? { estimateLow:  u.estimateLow  } : {}),
          ...(u.estimateHigh !== null ? { estimateHigh: u.estimateHigh } : {}),
          aiUpgraded: true,
        },
      })
    )
  )
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function applyAiDescriptionOne(
  auctionId: string,
  update: { id: string; description: string; estimateLow: number | null; estimateHigh: number | null }
) {
  await requireCataloguer()
  await prisma.catalogueLot.update({
    where: { id: update.id },
    data: {
      description: update.description,
      // Only overwrite estimate if AI returned a value — never clear an existing estimate
      ...(update.estimateLow  !== null ? { estimateLow:  update.estimateLow  } : {}),
      ...(update.estimateHigh !== null ? { estimateHigh: update.estimateHigh } : {}),
      aiUpgraded: true,
    },
  })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function togglePublished(id: string, published: boolean) {
  await requireCataloguer()
  await prisma.catalogueAuction.update({ where: { id }, data: { published } })
  revalidatePath("/tools/cataloguing/auctions")
  revalidatePath(`/tools/cataloguing/auctions/${id}`)
  revalidatePath("/auctions")
}

export async function createLot(auctionId: string, formData: FormData) {
  const session = await requireCataloguer()
  const data = extractLotData(formData)
  const createdByName = session.user.name ?? session.user.email ?? "Unknown"

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

  const receiptUniqueId = data.receipt ? await sequencedReceiptUid(data.receipt) : null
  const lot = await prisma.catalogueLot.create({ data: { ...data, auctionId, createdByName, imageUrls, receiptUniqueId } })

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
  })

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
  await requireCataloguer()
  const data = extractLotData(formData)
  await prisma.catalogueLot.update({ where: { id: lotId }, data })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function deleteLot(lotId: string, auctionId: string) {
  await requireCataloguer()
  await prisma.catalogueLot.delete({ where: { id: lotId } })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function toggleLotAiUpgraded(lotId: string, auctionId: string, value: boolean) {
  await requireCataloguer()
  await prisma.catalogueLot.update({ where: { id: lotId }, data: { aiUpgraded: value } })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

// Manual cataloguer tick — set after a lot has gone over to Business Central.
export async function toggleLotAddedToBC(lotId: string, auctionId: string, value: boolean) {
  await requireCataloguer()
  await prisma.catalogueLot.update({ where: { id: lotId }, data: { addedToBC: value } })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

// Bulk set — used by the mass-select action on Manage Lots.
export async function bulkSetLotsAddedToBC(lotIds: string[], auctionId: string, value: boolean) {
  await requireCataloguer()
  if (lotIds.length === 0) return { count: 0 }
  const r = await prisma.catalogueLot.updateMany({
    where: { id: { in: lotIds }, auctionId },
    data:  { addedToBC: value },
  })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { count: r.count }
}

export async function saveLotExtraDetails(lotId: string, auctionId: string, extraDetails: string) {
  await requireCataloguer()
  await prisma.catalogueLot.update({ where: { id: lotId }, data: { extraDetails } })
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
  await requireCataloguer()

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
      receiptOffset[targetReceipt] = await prisma.catalogueLot.count({
        where: { receiptUniqueId: { startsWith: targetReceipt + "-" } },
      })
    }
  }

  let updated = 0
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
      await prisma.catalogueLot.update({
        where: { id: lot.id },
        data: {
          vendor:          desiredVendor,
          receipt:         desiredReceipt,
          receiptUniqueId: desiredUniqueId,
        },
      })
      updated++
    }
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { updated }
}

export async function uploadLotPhoto(lotId: string, auctionId: string, formData: FormData) {
  await requireCataloguer()

  const file = formData.get("photo") as File
  if (!file || file.size === 0) throw new Error("No file provided")

  const ext = file.name.split(".").pop() || "jpg"
  const buf = Buffer.from(await file.arrayBuffer())
  const key = await uploadBufferToR2(
    buf,
    `lot-photos/${auctionId}/${lotId}/${Date.now()}.${ext}`,
    file.type || "image/jpeg"
  )

  const lot = await prisma.catalogueLot.update({
    where: { id: lotId },
    data: { imageUrls: { push: key } },
    select: { imageUrls: true },
  })

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return lot.imageUrls
}

export async function deleteLotPhoto(lotId: string, auctionId: string, key: string) {
  await requireCataloguer()

  const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: { imageUrls: true } })
  if (!lot) throw new Error("Lot not found")

  const updated = lot.imageUrls.filter(k => k !== key)
  await prisma.catalogueLot.update({ where: { id: lotId }, data: { imageUrls: updated } })

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return updated
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

  // Pre-count existing sequenced lots per receipt base, then track in-batch additions
  const receiptOffset: Record<string, number> = {}
  for (const base of [...new Set(rows.map(r => r.receipt).filter(Boolean))]) {
    receiptOffset[base] = await prisma.catalogueLot.count({ where: { receiptUniqueId: { startsWith: base + "-" } } })
  }

  for (const r of rows) {
    const receiptBase = r.receipt ? r.receipt.toUpperCase() : null
    let receiptUniqueId: string | null = null
    if (receiptBase) {
      receiptOffset[receiptBase] = (receiptOffset[receiptBase] ?? 0) + 1
      receiptUniqueId = `${receiptBase}-${receiptOffset[receiptBase]}`
    }

    await prisma.catalogueLot.create({
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
  await requireCataloguer()

  // Fetch all lots in this auction that have a barcode
  const lots = await prisma.catalogueLot.findMany({
    where:  { auctionId, barcode: { not: null } },
    select: { id: true, barcode: true },
  })

  // Build barcode → lotId map (case-insensitive)
  const barcodeMap = new Map(lots.map(l => [l.barcode!.toLowerCase().trim(), l.id]))

  let updated = 0
  let skipped = 0

  for (const { barcode, uniqueId } of pairs) {
    const lotId = barcodeMap.get(barcode.toLowerCase().trim())
    if (!lotId || !uniqueId.trim()) { skipped++; continue }
    await prisma.catalogueLot.update({
      where: { id: lotId },
      data:  { receiptUniqueId: uniqueId.trim() },
    })
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
  await requireCataloguer()

  const lots = await prisma.catalogueLot.findMany({
    where:  { auctionId, condition: { not: null } },
    select: { id: true, condition: true, description: true },
  })

  let updated = 0
  let skipped = 0

  for (const lot of lots) {
    const condition = lot.condition?.trim()
    if (!condition) { skipped++; continue }

    const condText = `Condition appears ${condition}.`

    // Skip if the condition text is already present in the description
    if ((lot.description ?? "").includes(condText)) { skipped++; continue }

    const newDesc = lot.description?.trimEnd()
      ? `${lot.description.trimEnd()} ${condText}`
      : condText

    await prisma.catalogueLot.update({
      where: { id: lot.id },
      data:  { description: newDesc },
    })
    updated++
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { updated, skipped }
}

// Returns the next receiptUniqueId for a base receipt, e.g. "R000123" → "R000123-4"
// Counts existing lots whose receiptUniqueId starts with "{base}-"
async function sequencedReceiptUid(base: string, extra = 0): Promise<string> {
  const count = await prisma.catalogueLot.count({
    where: { receiptUniqueId: { startsWith: base + "-" } },
  })
  return `${base}-${count + extra + 1}`
}

export async function transferLots(lotIds: string[], sourceAuctionId: string, targetAuctionId: string) {
  await requireCataloguer()
  await prisma.catalogueLot.updateMany({
    where: { id: { in: lotIds }, auctionId: sourceAuctionId },
    data: { auctionId: targetAuctionId },
  })
  revalidatePath(`/tools/cataloguing/auctions/${sourceAuctionId}`)
  revalidatePath(`/tools/cataloguing/auctions/${targetAuctionId}`)
  return lotIds.length
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
  const receiptStart = receiptBase
    ? await prisma.catalogueLot.count({ where: { receiptUniqueId: { startsWith: receiptBase + "-" } } })
    : 0

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
  }
}
