import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { lotPhotoUrl } from "@/lib/photo-url"
import { getCustomerSession } from "@/lib/customer-auth"
import LiveBiddingRoom from "./live-bidding-room"

export const dynamic = "force-dynamic"

export default async function LiveAuctionPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params

  const auction = await prisma.catalogueAuction.findFirst({
    where: { code: code.toUpperCase(), published: true },
    include: {
      lots: { orderBy: { createdAt: "asc" } },
      liveAuction: true,
    },
  })

  if (!auction) notFound()

  // Customer session + registration check
  const session = await getCustomerSession()
  const isLoggedIn = !!session

  let isRegistered = false
  if (session) {
    const reg = await prisma.bidderRegistration.findUnique({
      where: {
        auctionId_customerAccountId: {
          auctionId: auction.id,
          customerAccountId: session.id,
        },
      },
    })
    isRegistered = !!reg
  }

  const lots = auction.lots.map(l => ({
    id: l.id,
    barcode: l.barcode ?? "",
    title: l.title,
    description: l.description,
    imageUrls: l.imageUrls.map(k => lotPhotoUrl(k, true) ?? k),
    estimateLow: l.estimateLow,
    estimateHigh: l.estimateHigh,
    hammerPrice: l.hammerPrice,
    status: l.status,
  }))

  return (
    <LiveBiddingRoom
      auctionId={auction.id}
      auctionName={auction.name}
      auctionCode={auction.code}
      auctionDate={auction.auctionDate?.toISOString() ?? null}
      initialLotIndex={auction.liveAuction?.currentLotIndex ?? 0}
      isLive={!!auction.liveAuction && auction.liveAuction.status === "ACTIVE"}
      lots={lots}
      isLoggedIn={isLoggedIn}
      isRegistered={isRegistered}
      customerId={session?.id ?? null}
      customerName={session ? `${session.firstName ?? ""} ${session.lastName ?? ""}`.trim() || null : null}
    />
  )
}
