import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getCataloguingSidebarItems } from "@/lib/apps"
import { getDepartmentAccess, auctionWhere } from "@/lib/departments"
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

  const access = await getDepartmentAccess(session.user.id, dbUser?.role ?? "")

  // ⚠ SOONEST FIRST (Jordan, 2026-08-17). Active sales are all in the future, so ascending
  // puts the one being shot next at the top — the whole point of this screen. Undated sales
  // sort to the bottom rather than jumping the queue on a null.
  // The Completed list is reversed below: for a finished sale, most-recently-held first.
  const auctions = await prisma.catalogueAuction.findMany({
    where:   auctionWhere(access),
    orderBy: { auctionDate: { sort: "asc", nulls: "last" } },
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
      // Soonest first — the next sale to photograph is at the top.
      active={rows.filter(r => !r.complete)}
      // Completed sales are in the past, so "soonest" means nothing there: newest first,
      // which is the one most likely to be looked back at. ⚠ Sorted, not reversed — reversing
      // the ascending list would drag the undated ones from the bottom to the very top.
      completed={rows.filter(r => r.complete).sort((a, b) => {
        if (!a.auctionDate) return 1
        if (!b.auctionDate) return -1
        return b.auctionDate.localeCompare(a.auctionDate)   // ISO strings sort chronologically
      })}
    />
  )
}
