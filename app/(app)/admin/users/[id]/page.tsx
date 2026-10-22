import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import Link from "next/link"
import EditUserForm from "./edit-user-form"
import { permissionGroups } from "@/lib/home-layout"
import { getHomeLayout } from "@/lib/home-layout-server"
import DeleteUserButton from "../delete-button"
import TwoFactorCard, { type TwoFactorStatus } from "./two-factor-card"
import { twoFactorTableExists } from "@/lib/two-factor"

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/submissions")

  const { id } = await params
  const [user, departments, roleDefaults, allUsers] = await Promise.all([
    prisma.user.findUnique({ where: { id } }),
    prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.roleDefault.findMany({ select: { role: true }, orderBy: { role: "asc" } }),
    prisma.user.findMany({ select: { role: true } }),
  ])

  if (!user) notFound()

  // Department links live in their own table, which only exists after Run
  // Migrations — fall back to the legacy single field so the page still loads.
  let departmentIds: string[] = []
  try {
    const links = await prisma.userDepartment.findMany({ where: { userId: id }, select: { departmentId: true } })
    departmentIds = links.map(l => l.departmentId)
  } catch {
    departmentIds = user.departmentId ? [user.departmentId] : []
  }

  // Two-factor lives in its own table, which only exists after Run Migrations.
  let twoFactor: TwoFactorStatus = { ready: false }
  if (await twoFactorTableExists()) {
    const tf = await prisma.userTwoFactor.findUnique({
      where: { userId: id },
      select: { required: true, enabledAt: true, backupCodes: true, updatedByName: true },
    })
    twoFactor = {
      ready: true,
      required: tf?.required ?? false,
      enabledAt: tf?.enabledAt?.toISOString() ?? null,
      backupLeft: tf?.backupCodes.length ?? 0,
      updatedByName: tf?.updatedByName ?? null,
    }
  }

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
        departmentIds={departmentIds}
        allowedApps={user.allowedApps}
        appPermissions={user.appPermissions as Record<string, { role: string }> | null}
        showScanTimer={(user as any).showScanTimer ?? true}
        showLotTimer={(user as any).showLotTimer ?? false}
        manualDescriptions={(user as any).manualDescriptions ?? false}
        timerRedMins={(user as any).timerRedMins ?? 30}
        departments={departments}
        roles={roles}
        isSelf={session.user.id === user.id}
        homeSections={permissionGroups(await getHomeLayout())}
      />

      <TwoFactorCard userId={user.id} isSelf={session.user.id === user.id} status={twoFactor} />
    </div>
  )
}
