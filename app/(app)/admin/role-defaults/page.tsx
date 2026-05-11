import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RoleDefaultsForm from "./role-defaults-form"

export default async function RoleDefaultsPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  // Pull every role definition and every non-admin user. Roles are
  // free-form strings on User.role — the union of RoleDefault rows + roles
  // already in use on users gives us the full list to show.
  const [defaults, users] = await Promise.all([
    prisma.roleDefault.findMany({ orderBy: { role: "asc" } }),
    prisma.user.findMany({
      where:   { role: { not: "ADMIN" } },
      select:  { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ])

  const defaultsByRole = Object.fromEntries(defaults.map(d => [d.role, d]))

  // Surface any user-roles that don't yet have a RoleDefault row so the
  // admin sees them and can configure permissions for them.
  const rolesInUseWithoutDefault = [...new Set(users.map(u => u.role))]
    .filter(r => !defaultsByRole[r])

  // Ordered list of roles to display: defaults first (alphabetical),
  // then any orphan roles in use.
  const allRoles = [
    ...defaults.map(d => d.role),
    ...rolesInUseWithoutDefault.sort(),
  ]

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Roles &amp; Defaults</h1>
        <p className="text-sm text-gray-500 mt-1">
          Add custom roles and set their default app access. Defaults are applied to new users automatically and can be pushed to existing users.
          ADMIN is a system role with full access and cannot be edited here.
        </p>
      </div>
      <RoleDefaultsForm allRoles={allRoles} defaults={defaultsByRole} users={users} />
    </div>
  )
}
