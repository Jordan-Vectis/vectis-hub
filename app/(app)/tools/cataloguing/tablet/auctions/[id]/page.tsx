import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import TabletTabs from "./tablet-tabs"

export default async function TabletAuctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  // Access is enforced by the cataloguing layout (hasAppAccess "CATALOGUING") — no hard-coded role gate here (it was bouncing managers/other granted roles to /submissions).

  const { id } = await params

  const [auction, currentUser] = await Promise.all([
    prisma.catalogueAuction.findUnique({
      where: { id },
      include: {
        lots: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { showScanTimer: true, showLotTimer: true, timerRedMins: true },
    }),
  ])

  if (!auction) notFound()

  return (
    <TabletTabs
      showScanTimer={currentUser?.showScanTimer ?? true}
      showLotTimer={currentUser?.showLotTimer ?? false}
      timerRedMins={currentUser?.timerRedMins ?? 30}
      userRole={session.user.role}
      userId={session.user.id}
      userName={session.user.name ?? session.user.email ?? ""}
      auction={{
        id: auction.id,
        code: auction.code,
        name: auction.name,
        addedToBC: auction.addedToBC,
      }}
      lots={auction.lots.map(l => ({
        id: l.id,
        barcode: l.barcode,
        title: l.title,
        keyPoints: l.keyPoints,
        description: l.description,
        estimateLow: l.estimateLow,
        estimateHigh: l.estimateHigh,
        condition: l.condition,
        vendor: l.vendor,
        tote: l.tote,
        receipt: l.receipt,
        category: l.category,
        subCategory: l.subCategory,
        brand: l.brand,
        notes: l.notes,
        status:        l.status,
        imageUrls:     l.imageUrls,
        createdAt:     l.createdAt.toISOString(),
        createdByName: l.createdByName ?? null,
      }))}
    />
  )
}
