import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"

// Gates BOTH tabs — Analytics and Business Plan — on the MARKETING_REPORTS app
// permission, the same way every other tool under /tools is gated. Added
// 2026-08-13: the pages themselves only ever checked for a login, so the
// permission tickbox in Users & Permissions had no effect here.

export default async function MarketingReportsLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "MARKETING_REPORTS")) redirect("/hub")
  return <>{children}</>
}
