import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getCataloguingSidebarItems } from "@/lib/apps"
import BarcodeDebugClient from "./debug-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Barcode debug" }

// Single-image barcode diagnostic for the smart scan. Same access as Photography.
export default async function BarcodeDebugPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, appPermissions: true },
  })
  const allowed = getCataloguingSidebarItems(dbUser?.role ?? "", dbUser?.appPermissions as any)
  if (!allowed.includes("PHOTOGRAPHY")) redirect("/tools/cataloguing/auctions")

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <Link href="/tools/cataloguing/photography"
        className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white inline-block mb-1">
        ← Photography
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🔧 Barcode debug</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 mb-5">
        Drop in one photo to see exactly what the barcode reader does with it — every size and contrast treatment,
        whether it&apos;s consistent, and what the AI reads. Nothing is saved.
      </p>
      <BarcodeDebugClient />
    </div>
  )
}
