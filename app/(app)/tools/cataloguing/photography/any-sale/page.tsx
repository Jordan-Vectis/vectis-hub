import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getCataloguingSidebarItems } from "@/lib/apps"
import { getDepartmentAccess, auctionWhere } from "@/lib/departments"
import AnySaleUploadClient from "./any-sale-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Upload photos — any sale" }

// Photography → Upload photos (any sale).
//
// The same uploader as a sale's own Photography page, with the sale taken out: it reads the
// barcode labels exactly as before, then works out which sale each lot is in by looking the
// code up across EVERY OPEN sale (Jordan, 2026-08-17: "just like the existing photography
// section but auction-less and checks it against all uncompleted sales to find matching ids").
//
// ⚠ Uncompleted only — `complete: false`, the same split the Photography list already draws
// between active and completed sales. A finished sale must not quietly take new photos.
export default async function AnySaleUploadPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, appPermissions: true },
  })
  const allowed = getCataloguingSidebarItems(dbUser?.role ?? "", dbUser?.appPermissions as any)
  if (!allowed.includes("PHOTOGRAPHY")) redirect("/tools/cataloguing/auctions")

  // ⚠ Departments still apply (RULES.md — every page that opens sales honours them). Its three
  // "sees everything" fallbacks mean most people are unaffected, and the sales being searched
  // are named on the page so a narrower scope is visible rather than mysterious. A code outside
  // that scope is HELD, never lost.
  const access = await getDepartmentAccess(session.user.id, dbUser?.role ?? "")

  const auctions = await prisma.catalogueAuction.findMany({
    where:   { ...auctionWhere(access), complete: false },
    // Soonest first, matching the Photography list this page is reached from.
    orderBy: { auctionDate: { sort: "asc", nulls: "last" } },
    select: {
      id: true, code: true, name: true,
      // Only what the uploader needs. Descriptions and key points would multiply the payload
      // for 6000+ lots and are read by nothing on this screen.
      lots: { select: { id: true, barcode: true, receiptUniqueId: true, imageUrls: true } },
    },
  })

  const lots = auctions.flatMap(a =>
    a.lots.map(l => ({
      id: l.id,
      barcode: l.barcode,
      receiptUniqueId: l.receiptUniqueId,
      imageUrls: l.imageUrls,
      auctionId: a.id,
      auctionCode: a.code,
    })),
  )

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5">
        <Link href="/tools/cataloguing/photography"
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white inline-block mb-1">
          ← Photography
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📷 Upload photos — any sale</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Drop in a folder without picking a sale first. Every barcode is looked up across all{" "}
          <strong className="text-gray-800 dark:text-gray-200">{auctions.length}</strong> sales still in progress
          ({lots.length.toLocaleString("en-GB")} lots), and each photo is saved to whichever sale its lot is in.
        </p>
      </div>

      <AnySaleUploadClient
        lots={lots}
        sales={auctions.map(a => ({ code: a.code, name: a.name, lots: a.lots.length }))}
      />
    </div>
  )
}
