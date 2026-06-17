import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { SubmissionStatus } from "@/app/generated/prisma/enums"
import SendFollowUpButton from "./send-followup-button"

export default async function FollowUpsPage() {
  const session = await auth()
  if (!session) redirect("/login")

  if (session.user.role === "CATALOGUER") redirect("/submissions")

  const submissions = await prisma.submission.findMany({
    where: {
      status: {
        in: [SubmissionStatus.DECLINED, SubmissionStatus.FOLLOW_UP],
      },
    },
    include: {
      contact: true,
      items: { include: { valuation: true } },
      contactLogs: {
        where: { isFollowUp: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { lastFollowUpAt: "asc" },
  })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Follow-ups</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {submissions.length} customer{submissions.length !== 1 ? "s" : ""} to follow up with
        </p>
      </div>

      {submissions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">No follow-ups needed right now.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Items</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Est. Value</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Follow-ups Sent</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Last Contact</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => {
                const totalValue = sub.items
                  .filter((i) => i.valuation)
                  .reduce((s, i) => s + (i.valuation?.estimatedValue ?? 0), 0)

                return (
                  <tr key={sub.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/submissions/${sub.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                        {sub.contact.name}
                      </Link>
                      <div className="text-xs font-mono text-gray-400">
                        {sub.reference.slice(0, 8).toUpperCase()}
                      </div>
                      {sub.contact.email && (
                        <div className="text-xs text-gray-400">{sub.contact.email}</div>
                      )}
                      {sub.contact.phone && (
                        <div className="text-xs text-gray-400">{sub.contact.phone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{sub.items.length}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {totalValue > 0
                        ? `£${totalValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                        sub.followUpCount === 0 ? "bg-gray-100 text-gray-500"
                        : sub.followUpCount < 3 ? "bg-orange-100 text-orange-700"
                        : "bg-red-100 text-red-700"
                      }`}>
                        {sub.followUpCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {sub.lastFollowUpAt
                        ? new Date(sub.lastFollowUpAt).toLocaleDateString("en-GB")
                        : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        sub.status === "DECLINED"
                          ? "bg-red-100 text-red-700"
                          : "bg-orange-100 text-orange-700"
                      }`}>
                        {sub.status === "DECLINED" ? "Declined" : "Follow-up"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SendFollowUpButton submissionId={sub.id} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
