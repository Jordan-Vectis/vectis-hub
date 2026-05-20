import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getWarehouseRole } from "@/lib/apps"
import WarehouseSidebar from "@/components/warehouse-sidebar"
import { getEffectiveSession } from "@/lib/impersonation"

export default async function WarehouseLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")

  let whRole: string | null = null
  if (session.user.role === "ADMIN") {
    whRole = "admin"
  } else {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { allowedApps: true, appPermissions: true },
    })
    if (!user || !user.allowedApps.includes("WAREHOUSE")) redirect("/hub")
    const perms = user.appPermissions as { WAREHOUSE?: { role: string } } | null
    whRole = perms?.WAREHOUSE?.role ?? null
    if (!whRole) redirect("/hub")
  }

  return (
    <div className="flex h-full w-full">
      <WarehouseSidebar whRole={whRole} />
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-[#141416]">
        {children}
      </div>
    </div>
  )
}
