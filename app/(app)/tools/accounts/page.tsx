import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import NewMonthForm from "./new-month-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "Accounts" }

const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"

export default async function AccountsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const months = await prisma.accountingMonth.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { documents: true } } },
  })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Accounts</h1>
        <p className="text-base text-gray-500 mt-1">
          Scan invoices &amp; receipts, let AI categorise them, review, then export the monthly spreadsheet.
        </p>
      </div>

      <div className={`${card} p-5 mb-6`}>
        <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">New month</h2>
        <NewMonthForm />
      </div>

      <div className="space-y-3">
        {months.length === 0 ? (
          <div className={`${card} p-6 text-center text-sm text-gray-400`}>
            No months yet — create one above (e.g. &ldquo;April 26&rdquo;) to get started.
          </div>
        ) : (
          months.map((m) => (
            <Link
              key={m.id}
              href={`/tools/accounts/${m.id}`}
              className={`${card} p-5 flex items-center justify-between hover:border-emerald-500/60 transition-colors`}
            >
              <div>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{m.label}</p>
                <p className="text-sm text-gray-500">{m._count.documents} {m._count.documents === 1 ? "line" : "lines"}</p>
              </div>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-sm">Open →</span>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
