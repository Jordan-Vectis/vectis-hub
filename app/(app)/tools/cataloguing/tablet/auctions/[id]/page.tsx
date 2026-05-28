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
  if (!["ADMIN", "CATALOGUER"].includes(session.user.role)) redirect("/submissions")

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
      select: { showScanTimer: true, timerYellowMins: true, timerRedMins: true },
    }),
  ])

  if (!auction) notFound()

  return (
    <TabletTabs
      showScanTimer={currentUser?.showScanTimer ?? true}
      timerYellowMins={currentUser?.timerYellowMins ?? 4}
      timerRedMins={currentUser?.timerRedMins ?? 10}
      auction={{
        id: auction.id,
        code: auction.code,
        name: auction.name,
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
        status:    l.status,
        imageUrls: l.imageUrls,
        createdAt: l.createdAt.toISOString(),
      }))}
    />
  )
}
