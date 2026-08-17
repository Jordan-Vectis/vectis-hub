import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import AuctionTabs from "./auction-tabs"
import RegisteredBiddersPanel from "./registered-bidders-panel"
import { getDepartmentAccess, auctionWhere, canSeeAuction } from "@/lib/departments"
import { logAccessDenied } from "@/lib/access-log"

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  // Access is enforced by the cataloguing layout (hasAppAccess "CATALOGUING") — no hard-coded role gate here (it was bouncing managers/other granted roles to /submissions).

  const { id } = await params

  // Resolved up front so the transfer-lots target list can be filtered by it too.
  const viewer = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, email: true, allowedApps: true, showScanTimer: true, showLotTimer: true, timerRedMins: true },
  })
  const access = await getDepartmentAccess(session.user.id, viewer?.role ?? "")

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
    Promise.resolve(viewer),
    // Transfer-lots targets follow the same department rule as the sale lists.
    prisma.catalogueAuction.findMany({
      where: { ...auctionWhere(access), id: { not: id } },
      select: { id: true, code: true, name: true, auctionDate: true },
      orderBy: { auctionDate: "desc" },
    }),
  ])

  if (!auction) notFound()

  // Hiding a sale from the list is not a restriction on its own — someone with
  // the link would still open it. Check the department here too.
  if (!canSeeAuction(access, auction)) {
    await logAccessDenied({
      appKey:  "CATALOGUING",
      source:  "auction_department",
      note:    `Sale ${auction.code} (${auction.auctionType}) is outside this user's departments`,
      session: {
        id:    session.user.id,
        email: session.user.email,
        name:  session.user.name,
        role:  session.user.role,
      },
      dbUser: currentUser
        ? { id: session.user.id, email: currentUser.email, role: currentUser.role, allowedApps: currentUser.allowedApps }
        : null,
    })
    redirect("/tools/cataloguing/auctions")
  }

  // The one-off "extra people on this sale" list, and who can be added to it.
  // Admins only — everyone else gets empty arrays and no panel.
  const isAdmin = (viewer?.role ?? "") === "ADMIN"
  let extraAccess: { userId: string; name: string; grantedBy: string | null }[] = []
  let assignableUsers: { id: string; name: string }[] = []
  if (isAdmin) {
    try {
      const [grants, staff] = await Promise.all([
        prisma.catalogueAuctionAccess.findMany({
          where:   { auctionId: id },
          select:  { userId: true, grantedBy: true, user: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        }),
        prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ])
      extraAccess     = grants.map(g => ({ userId: g.userId, name: g.user.name, grantedBy: g.grantedBy }))
      assignableUsers = staff
    } catch {
      // Table arrives with Run Migrations — until then the panel just shows empty.
    }
  }

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
        showLotTimer={currentUser?.showLotTimer ?? false}
        manualDescriptions={(currentUser as any)?.manualDescriptions ?? false}
        timerRedMins={currentUser?.timerRedMins ?? 30}
        allAuctions={allAuctions.map(a => ({ id: a.id, code: a.code, name: a.name, auctionDate: a.auctionDate }))}
        extraAccess={extraAccess}
        assignableUsers={assignableUsers}
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
          reviewKpMode: auction.reviewKpMode ?? "strict",
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
          createdAt: l.createdAt.toISOString(),
          imageUrls: l.imageUrls,
          extraDetails: l.extraDetails ?? null,
        }))}
      />
      </div>
    </div>
  )
}
