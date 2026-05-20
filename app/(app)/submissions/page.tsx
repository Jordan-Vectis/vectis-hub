import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { SubmissionStatus } from "@/app/generated/prisma/enums"
import DeleteSubmissionButton from "./delete-button"

const statusLabels: Record<SubmissionStatus, { label: string; color: string }> = {
  PENDING_ASSIGNMENT: { label: "Pending Assignment", color: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300" },
  PENDING_VALUATION: { label: "Pending Valuation", color: "bg-yellow-100 text-yellow-700" },
  VALUATION_COMPLETE: { label: "Valuation Complete", color: "bg-blue-100 text-blue-700" },
  PENDING_CUSTOMER_DECISION: { label: "Awaiting Decision", color: "bg-purple-100 text-purple-700" },
  APPROVED: { label: "Approved", color: "bg-green-100 text-green-700" },
  DECLINED: { label: "Declined", color: "bg-red-100 text-red-700" },
  FOLLOW_UP: { label: "Follow-up", color: "bg-orange-100 text-orange-700" },
  COLLECTION_PENDING: { label: "Collection Pending", color: "bg-indigo-100 text-indigo-700" },
  ARRIVED: { label: "Arrived", color: "bg-teal-100 text-teal-700" },
  COMPLETED: { label: "Completed", color: "bg-emerald-100 text-emerald-700" },
}

const channelLabels: Record<string, string> = {
  EMAIL: "Email",
  WEB_FORM: "Web Form",
  PHONE: "Phone",
  WALK_IN: "Walk-in",
}

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    search?: string
    channel?: string
    department?: string
  }>
}) {
  const session = await auth()
  const { status, search, channel, department } = await searchParams

  const [submissions, departments] = await Promise.all([
    prisma.submission.findMany({
      where: {
        ...(status ? { status: status as SubmissionStatus } : {}),
        ...(channel ? { channel: channel as "EMAIL" | "WEB_FORM" | "PHONE" | "WALK_IN" } : {}),
        ...(department ? { department: { name: department } } : {}),
        ...(search
          ? {
              OR: [
                { contact: { name: { contains: search, mode: "insensitive" } } },
                { reference: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        contact: true,
        department: true,
        cataloguer: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ])

  const isCollectionsOrAdmin = session?.user.role === "ADMIN" || session?.user.role === "COLLECTIONS"
  const hasFilters = status || search || channel || department

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Submissions</h1>
          <p className="text-sm text-gray-500 mt-0.5">{submissions.length} total</p>
        </div>
        {isCollectionsOrAdmin && (
          <Link
            href="/submissions/new"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New Submission
          </Link>
        )}
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-3 mb-6">
        <input
          name="search"
          defaultValue={search}
          placeholder="Search customer or reference..."
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
        />
        <select
          name="status"
          defaultValue={status || ""}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          {Object.entries(statusLabels).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          name="channel"
          defaultValue={channel || ""}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All channels</option>
          {Object.entries(channelLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          name="department"
          defaultValue={department || ""}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.name}>{d.name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-white dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Filter
        </button>
        {hasFilters && (
          <Link href="/submissions" className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">
            Clear
          </Link>
        )}
      </form>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {submissions.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No submissions found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 dark:bg-[#141416]">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Reference</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Channel</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Items</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                {isCollectionsOrAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => {
                const { label, color } = statusLabels[sub.status]
                return (
                  <tr key={sub.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/submissions/${sub.id}`}
                        className="font-mono text-xs text-blue-600 hover:text-blue-800"
                      >
                        {sub.reference.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{sub.contact.name}</td>
                    <td className="px-4 py-3 text-gray-500">{channelLabels[sub.channel]}</td>
                    <td className="px-4 py-3 text-gray-500">{sub._count.items}</td>
                    <td className="px-4 py-3 text-gray-500">{sub.department?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
                        {label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(sub.createdAt).toLocaleDateString("en-GB")}
                    </td>
                    {isCollectionsOrAdmin && (
                      <td className="px-4 py-3 text-right">
                        <DeleteSubmissionButton
                          id={sub.id}
                          reference={sub.reference.slice(0, 8).toUpperCase()}
                        />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
