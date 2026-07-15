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
  const auction = await prisma.catalogueAuction.findUnique({
    where: { id },
    select: {
      id: true, code: true, name: true, auctionType: true, auctionDate: true, addedToBC: true,
      lots: {
        orderBy: { createdAt: "asc" },
        select: { id: true, barcode: true, receiptUniqueId: true, imageUrls: true },
      },
    },
  })
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
        lots={auction.lots.map(l => ({ id: l.id, barcode: l.barcode, receiptUniqueId: l.receiptUniqueId }))}
      />
    </div>
  )
}
