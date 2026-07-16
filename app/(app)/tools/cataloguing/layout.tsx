import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess, getCataloguingSidebarItems } from "@/lib/apps"
import CataloguingShell from "@/components/cataloguing-shell"
import { getEffectiveSession } from "@/lib/impersonation"
import { logAccessDenied } from "@/lib/access-log"

export default async function CataloguingLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  // id + email are selected only so a denial can be logged with enough detail to
  // tell a failed read from a short row from a cross-user read — see
  // lib/access-log.ts and /admin/access-log.
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, allowedApps: true, role: true, appPermissions: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "CATALOGUING")) {
    await logAccessDenied({
      appKey: "CATALOGUING",
      source: "cataloguing_layout",
      session: {
        id:              session.user.id,
        email:           session.user.email,
        name:            session.user.name,
        role:            session.user.role,
        isImpersonating: session.isImpersonating,
        adminId:         session.adminId,
        adminName:       session.adminName,
      },
      dbUser,
    })
    redirect("/hub")
  }
  const allowedSidebarItems = getCataloguingSidebarItems(
    dbUser?.role ?? "",
    dbUser?.appPermissions as Record<string, any> | null
  )
  return <CataloguingShell allowedSidebarItems={allowedSidebarItems}>{children}</CataloguingShell>
}
