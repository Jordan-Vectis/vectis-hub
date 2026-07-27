import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"

// Gated on BC_REPORTS rather than a new app key — this screen reads the same
// Receipt_Totes_Excel data as BC Reports → Warehouse, so anyone who can see
// that report can see this one. Avoids an admin having to grant a new
// permission to every user before the page is usable.
export default async function ToteProgressLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "BC_REPORTS")) redirect("/hub")
  return <>{children}</>
}
