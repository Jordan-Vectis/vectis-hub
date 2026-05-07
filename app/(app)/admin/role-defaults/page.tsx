import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RoleDefaultsForm from "./role-defaults-form"

export default async function RoleDefaultsPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const [defaults, users] = await Promise.all([
    prisma.roleDefault.findMany(),
    prisma.user.findMany({
      where:   { role: { in: ["COLLECTIONS", "CATALOGUER"] } },
      select:  { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ])

  const defaultsByRole = Object.fromEntries(defaults.map(d => [d.role, d]))

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Role Defaults</h1>
        <p className="text-sm text-gray-500 mt-1">
          Set default app access for each role. Applied automatically to new users, and can be pushed to existing users.
        </p>
      </div>
      <RoleDefaultsForm defaults={defaultsByRole} users={users} />
    </div>
  )
}
