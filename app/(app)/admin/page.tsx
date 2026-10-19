import { auth } from "@/auth"
import { redirect } from "next/navigation"
import AdminTiles from "./admin-tiles"

export default async function AdminOverviewPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  return (
    <div className="p-6 md:p-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">System-wide settings and management</p>
      </div>
      <AdminTiles />
    </div>
  )
}
