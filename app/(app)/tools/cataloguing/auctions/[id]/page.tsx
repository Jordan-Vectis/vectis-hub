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

  const [auction, currentUser, allAuctions] = await Promise.all([
    prisma.catalogueAuction.findUnique({
      where: { id },
      include: {
        lots: { orderBy: { createdAt: "asc" } },
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
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { showScanTimer: true, timerYellowMins: true, timerRedMins: true },
    }),
    prisma.catalogueAuction.findMany({
      where: { id: { not: id } },
      select: { id: true, code: true, name: true, auctionDate: true },
      orderBy: { auctionDate: "desc" },
    }),
  ])

  if (!auction) notFound()

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
        userId={session.user.id}
        userName={session.user.name ?? session.user.email ?? "Unknown"}
        userRole={session.user.role}
        showScanTimer={currentUser?.showScanTimer ?? true}
        timerYellowMins={currentUser?.timerYellowMins ?? 4}
        timerRedMins={currentUser?.timerRedMins ?? 10}
        allAuctions={allAuctions.map(a => ({ id: a.id, code: a.code, name: a.name, auctionDate: a.auctionDate }))}
        auction={{
          id: auction.id,
          code: auction.code,
          name: auction.name,
          auctionDate: auction.auctionDate,
          auctionType: auction.auctionType,
          eventName: auction.eventName,
          notes: auction.notes,
          locked:      auction.locked,
          finished:    auction.finished,
          complete:    auction.complete,
          published:   auction.published,
          catalogued:  auction.catalogued,
          addedToBC:   auction.addedToBC,
          photography: auction.photography,
          aiRan:       auction.aiRan,
        }}
        lots={auction.lots.map(l => ({
          id: l.id,
          barcode: l.barcode,
          title: l.title,
          keyPoints: l.keyPoints,
          description: l.description,
          estimateLow: l.estimateLow,
          estimateHigh: l.estimateHigh,
          aiEstimateLow: l.aiEstimateLow ?? null,
          aiEstimateHigh: l.aiEstimateHigh ?? null,
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
          aiExcluded: l.aiExcluded,
          createdByName: l.createdByName,
          imageUrls: l.imageUrls,
          extraDetails: l.extraDetails ?? null,
        }))}
      />
      </div>
    </div>
  )
}
