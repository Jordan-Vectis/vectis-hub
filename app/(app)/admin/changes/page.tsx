import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { ingestChanges, listChanges } from "@/lib/changelog"
import ChangesClient from "./changes-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Patches & Changes" }

// Admin → Patches & Changes.
// The record of what has gone into the Hub, and the reports written from it.
//
// ⚠ The record is filled at BUILD time (scripts/capture-changelog.mjs) plus a
// committed seed — the running app has no git and no GitHub token. See
// lib/changelog.ts for the order of preference.

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const sp = await searchParams
  const days = [7, 14, 30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 14

  // Idempotent (keyed on sha), so every visit tops the record up with whatever
  // this deploy knows without ever duplicating a change.
  let capture: Awaited<ReturnType<typeof ingestChanges>> | null = null
  let notReady = false
  try {
    capture = await ingestChanges()
  } catch (e: any) {
    // The tables arrive with the migrations, which are run by hand after a
    // deploy. Say so rather than showing a database error.
    if (e?.code === "P2021" || /does not exist in the current database/i.test(e?.message ?? "")) notReady = true
    else throw e
  }

  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

  const [changes, reports] = notReady
    ? [[], []]
    : await Promise.all([
        listChanges(from, to),
        prisma.changeReport.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      ])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Patches &amp; Changes</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          Everything that has gone into the Hub, and reports written from it for managers.
        </p>
      </div>

      <ChangesClient
        notReady={notReady}
        days={days}
        from={from.toISOString()}
        to={to.toISOString()}
        capture={capture}
        changes={changes}
        reports={reports.map(r => ({
          id: r.id,
          title: r.title,
          body: r.body,
          periodFrom: r.periodFrom.toISOString(),
          periodTo: r.periodTo.toISOString(),
          changeCount: r.changeCount,
          model: r.model,
          createdBy: r.createdBy,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
