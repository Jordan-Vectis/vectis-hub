import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import LookupClient from "./lookup-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Admin Centre" }

// Vectis Admin → Lot Lookup. Cross-system view of any customer's lots, so it is
// gated on the ADMIN_CENTRE app (admins pass automatically via hasAppAccess).
export default async function LotLookupPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "ADMIN_CENTRE")) redirect("/hub")

  return <LookupClient />
}
