import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasAppAccess } from "@/lib/apps"
import SaleStatisticsClient from "./sale-statistics-client"

export const dynamic = "force-dynamic"

export const metadata = { title: "Sale Statistics" }

export default async function SaleStatisticsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "SALE_STATISTICS")) redirect("/hub")

  return <SaleStatisticsClient />
}
