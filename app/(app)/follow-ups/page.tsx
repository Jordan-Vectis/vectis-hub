import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"

const statusLabels: Record<string, { label: string; color: string }> = {
  PENDING_ASSIGNMENT: { label: "Pending Assignment", color: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300" },
  PENDING_VALUATION: { label: "Pending Valuation", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  VALUATION_COMPLETE: { label: "Valuation Complete", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  PENDING_CUSTOMER_DECISION: { label: "Awaiting Decision", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  APPROVED: { label: "Approved", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  DECLINED: { label: "Declined", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  FOLLOW_UP: { label: "Follow-up", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  COLLECTION_PENDING: { label: "Collection Pending", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
  ARRIVED: { label: "Arrived", color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400" },
  COMPLETED: { label: "Completed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
}

const channelLabels: Record<string, string> = {
  EMAIL: "Email",
  WEB_FORM: "Web Form",
  PHONE: "Phone",
  WALK_IN: "Walk-in",
}

export default async function FollowUpsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  if (session.user.role === "CATALOGUER") redirect("/submissions")

  const submissions = await prisma.submission.findMany({
    where: { needsFollowUp: true },
    include: {
      contact: true,
      items: { include: { valuation: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Follow-ups</h1>
        <p className="text-base text-gray-500 mt-1">
          {submissions.length} customer{submissions.length !== 1 ? "s" : ""} to follow up with
        </p>
      </div>

      {submissions.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-base bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800">
          No follow-ups needed right now.
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((sub) => {
            const { label, color } = statusLabels[sub.status] ?? statusLabels.PENDING_ASSIGNMENT
            const totalValue = sub.items
              .filter((i) => i.valuation)
              .reduce((s, i) => s + (i.valuation?.estimatedValue ?? 0), 0)

            return (
              <Link
                key={sub.id}
                href={`/submissions/${sub.id}`}
                className="block bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 hover:border-blue-400 dark:hover:border-blue-500 transition-colors p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xl font-bold text-gray-900 dark:text-white truncate">{sub.contact.name}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-base text-gray-500 dark:text-gray-400">
                      <span className="font-mono text-sm text-blue-600 dark:text-blue-400">
                        {sub.reference.slice(0, 8).toUpperCase()}
                      </span>
                      <span>·</span>
                      <span>{channelLabels[sub.channel]}</span>
                      <span>·</span>
                      <span>{sub._count.items} item{sub._count.items !== 1 ? "s" : ""}</span>
                      {totalValue > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-green-700 dark:text-green-400 font-semibold">
                            &pound;{totalValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-gray-400">
                      {sub.contact.email && <span>{sub.contact.email}</span>}
                      {sub.contact.phone && <span>{sub.contact.phone}</span>}
                    </div>
                  </div>
                  <span className={`inline-flex px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap flex-shrink-0 ${color}`}>
                    {label}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
