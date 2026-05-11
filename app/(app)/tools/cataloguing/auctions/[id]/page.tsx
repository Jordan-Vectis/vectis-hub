import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import AuctionTabs from "./auction-tabs"
import RegisteredBiddersPanel from "./registered-bidders-panel"

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!["ADMIN", "CATALOGUER"].includes(session.user.role)) redirect("/submissions")

  const { id } = await params

  const auction = await prisma.catalogueAuction.findUnique({
    where: { id },
    include: {
      lots: { orderBy: { lotNumber: "asc" } },
      bidderRegistrations: {
        include: {
          customerAccount: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              contactId: true,
            },
          },
        },
        orderBy: { registeredAt: "asc" },
      },
    },
  })

  if (!auction) notFound()

  auction.lots.sort((a, b) => {
    const na = parseInt(a.lotNumber), nb = parseInt(b.lotNumber)
    return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true })
  })

  const registrations = auction.bidderRegistrations.map(r => ({
    id: r.id,
    contactId: r.contactId,
    registeredAt: r.registeredAt.toISOString(),
    customer: {
      id: r.customerAccount.id,
      firstName: r.customerAccount.firstName,
      lastName: r.customerAccount.lastName,
      email: r.customerAccount.email,
      phone: r.customerAccount.phone,
    },
  }))

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Registered Bidders banner */}
      <RegisteredBiddersPanel
        auctionId={auction.id}
        auctionName={auction.name}
        registrations={registrations}
      />

      <div className="flex-1 min-h-0">
      <AuctionTabs
        auction={{
          id: auction.id,
          code: auction.code,
          name: auction.name,
          auctionDate: auction.auctionDate,
          auctionType: auction.auctionType,
          eventName: auction.eventName,
          notes: auction.notes,
          locked: auction.locked,
          finished: auction.finished,
          complete: auction.complete,
          published: auction.published,
        }}
        lots={auction.lots.map(l => ({
          id: l.id,
          lotNumber: l.lotNumber,
          barcode: l.barcode,
          title: l.title,
          keyPoints: l.keyPoints,
          description: l.description,
          estimateLow: l.estimateLow,
          estimateHigh: l.estimateHigh,
          startingBid: l.startingBid,
          reserve: l.reserve,
          hammerPrice: l.hammerPrice,
          condition: l.condition,
          vendor: l.vendor,
          tote: l.tote,
          receipt: l.receipt,
          receiptUniqueId: l.receiptUniqueId,
          category: l.category,
          subCategory: l.subCategory,
          brand: l.brand,
          notes: l.notes,
          status: l.status,
          aiUpgraded: l.aiUpgraded,
          addedToBC: l.addedToBC,
          createdByName: l.createdByName,
          imageUrls: l.imageUrls,
          extraDetails: l.extraDetails ?? null,
        }))}
      />
      </div>
    </div>
  )
}
