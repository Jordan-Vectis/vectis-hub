import { prisma } from "@/lib/prisma"
import { normaliseCode, type ContainerKind, type LocationKind } from "@/lib/goods-in/model"
import { compareCodes } from "@/lib/goods-in/location-codes"
import type { ScanHit } from "@/lib/actions/goods-in"
import type { GoodsHere } from "@/lib/actions/goods-in-locations"

// What a Goods In code is, and what is at some locations — the reads behind Code lookup
// (lookupCode in lib/actions/goods-in.ts), "Export what's there" (goodsAtLocations in
// lib/actions/goods-in-locations.ts) and the handheld scanner's Find / Check a location
// (app/api/goods-in/scan/lookup). SERVER ONLY, a plain module, and it checks NOBODY: the caller
// has already decided who may read (the actions with requireGoodsIn, the scanner with scanGate —
// which also accepts a scanner sign-in card, so the scanner can't go through the actions).
//
// ⚠ Keep these exactly the bodies of lookupCode and goodsAtLocations (after their access check and
// code cleaning), so Find on the scanner answers as Code lookup does. Those two actions should call
// these rather than keep their own copies — change the rules HERE.

/** What a scanned or typed code is — a tote/pallet, a lot barcode, a receipt, a location or a vendor number. */
export async function findCode(raw: string): Promise<ScanHit | null> {
  const code = normaliseCode(raw)
  if (!code) return null
  const [container, receipt, location, customer, lot] = await Promise.all([
    prisma.goodsInContainer.findUnique({ where: { id: code }, include: { receipt: { select: { contact: { select: { name: true } } } } } }),
    prisma.goodsInReceipt.findUnique({ where: { id: code }, include: { contact: { select: { name: true } }, _count: { select: { containers: true } } } }),
    prisma.goodsInLocation.findUnique({ where: { code } }),
    prisma.goodsInCustomer.findUnique({ where: { vendorNo: code }, include: { contact: { select: { name: true } } } }),
    // A barcode can be on more than one lot (a re-entered item): the newest is the one in hand, as Find lists it first.
    prisma.catalogueLot.findFirst({ where: { barcode: { equals: code, mode: "insensitive" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, barcode: true, title: true, tote: true, receipt: true, auction: { select: { code: true } } } }),
  ])
  if (container) return { type: "container", id: container.id, kind: container.kind as ContainerKind, receiptId: container.receiptId, customer: container.receipt.contact.name, category: container.category, description: container.description, status: container.status, locationCode: container.locationCode }
  if (lot) {
    const last = await prisma.goodsInMovement.findFirst({ where: { lotId: lot.id }, orderBy: { movedAt: "desc" }, select: { locationCode: true } })
    return { type: "lot", lotId: lot.id, barcode: lot.barcode ?? code, title: lot.title, auction: lot.auction?.code ?? null, tote: lot.tote, receipt: lot.receipt, locationCode: last?.locationCode ?? null }
  }
  if (receipt) return { type: "receipt", id: receipt.id, customer: receipt.contact.name, containers: receipt._count.containers, createdAt: receipt.createdAt }
  if (location) return { type: "location", code: location.code, name: location.name, kind: (location.kind as LocationKind) ?? "storage" }
  if (customer) return { type: "customer", id: customer.contactId, name: customer.contact.name, vendorNo: customer.vendorNo }
  return null
}

export const MAX_EXPORT_ROWS = 20_000

/**
 * Everything at these (already cleaned) location codes now — every tote and pallet there that
 * hasn't gone back to the customer, and every lot whose latest move is there. At most 20,000 of
 * each; `truncated` says when there were more.
 */
export async function goodsHere(codes: string[]): Promise<{ rows: GoodsHere[]; truncated: boolean }> {
  const [containers, lots] = await Promise.all([
    prisma.goodsInContainer.findMany({
      where: { locationCode: { in: codes }, OR: [{ status: null }, { status: { not: "returned" } }] },
      select: { id: true, kind: true, status: true, category: true, description: true, movedAt: true, locationCode: true, receiptId: true, receipt: { select: { contact: { select: { name: true } } } } },
      orderBy: [{ locationCode: "asc" }, { id: "asc" }],
      take: MAX_EXPORT_ROWS + 1,
    }),
    prisma.$queryRaw<{ location: string; lotId: string; barcode: string | null; movedAt: Date | null; movedByName: string | null; title: string | null; status: string | null; sale: string | null }[]>`
      SELECT cur."locationCode" AS "location", cur."lotId", COALESCE(l."barcode", cur."barcode") AS "barcode", cur."movedAt", cur."movedByName",
             l."title", l."status", a."code" AS "sale"
      FROM (
        SELECT DISTINCT ON (m."lotId") m."lotId", m."barcode", m."locationCode", m."movedAt", m."movedByName"
        FROM "GoodsInMovement" m
        WHERE m."lotId" IN (
          SELECT "lotId" FROM "GoodsInMovement" WHERE "lotId" IS NOT NULL AND "locationCode" = ANY(${codes}::text[])
        )
        ORDER BY m."lotId", m."movedAt" DESC
      ) cur
      LEFT JOIN "CatalogueLot" l ON l."id" = cur."lotId"
      LEFT JOIN "CatalogueAuction" a ON a."id" = l."auctionId"
      WHERE cur."locationCode" = ANY(${codes}::text[])
      ORDER BY cur."locationCode", cur."movedAt" DESC
      LIMIT ${MAX_EXPORT_ROWS + 1}`,
  ])
  const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)
  const rows: GoodsHere[] = [
    ...containers.slice(0, MAX_EXPORT_ROWS).map(c => ({
      location: c.locationCode ?? "",
      type: (c.kind === "pallet" ? "pallet" : "tote") as GoodsHere["type"],
      code: c.id,
      status: c.status,
      receipt: c.receiptId,
      customer: c.receipt.contact.name,
      what: [c.category, c.description].filter(Boolean).join(" — ") || null,
      sale: null,
      since: iso(c.movedAt),
      by: null,
    })),
    ...lots.slice(0, MAX_EXPORT_ROWS).map(l => ({
      location: l.location,
      type: "lot" as const,
      code: l.barcode ?? "",
      status: l.status,
      receipt: null,
      customer: null,
      what: l.title ?? "This lot is no longer in the Hub",
      sale: l.sale,
      since: iso(l.movedAt),
      by: l.movedByName,
    })),
  ].sort((a, b) => compareCodes(a.location, b.location))
  return { rows, truncated: containers.length > MAX_EXPORT_ROWS || lots.length > MAX_EXPORT_ROWS }
}
