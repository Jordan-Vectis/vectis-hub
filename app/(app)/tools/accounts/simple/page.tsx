import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getAccountsAccess } from "@/lib/accounts-auth"
import LinkSpinner from "../link-spinner"

export const dynamic = "force-dynamic"
export const metadata = { title: "Accounts" }

// Simple mode home — a big, friendly month picker. Non-admins are funnelled here
// from /tools/accounts; admins can reach it via the "Simple mode" button and get a
// small link back to the full view.
export default async function SimpleAccountsHome() {
  const { canAccess, isAdmin } = await getAccountsAccess()
  if (!canAccess) redirect("/hub")

  const months = await prisma.accountingMonth.findMany({
    orderBy: [{ favourite: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { documents: true } } },
  })

  const working = months.find((m) => m.favourite) ?? null
  const rest = months.filter((m) => m.id !== working?.id)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#111318] px-5 py-8">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Accounts</h1>
          {isAdmin && (
            <Link href="/tools/accounts" prefetch={false} className="text-xs font-semibold text-gray-400 hover:text-emerald-500">
              Full view →
            </Link>
          )}
        </div>
        <p className="text-lg text-gray-500 dark:text-gray-400 mb-8">Tap the month you want to work on.</p>

        {months.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] p-8 text-center">
            <p className="text-5xl mb-3">🗓️</p>
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">No month set up yet</p>
            <p className="text-base text-gray-500 mt-1">Ask the office to start this month for you, then come back here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {working && <MonthButton id={working.id} label={working.label} count={working._count.documents} primary />}
            {rest.map((m) => (
              <MonthButton key={m.id} id={m.id} label={m.label} count={m._count.documents} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MonthButton({ id, label, count, primary }: { id: string; label: string; count: number; primary?: boolean }) {
  return (
    <Link
      href={`/tools/accounts/simple/${id}`}
      prefetch={false}
      className={`block rounded-2xl border p-6 transition-colors ${
        primary
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
          : "border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] hover:border-emerald-400"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          {primary && <p className="text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 mb-1">Working on this now</p>}
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{label}</p>
          <p className="text-base text-gray-500 mt-0.5">{count} {count === 1 ? "receipt/line" : "receipts/lines"}</p>
        </div>
        <span className="text-emerald-600 dark:text-emerald-400 font-bold text-lg inline-flex items-center gap-2 shrink-0">
          Start <LinkSpinner />
        </span>
      </div>
    </Link>
  )
}
