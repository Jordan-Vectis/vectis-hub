// Photos taken before the lot existed — held, then attached the moment it does.
//
// ⚠ WHY THIS EXISTS. Photography → Upload photos (any sale) matches a label's code against
// every OPEN sale. A code that matches nothing is not a mistake to throw away: photography
// legitimately runs ahead of the record. The clearest case is the one Jordan named — photos
// taken on lots that have gone out through End of Day, where the file is named with BC's own
// unique ID while the Hub lot's receiptUniqueId is still NULL, because nothing writes that
// until 🔗 BC Match runs. Discarding those photos would lose real work with no warning.
//
// So the photo is stored in R2 straight away and a HeldLotPhoto row remembers its code. Every
// sweep re-checks the codes against the catalogue and attaches whatever now matches.
//
// ⚠ Matching is on BARCODE **or** receiptUniqueId, case-insensitively — the same two-way rule
// the filename matcher in the sale's own uploader uses (RULES.md, Photo Upload / Filename
// Matching). A lot can legitimately have only one of the two.

import { prisma } from "@/lib/prisma"
import { logLotPhoto } from "@/lib/lot-log"

export type AttachResult = { attached: number; lots: number; stillWaiting: number }

/**
 * Attach every held photo whose code now matches a lot. Safe to call at any time and as
 * often as you like — a photo is only ever attached once (attachedAt is set in the same
 * step) and an already-attached row is never revisited.
 *
 * @param codes limit the sweep to these codes (e.g. the ones BC Match just wrote); omit to
 *              sweep everything still waiting.
 */
export async function attachHeldPhotos(codes?: string[]): Promise<AttachResult> {
  const wanted = codes?.map(c => c.trim().toUpperCase()).filter(Boolean)
  if (wanted && wanted.length === 0) return { attached: 0, lots: 0, stillWaiting: 0 }

  let held: { id: string; code: string; fileName: string; r2Key: string }[] = []
  try {
    held = await prisma.heldLotPhoto.findMany({
      where: { attachedAt: null, ...(wanted ? { code: { in: wanted } } : {}) },
      select: { id: true, code: true, fileName: true, r2Key: true },
      orderBy: { createdAt: "asc" },
      take: 2000,
    })
  } catch {
    // Table not created yet (code deploys before the migrations are run) — nothing to do.
    return { attached: 0, lots: 0, stillWaiting: 0 }
  }
  if (held.length === 0) return { attached: 0, lots: 0, stillWaiting: 0 }

  // One lookup for every distinct code, matching BOTH identifier fields.
  //
  // ⚠ Raw SQL on purpose. Prisma's `mode: "insensitive"` works on equals/contains/startsWith
  // but NOT on `in`, so the obvious `{ barcode: { in: codes, mode: "insensitive" } }` is a
  // runtime validation error, not a compile one. Held codes are stored upper-cased; upper()
  // on the column is what makes the comparison genuinely case-insensitive both ways.
  const distinct = [...new Set(held.map(h => h.code))]
  const matchedIds = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "CatalogueLot"
     WHERE upper(btrim("barcode"))         = ANY(${distinct}::text[])
        OR upper(btrim("receiptUniqueId")) = ANY(${distinct}::text[])
  `
  const lots = matchedIds.length === 0 ? [] : await prisma.catalogueLot.findMany({
    where: { id: { in: matchedIds.map(r => r.id) } },
    select: {
      id: true, auctionId: true, barcode: true, receiptUniqueId: true, title: true, imageUrls: true,
      auction: { select: { code: true } },
    },
  })

  // ⚠ A code that matches TWO lots is left waiting rather than guessed at. Historic duplicate
  // barcodes exist, and attaching a photo to the wrong lot is worse than not attaching it —
  // the waiting list shows it so a person can sort it out.
  const byCode = new Map<string, typeof lots>()
  for (const lot of lots) {
    for (const id of [lot.barcode, lot.receiptUniqueId]) {
      if (!id) continue
      const key = id.trim().toUpperCase()
      if (!distinct.includes(key)) continue
      const list = byCode.get(key) ?? []
      if (!list.some(l => l.id === lot.id)) list.push(lot)
      byCode.set(key, list)
    }
  }

  let attached = 0
  const touched = new Set<string>()

  for (const photo of held) {
    const matches = byCode.get(photo.code) ?? []
    if (matches.length !== 1) continue
    const lot = matches[0]
    // Don't add the same stored file twice if a sweep overlaps another.
    if (lot.imageUrls.includes(photo.r2Key)) {
      await prisma.heldLotPhoto.update({
        where: { id: photo.id },
        data: { attachedAt: new Date(), attachedLotId: lot.id },
      })
      continue
    }
    try {
      const updated = await prisma.catalogueLot.update({
        where: { id: lot.id },
        data: { imageUrls: { push: photo.r2Key } },
        select: { imageUrls: true },
      })
      lot.imageUrls = updated.imageUrls
      await prisma.heldLotPhoto.update({
        where: { id: photo.id },
        data: { attachedAt: new Date(), attachedLotId: lot.id },
      })
      await logLotPhoto(
        { id: lot.id, auctionId: lot.auctionId, barcode: lot.barcode, title: lot.title },
        lot.auction?.code ?? "", "photo_added",
        { changedBy: "Photo held for this lot", source: "photo_any_sale" },
        photo.fileName,
      )
      attached++
      touched.add(lot.id)
    } catch {
      // Leave it waiting — the next sweep tries again. Never mark a photo attached
      // unless the lot actually took it.
    }
  }

  const stillWaiting = await prisma.heldLotPhoto.count({ where: { attachedAt: null } })
  return { attached, lots: touched.size, stillWaiting }
}

/** What is still waiting, newest first, for the "photos waiting for a lot" list. */
export async function listHeldPhotos(limit = 200) {
  try {
    return await prisma.heldLotPhoto.findMany({
      where: { attachedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, code: true, fileName: true, r2Key: true, uploadedBy: true, createdAt: true },
    })
  } catch {
    return []   // table not created yet
  }
}
