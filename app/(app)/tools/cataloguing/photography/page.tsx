import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getCataloguingSidebarItems } from "@/lib/apps"
import PhotographyAuctionList, { type PhotographyAuctionRow } from "./auction-list"

export const dynamic = "force-dynamic"
export const metadata = { title: "Photography" }

// Photography → pick an auction → upload that sale's photos.
// Access is enforced by the cataloguing layout (hasAppAccess "CATALOGUING");
// this only checks the PHOTOGRAPHY sidebar section is allowed for this user.
export default async function PhotographyPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, appPermissions: true },
  })
  const allowed = getCataloguingSidebarItems(dbUser?.role ?? "", dbUser?.appPermissions as any)
  if (!allowed.includes("PHOTOGRAPHY")) redirect("/tools/cataloguing/auctions")

  const auctions = await prisma.catalogueAuction.findMany({
    orderBy: { auctionDate: "desc" },
    select: {
      id: true, code: true, name: true, auctionDate: true, auctionType: true,
      complete: true, photography: true, addedToBC: true,
      lots: { select: { imageUrls: true } },
    },
  })

  const rows: PhotographyAuctionRow[] = auctions.map(a => {
    const total     = a.lots.length
    const withPhoto = a.lots.filter(l => l.imageUrls.length > 0).length
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      auctionDate: a.auctionDate ? new Date(a.auctionDate).toISOString() : null,
      auctionType: a.auctionType,
      complete: a.complete,
      photography: a.photography,
      addedToBC: a.addedToBC,
      lots: total,
      lotsWithPhotos: withPhoto,
    }
  })

  return (
    <PhotographyAuctionList
      active={rows.filter(r => !r.complete)}
      completed={rows.filter(r => r.complete)}
    />
  )
}
