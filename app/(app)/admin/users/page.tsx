import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import CreateUserForm from "./create-user-form"

const roleLabels: Record<string, { label: string; color: string }> = {
  ADMIN: { label: "Admin", color: "bg-purple-100 text-purple-700" },
  COLLECTIONS: { label: "Collections", color: "bg-blue-100 text-blue-700" },
  CATALOGUER: { label: "Cataloguer", color: "bg-green-100 text-green-700" },
}

export default async function UsersPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/submissions")

  const [users, departments, roleDefaults] = await Promise.all([
    prisma.user.findMany({
      include: { department: true },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.roleDefault.findMany({ select: { role: true }, orderBy: { role: "asc" } }),
  ])

  // Always include ADMIN; add every custom role from RoleDefault; and pick up
  // any roles already in use on users but not yet in RoleDefault so they
  // still appear in the dropdown.
  const roles = [...new Set([
    "ADMIN",
    ...roleDefaults.map(r => r.role),
    ...users.map(u => u.role),
  ])].sort((a, b) => a === "ADMIN" ? -1 : b === "ADMIN" ? 1 : a.localeCompare(b))

  // Group users by role, in the same order as the roles array
  const usersByRole = roles
    .map(role => ({ role, members: users.filter(u => u.role === role) }))
    .filter(g => g.members.length > 0)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Manage team access and roles</p>
      </div>

      <div className="space-y-6 mb-6">
        {usersByRole.map(({ role, members }) => {
          const { label, color } = roleLabels[role] ?? { label: role, color: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300" }
          return (
            <div key={role} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Group header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${color}`}>{label}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">{members.length} {members.length === 1 ? "user" : "users"}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">Name</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">Username</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">Department</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((user) => (
                    <tr key={user.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{user.name}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{user.username ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{user.email}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{user.department?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/users/${user.id}`} className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                          Edit →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 max-w-lg">
        <h2 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Add User</h2>
        <CreateUserForm departments={departments} roles={roles} />
      </div>
    </div>
  )
}
