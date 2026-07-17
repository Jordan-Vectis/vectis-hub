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

  // A missing table is expected before Run Migrations is clicked and gets a hint.
  // Any OTHER error must NOT be dressed up as a missing migration — it would send
  // the admin to a button that can't help and hide the refresh button during the
  // exact incident they'd want it for. So it falls through and the page still works;
  // only the "last pushed" line is lost.
  let row: { requestedAt: Date; requestedByName: string | null } | null = null
  let tableMissing = false
  try {
    row = await prisma.appReload.findUnique({
      where: { id: "current" },
      select: { requestedAt: true, requestedByName: true },
    })
  } catch (e: any) {
    if (isMissingTable(e)) {
      console.error("ForceRefreshPage: AppReload table does not exist yet:", e?.message)
      tableMissing = true
    } else {
      console.error("ForceRefreshPage read error:", e)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Force Refresh</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Reload everyone onto the latest version — for after you&apos;ve pushed an update and don&apos;t want to wait for
          people to refresh themselves.
        </p>
      </div>
      <ForceRefreshClient
        lastRequestedAt={row?.requestedAt ? row.requestedAt.toISOString() : null}
        lastRequestedByName={row?.requestedByName ?? null}
        tableMissing={tableMissing}
      />
    </div>
  )
}
