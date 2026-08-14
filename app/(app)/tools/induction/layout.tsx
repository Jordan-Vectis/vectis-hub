import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"

// Facilities → Induction, behind the login and the INDUCTION app permission. The tablet is
// signed in as a member of staff and handed to the new starter, so nothing in here is ever
// reachable by the person signing on their own.
export default async function InductionLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "INDUCTION")) redirect("/hub")
  return <>{children}</>
}
