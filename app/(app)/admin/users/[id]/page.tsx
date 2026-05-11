import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import Link from "next/link"
import EditUserForm from "./edit-user-form"
import DeleteUserButton from "../delete-button"

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/submissions")

  const { id } = await params
  const [user, departments, roleDefaults, allUsers] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { department: true } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.roleDefault.findMany({ select: { role: true }, orderBy: { role: "asc" } }),
    prisma.user.findMany({ select: { role: true } }),
  ])

  if (!user) notFound()

  // Always include ADMIN + this user's current role + every other role known
  const roles = [...new Set([
    "ADMIN",
    user.role,
    ...roleDefaults.map(r => r.role),
    ...allUsers.map(u => u.role),
  ])].sort((a, b) => a === "ADMIN" ? -1 : b === "ADMIN" ? 1 : a.localeCompare(b))

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/admin/users" className="text-sm text-gray-500 hover:text-gray-700 mb-1 inline-block">← Users</Link>
          <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          {session.user.id !== user.id && user.role !== "ADMIN" && (
            <form action={`/api/admin/impersonate/${user.id}`} method="POST">
              <button
                type="submit"
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                👁 Login as {user.name.split(" ")[0]}
              </button>
            </form>
          )}
          {session.user.id !== user.id && (
            <DeleteUserButton id={user.id} name={user.name} redirectAfter="/admin/users" />
          )}
        </div>
      </div>

      <EditUserForm
        userId={user.id}
        name={user.name}
        email={user.email}
        username={user.username ?? null}
        role={user.role}
        departmentId={user.departmentId}
        allowedApps={user.allowedApps}
        appPermissions={user.appPermissions as Record<string, { role: string }> | null}
        departments={departments}
        roles={roles}
        isSelf={session.user.id === user.id}
      />
    </div>
  )
}
