import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import DepartmentsManager, { type DepartmentRow } from "./departments-manager"

export const dynamic = "force-dynamic"

export const metadata = { title: "Departments" }

export default async function DepartmentsPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/submissions")

  // The auctionTypes column and the UserDepartment table only exist once Run
  // Migrations has been clicked, but the code is live the moment it deploys.
  // Fall back to the plain department list rather than showing an error page.
  let departments: DepartmentRow[] = []
  let migrated = true

  try {
    const rows = await prisma.department.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        auctionTypes: true,
        userLinks: { select: { user: { select: { id: true, name: true, role: true } } } },
      },
    })
    departments = rows.map(d => ({
      id:           d.id,
      name:         d.name,
      auctionTypes: d.auctionTypes ?? [],
      members:      d.userLinks.map(l => ({ id: l.user.id, name: l.user.name, role: l.user.role })),
    }))
  } catch {
    migrated = false
    const rows = await prisma.department.findMany({
      orderBy: { name: "asc" },
      select:  { id: true, name: true },
    })
    departments = rows.map(d => ({ id: d.id, name: d.name, auctionTypes: [], members: [] }))
  }

  // Sales per auction type, so each department can show how many sales it owns.
  const typeCounts: Record<string, number> = {}
  const grouped = await prisma.catalogueAuction.groupBy({
    by:     ["auctionType"],
    _count: { _all: true },
  })
  for (const g of grouped) typeCounts[g.auctionType] = g._count._all

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Departments</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Set which sale types each department covers, and who works in it. Cataloguers see the sales
          their departments cover — anyone in no department still sees everything.
        </p>
      </div>

      <DepartmentsManager departments={departments} typeCounts={typeCounts} migrated={migrated} />
    </div>
  )
}
