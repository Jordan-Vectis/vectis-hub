import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import Link from "next/link"

export default async function WarehouseDashboard() {
  const session = await auth()
  if (!session) redirect("/login")

  const [customerCount, receiptCount, openReceiptCount, containerCount, recentMovements] = await Promise.all([
    prisma.contact.count(),
    prisma.warehouseReceipt.count(),
    prisma.warehouseReceipt.count({ where: { status: "open" } }),
    prisma.warehouseContainer.count(),
    prisma.warehouseMovement.findMany({
      take: 10,
      orderBy: { movedAt: "desc" },
      include: { container: true, location: true },
    }),
  ])

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: "Arial, sans-serif" }}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Warehouse Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Overview of warehouse operations</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Customers", value: customerCount, color: "text-blue-600" },
          { label: "Total Receipts", value: receiptCount, color: "text-purple-600" },
          { label: "Open Receipts", value: openReceiptCount, color: "text-green-600" },
          { label: "Containers", value: containerCount, color: "text-orange-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="wh-card text-center">
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className="text-sm text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="wh-card">
        <p className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Quick Actions</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/tools/warehouse/inbound" className="wh-btn-primary">📥 New Inbound</Link>
          <Link href="/tools/warehouse/locate" className="wh-btn-secondary">📍 Locate Container</Link>
          <Link href="/tools/warehouse/warehouse" className="wh-btn-secondary">🔍 Lookup Location</Link>
        </div>
      </div>

      {/* Recent movements */}
      {recentMovements.length > 0 && (
        <div>
          <p className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Recent Movements</p>
          <div className="wh-card p-0 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="wh-table-header">Container</th>
                  <th className="wh-table-header">Description</th>
                  <th className="wh-table-header">Location</th>
                  <th className="wh-table-header">When</th>
                  <th className="wh-table-header">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentMovements.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="wh-table-cell font-mono font-bold">{m.containerId}</td>
                    <td className="wh-table-cell text-gray-600 text-xs">{m.container.description}</td>
                    <td className="wh-table-cell">
                      <span className="wh-badge wh-badge-blue font-mono">{m.locationCode}</span>
                    </td>
                    <td className="wh-table-cell text-gray-500 text-xs">
                      {new Date(m.movedAt).toLocaleString()}
                    </td>
                    <td className="wh-table-cell text-gray-500 text-xs">{m.movedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
