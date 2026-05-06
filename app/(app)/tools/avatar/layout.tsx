import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"

export default async function AvatarLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "AI_PRESENTER")) redirect("/hub")
  return <>{children}</>
}
