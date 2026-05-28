import { prisma } from "@/lib/prisma"
import DatabasesClient from "./databases-client"

export default async function DatabasesPage() {
  const [contacts, receipts, containers, lots, auctions, locations, commissionBids] = await Promise.all([
    prisma.contact.findMany({
      orderBy: { name: "asc" },
      take: 3000,
    }),
    prisma.warehouseReceipt.findMany({
      include: { contact: true, containers: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
    prisma.warehouseContainer.findMany({
      include: {
        receipt: { include: { contact: true } },
        movements: { orderBy: { movedAt: "desc" }, take: 1, select: { locationCode: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
    prisma.catalogueLot.findMany({
      include: { auction: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.catalogueAuction.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.warehouseLocation.findMany({
      orderBy: { code: "asc" },
      select: { code: true },
    }),
    prisma.commissionBid.findMany({
      orderBy: { placedAt: "desc" },
      take: 5000,
      include: {
        customerAccount: {
          select: { id: true, firstName: true, lastName: true, email: true, contactId: true },
        },
        lot: {
          select: {
            id: true,
            barcode: true,
            receiptUniqueId: true,
            title: true,
            estimateLow: true,
            estimateHigh: true,
            hammerPrice: true,
            status: true,
            auction: { select: { id: true, code: true, name: true } },
          },
        },
      },
    }),
  ])

  return (
    <DatabasesClient
      contacts={contacts.map(c => ({
        id: c.id, name: c.name, email: c.email ?? null,
        phone: c.phone ?? null, notes: c.notes ?? null,
        isBuyer: c.isBuyer, isSeller: c.isSeller,
      }))}
      receipts={receipts.map(r => ({
        id: r.id, contactId: r.contactId, contactName: r.contact.name,
        commissionRate: r.commissionRate, notes: r.notes ?? null,
        status: r.status, containerCount: r.containers.length,
      }))}
      containers={containers.map(c => ({
        id: c.id, type: c.type, description: c.description,
        category: c.category ?? null, subcategory: c.subcategory ?? null,
        receiptId: c.receiptId, contactId: c.receipt.contactId,
        contactName: c.receipt.contact.name,
        lastLocation: c.movements[0]?.locationCode ?? null,
      }))}
      lots={lots.map(l => ({
        id: l.id, barcode: l.barcode ?? null, receiptUniqueId: l.receiptUniqueId ?? null, title: l.title,
        description: l.description ?? "",
        auctionId: l.auctionId, auctionCode: l.auction.code, auctionName: l.auction.name,
        vendor: l.vendor ?? null, receipt: l.receipt ?? null,
        tote: l.tote ?? null, category: l.category ?? null,
        subCategory: l.subCategory ?? null, status: l.status,
        condition: l.condition ?? null, notes: l.notes ?? null,
        brand: l.brand ?? null,
        estimateLow: l.estimateLow ?? null, estimateHigh: l.estimateHigh ?? null,
        reserve: l.reserve ?? null, hammerPrice: l.hammerPrice ?? null,
        imageCount: l.imageUrls.length,
      }))}
      auctions={auctions}
      locations={locations.map(l => l.code)}
      commissionBids={commissionBids.map(b => ({
        id: b.id,
        lotId: b.lot.id,
        lotBarcode: b.lot.barcode ?? b.lot.receiptUniqueId ?? null,
        lotTitle: b.lot.title,
        estimateLow: b.lot.estimateLow ?? null,
        estimateHigh: b.lot.estimateHigh ?? null,
        hammerPrice: b.lot.hammerPrice ?? null,
        lotStatus: b.lot.status,
        auctionId: b.lot.auction.id,
        auctionCode: b.lot.auction.code,
        auctionName: b.lot.auction.name,
        customerAccountId: b.customerAccount.id,
        customerEmail: b.customerAccount.email,
        customerName: `${b.customerAccount.firstName} ${b.customerAccount.lastName}`,
        contactId: b.customerAccount.contactId ?? null,
        maxBid: b.maxBid,
        placedAt: b.placedAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      }))}
    />
  )
}
