import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import NewMonthForm from "./new-month-form"
import ManageCardholders from "./manage-cardholders"
import MonthStar from "./month-star"
import LinkSpinner from "./link-spinner"

export const dynamic = "force-dynamic"
export const metadata = { title: "Accounts" }

const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"

export default async function AccountsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const months = await prisma.accountingMonth.findMany({
    orderBy: [{ favourite: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { documents: true } } },
  })
  const cardholders = await prisma.accountingCardholder.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })

  // Names still on entries that aren't in the managed list (left behind by a rename) —
  // surfaced so they can be merged into the right card without losing anything.
  const managedNames = new Set(cardholders.map((c) => c.name))
  const docGroups = await prisma.accountingDocument.groupBy({ by: ["cardholder"], _count: { _all: true } })
  const orphanCardholders = docGroups
    .filter((g) => g.cardholder && !managedNames.has(g.cardholder))
    .map((g) => ({ name: g.cardholder, count: g._count._all }))
    .sort((a, b) => b.count - a.count)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Accounts</h1>
        <p className="text-base text-gray-500 mt-1">
          Scan invoices &amp; receipts, let AI categorise them, review, then export the monthly spreadsheet.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">New month</h2>
          <NewMonthForm />
        </div>
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Cards &amp; accounts</h2>
          <ManageCardholders cardholders={cardholders.map((c) => ({ id: c.id, name: c.name }))} orphans={orphanCardholders} />
        </div>
      </div>

      <div className="space-y-3">
        {months.length === 0 ? (
          <div className={`${card} p-6 text-center text-sm text-gray-400`}>
            No months yet — create one above (e.g. &ldquo;April 26&rdquo;) to get started.
          </div>
        ) : (
          months.map((m) => (
            <div
              key={m.id}
              className={`${card} p-5 flex items-center gap-3 transition-colors ${m.favourite ? "border-amber-400/70 ring-1 ring-amber-400/40" : "hover:border-emerald-500/60"}`}
            >
              <MonthStar id={m.id} favourite={m.favourite} />
              <Link href={`/tools/accounts/${m.id}`} prefetch={false} className="flex items-center justify-between flex-1 min-w-0">
                <div>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{m.label}{m.favourite && <span className="ml-2 text-xs font-semibold text-amber-500 align-middle">Working on this</span>}</p>
                  <p className="text-sm text-gray-500">{m._count.documents} {m._count.documents === 1 ? "line" : "lines"}</p>
                </div>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-sm inline-flex items-center gap-2">Open → <LinkSpinner /></span>
              </Link>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
