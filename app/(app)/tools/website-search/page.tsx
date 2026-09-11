import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"
import { logAccessDenied } from "@/lib/access-log"
import WebsiteSearchButton from "@/app/(app)/tools/cataloguing/auctions/[id]/website-search-button"

// 🔎 Website Search as a page of its own — the home card under Cataloguing & AI (Jordan, 2026-09-11:
// "can we have website search as its own home page tab as well under cataloguing"). The SAME
// component as the button in tablet cataloguing, in standalone mode, so the two can never drift.
// ⚠ Gated on Cataloguing exactly like /api/website-search — read fresh, and a refusal is logged to
// the Access Log like the cataloguing layout's.
export const dynamic = "force-dynamic"

export default async function WebsiteSearchPage() {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, allowedApps: true, role: true, appPermissions: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "CATALOGUING")) {
    await logAccessDenied({
      appKey: "CATALOGUING",
      source: "website_search_page",
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
  return (
    <div className="h-full">
      <WebsiteSearchButton standalone />
    </div>
  )
}
