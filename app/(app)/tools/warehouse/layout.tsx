import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { logAccessDenied, type DeniedDbSnapshot } from "@/lib/access-log"
import { getGoodsInUser } from "@/lib/goods-in/access"
import WarehouseSidebar from "@/components/warehouse-sidebar"

// Goods In — the section's shell and its door.
//
// Who may come in is decided by getGoodsInUser(): the Warehouse app's tier read FRESH from the
// database for the EFFECTIVE session (an admin viewing as a member of staff gets exactly their
// access). Anyone turned away is written to the Access Log first (/admin/access-log) — logged
// BEFORE redirect(), never inside a try/catch around it, because redirect() works by throwing.
//
// Layout: a sidebar from lg up; below that a compact bar across the top whose links scroll
// sideways (components/warehouse-sidebar.tsx). The content area is the scroller.

export const metadata = { title: "Goods In" }

export default async function GoodsInLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")

  const user = await getGoodsInUser()
  if (!user) {
    // Re-read the row for the log so the three failure shapes can be told apart afterwards
    // (nothing read · the row lacks the app · a different user's row). A failed read is noted
    // rather than logged as "no row", which would misfile it.
    let dbUser: DeniedDbSnapshot | null = null
    let note: string | undefined
    try {
      const row = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, email: true, role: true, allowedApps: true, appPermissions: true },
      })
      if (row) {
        dbUser = { id: row.id, email: row.email, role: row.role, allowedApps: row.allowedApps }
        const perms = row.appPermissions as { WAREHOUSE?: { role?: string } } | null
        if (row.role !== "ADMIN" && row.allowedApps.includes("WAREHOUSE") && !perms?.WAREHOUSE?.role) {
          note = "Has the Warehouse app but no Warehouse tier (warehouse / manager / admin) is set."
        }
      }
    } catch (e) {
      note = `Couldn't re-read the user row for this log: ${String((e as { message?: string })?.message ?? e).slice(0, 200)}`
    }
    await logAccessDenied({
      appKey: "WAREHOUSE",
      source: "goods_in_layout",
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
      note,
    })
    redirect("/hub")
  }

  return (
    <div className="flex flex-col lg:flex-row h-full w-full min-w-0">
      <WarehouseSidebar whRole={user.whRole} userName={user.name} />
      {/* `relative` keeps absolutely-placed things (sr-only inputs) inside this scroller rather than
          stretching the document — the same reason as the cataloguing shell. `min-w-0` lets the
          content shrink to the phone instead of pushing the page wider. */}
      <div className="relative flex-1 min-h-0 min-w-0 overflow-y-auto bg-gray-50 dark:bg-[#141416]">
        {children}
      </div>
    </div>
  )
}
