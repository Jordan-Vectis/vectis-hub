import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { isMissingTable } from "@/lib/prisma-errors"
import ForceRefreshClient from "./refresh-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Force Refresh" }

export default async function ForceRefreshPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  // Always load the user list (for the per-user buttons). The AppReload rows are
  // best-effort: a missing table is expected before Run Migrations and gets a hint;
  // any OTHER error must NOT be dressed up as a missing migration — it would hide the
  // refresh buttons during the exact incident they'd want them for. So it falls
  // through and the page still works; only the "last refreshed" times are lost.
  let everyoneRow: { requestedAt: Date; requestedByName: string | null } | null = null
  let userReloadRows: { id: string; requestedAt: Date }[] = []
  let tableMissing = false

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  })

  try {
    const rows = await prisma.appReload.findMany({
      select: { id: true, requestedAt: true, requestedByName: true },
    })
    everyoneRow = rows.find((r) => r.id === "current") ?? null
    userReloadRows = rows.filter((r) => r.id !== "current").map((r) => ({ id: r.id, requestedAt: r.requestedAt }))
  } catch (e: any) {
    if (isMissingTable(e)) {
      console.error("ForceRefreshPage: AppReload table does not exist yet:", e?.message)
      tableMissing = true
    } else {
      console.error("ForceRefreshPage read error:", e)
    }
  }

  // Attach each user's last individual-refresh time (null if never).
  const lastByUser = new Map(userReloadRows.map((r) => [r.id, r.requestedAt.toISOString()]))
  const userList = users.map((u) => ({
    id: u.id,
    name: u.name || u.email,
    role: u.role,
    lastRefreshedAt: lastByUser.get(u.id) ?? null,
  }))

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Force Refresh</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Reload everyone — or one person — onto the latest version, for after you&apos;ve pushed an update and don&apos;t
          want to wait for people to refresh themselves.
        </p>
      </div>
      <ForceRefreshClient
        lastRequestedAt={everyoneRow?.requestedAt ? everyoneRow.requestedAt.toISOString() : null}
        lastRequestedByName={everyoneRow?.requestedByName ?? null}
        tableMissing={tableMissing}
        users={userList}
      />
    </div>
  )
}
