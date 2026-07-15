import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { getCataloguingSidebarItems } from "@/lib/apps"
import { auctionTypeEmoji, auctionTypeLabel } from "@/lib/auction-types"
import PhotographyClient from "./photography-client"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await prisma.catalogueAuction.findUnique({ where: { id }, select: { code: true } })
  return { title: a ? `Photography — ${a.code}` : "Photography" }
}

export default async function PhotographyAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, appPermissions: true },
  })
  const allowed = getCataloguingSidebarItems(dbUser?.role ?? "", dbUser?.appPermissions as any)
  if (!allowed.includes("PHOTOGRAPHY")) redirect("/tools/cataloguing/auctions")

  const { id } = await params

  // Migration-safe: labelPhotoUrl arrives with a deploy but the column only
  // exists once Run Migrations has been clicked, so selecting it would 500 this
  // page in the meantime. Fall back to the same query without it.
  const LOT_SELECT = {
    id: true, barcode: true, receiptUniqueId: true, imageUrls: true,
    title: true, keyPoints: true, description: true,
    condition: true, category: true, vendor: true, tote: true,
  } as const
  const AUCTION_SELECT = {
    id: true, code: true, name: true, auctionType: true, auctionDate: true, addedToBC: true,
  } as const

  type LotRow = {
    id: string; barcode: string | null; receiptUniqueId: string | null; imageUrls: string[]
    title: string; keyPoints: string; description: string
    condition: string | null; category: string | null; vendor: string | null; tote: string | null
    labelPhotoUrl?: string | null
  }
  type AuctionRow = {
    id: string; code: string; name: string
    auctionType: string; auctionDate: Date | null; addedToBC: boolean
    lots: LotRow[]
  }

  let auction: AuctionRow | null = null
  try {
    auction = await prisma.catalogueAuction.findUnique({
      where: { id },
      select: { ...AUCTION_SELECT, lots: { orderBy: { createdAt: "asc" }, select: { ...LOT_SELECT, labelPhotoUrl: true } } },
    }) as any
  } catch {
    auction = await prisma.catalogueAuction.findUnique({
      where: { id },
      select: { ...AUCTION_SELECT, lots: { orderBy: { createdAt: "asc" }, select: LOT_SELECT } },
    }) as any
  }
  if (!auction) notFound()

  const lotsWithPhotos = auction.lots.filter(l => l.imageUrls.length > 0).length

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5">
        <Link href="/tools/cataloguing/photography"
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white inline-block mb-1">
          ← Photography
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            <span className="font-mono text-purple-700 dark:text-purple-400">{auction.code}</span>{" "}
            {auction.name}
          </h1>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {auctionTypeEmoji(auction.auctionType)} {auctionTypeLabel(auction.auctionType)}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {lotsWithPhotos} / {auction.lots.length} lots have photos
          </span>
        </div>
      </div>

      <PhotographyClient
        auctionId={auction.id}
        lots={auction.lots.map(l => ({
          id: l.id,
          barcode: l.barcode,
          receiptUniqueId: l.receiptUniqueId,
          title: l.title,
          keyPoints: l.keyPoints,
          description: l.description,
          condition: l.condition,
          category: l.category,
          vendor: l.vendor,
          tote: l.tote,
          imageUrls: l.imageUrls,
          labelPhotoUrl: l.labelPhotoUrl ?? null,
        }))}
      />
    </div>
  )
}
