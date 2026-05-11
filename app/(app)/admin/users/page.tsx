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


  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage team access and roles</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 max-w-3xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Username</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const { label, color } = roleLabels[user.role] ?? { label: user.role, color: "bg-gray-100 text-gray-700" }
              return (
                <tr key={user.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{user.name}</td>
                  <td className="px-4 py-3 text-gray-500">{user.username ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-gray-500">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{label}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{user.department?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/users/${user.id}`}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                      Edit →
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-md">
        <h2 className="font-semibold text-gray-800 mb-4">Add User</h2>
        <CreateUserForm departments={departments} roles={roles} />
      </div>
    </div>
  )
}
