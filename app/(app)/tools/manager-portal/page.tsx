import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasAppAccess, getAllowedSections, APP_SECTIONS } from "@/lib/apps"
import SalesView from "./sales-view"
import DepartmentsView from "./departments-view"

export const dynamic = "force-dynamic"

export const metadata = { title: "Manager Portal" }

const TABS = APP_SECTIONS.MANAGER_PORTAL!

export default async function ManagerPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, allowedApps: true, appPermissions: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "MANAGER_PORTAL")) redirect("/hub")

  // Per-tab permission, using the same mechanism as the other apps' sections:
  // null = nothing configured, so show everything.
  const allowed = getAllowedSections(dbUser?.role ?? "", dbUser?.appPermissions as any, "MANAGER_PORTAL")
  const visibleTabs = allowed ? TABS.filter(t => allowed.includes(t.key)) : TABS
  if (visibleTabs.length === 0) redirect("/hub")

  const { tab: tabParam, range } = await searchParams
  const tab = visibleTabs.some(t => t.key === tabParam) ? tabParam! : visibleTabs[0].key

  const rangeDays = range === "all" ? null : range ? (Number(range) || 30) : 30

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Manager Portal</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          {tab === "departments"
            ? "Cataloguing rolled up by department — lots, sales and who worked on them."
            : "Lots in every sale across both systems, cataloguing pace and projected milestone dates. Click a sale for the full breakdown."}
        </p>
      </div>

      {visibleTabs.length > 1 && (
        <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 mb-5">
          {visibleTabs.map(t => {
            const active = t.key === tab
            return (
              <Link
                key={t.key}
                href={`/tools/manager-portal?tab=${t.key}`}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </div>
      )}

      {tab === "departments" ? <DepartmentsView rangeDays={rangeDays} /> : <SalesView />}
    </div>
  )
}
