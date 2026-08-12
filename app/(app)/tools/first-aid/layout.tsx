import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"

// The MANAGEMENT side of First Aid, behind the normal login and the FIRST_AID app permission.
// The page anyone can read without logging in is the separate top-level /first-aid route.
export default async function FirstAidLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "FIRST_AID")) redirect("/hub")
  return <>{children}</>
}
