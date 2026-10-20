import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"

// Customers holds every customer's personal details, so it has its own permission (CUSTOMERS),
// ticked per person in Users & Permissions — admins have it automatically.
export default async function CustomersLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "CUSTOMERS")) redirect("/hub")
  return <>{children}</>
}
