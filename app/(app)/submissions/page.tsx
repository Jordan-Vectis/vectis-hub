import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { SubmissionStatus } from "@/app/generated/prisma/enums"
import DeleteSubmissionButton from "./delete-button"

const statusLabels: Record<SubmissionStatus, { label: string; color: string }> = {
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

const STATUS_ORDER = Object.keys(statusLabels) as SubmissionStatus[]

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
    view?: string
  }>
}) {
  const session = await auth()
  const { status, search, channel, department, view: viewParam } = await searchParams
  const view = viewParam === "board" ? "board" : "list"

  const [submissions, departments] = await Promise.all([
    prisma.submission.findMany({
      where: {
        // Status filter only applies in list view — the board IS the status breakdown
        ...(status && view === "list" ? { status: status as SubmissionStatus } : {}),
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

  // Build a toggle href that preserves the active filters
  const toggleHref = (v: string) => {
    const p = new URLSearchParams()
    if (search) p.set("search", search)
    if (channel) p.set("channel", channel)
    if (department) p.set("department", department)
    if (v === "list" && status) p.set("status", status)
    p.set("view", v)
    return `/submissions?${p.toString()}`
  }

  const grouped = STATUS_ORDER.map((s) => ({
    status: s,
    ...statusLabels[s],
    items: submissions.filter((x) => x.status === s),
  }))

  const tabCls = (active: boolean) =>
    `px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
      active
        ? "bg-blue-600 text-white"
        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
    }`

  return (
    <div className={`p-6 mx-auto ${view === "board" ? "max-w-7xl" : "max-w-4xl"}`}>
      <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Submissions</h1>
          <p className="text-base text-gray-500 mt-1">{submissions.length} total</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex gap-1 bg-gray-50 dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-1">
            <Link href={toggleHref("list")} className={tabCls(view === "list")}>List</Link>
            <Link href={toggleHref("board")} className={tabCls(view === "board")}>Board</Link>
          </div>
          {isCollectionsOrAdmin && (
            <Link
              href="/submissions/new"
              className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-6 py-3 rounded-xl transition-colors"
            >
              + New Submission
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-3 mb-6">
        <input type="hidden" name="view" value={view} />
        <input
          name="search"
          defaultValue={search}
          placeholder="Search customer or reference..."
          className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        />
        {view === "list" && (
          <select
            name="status"
            defaultValue={status || ""}
            className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All statuses</option>
            {Object.entries(statusLabels).map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        )}
        <select
          name="channel"
          defaultValue={channel || ""}
          className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All channels</option>
          {Object.entries(channelLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          name="department"
          defaultValue={department || ""}
          className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.name}>{d.name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white text-base font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          Filter
        </button>
        {hasFilters && (
          <Link href={toggleHref(view)} className="text-base text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-3">
            Clear
          </Link>
        )}
      </form>

      {/* ── BOARD VIEW ─────────────────────────────────────────── */}
      {view === "board" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {grouped.map((col) => (
            <div key={col.status} className="flex-shrink-0 w-72">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold ${col.color}`}>
                  {col.label}
                </span>
                <span className="text-sm font-semibold text-gray-400">{col.items.length}</span>
              </div>
              <div className="space-y-2">
                {col.items.map((sub) => (
                  <Link
                    key={sub.id}
                    href={`/submissions/${sub.id}`}
                    className="block bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-400 dark:hover:border-blue-500 transition-colors p-3"
                  >
                    <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">{sub.contact.name}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-gray-400">
                      <span className="font-mono text-blue-600 dark:text-blue-400">{sub.reference.slice(0, 8).toUpperCase()}</span>
                      <span>·</span>
                      <span>{sub._count.items} item{sub._count.items !== 1 ? "s" : ""}</span>
                      <span>·</span>
                      <span>{new Date(sub.createdAt).toLocaleDateString("en-GB")}</span>
                    </div>
                  </Link>
                ))}
                {col.items.length === 0 && (
                  <div className="text-xs text-gray-300 dark:text-gray-600 px-1 py-2">No submissions</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── LIST VIEW ────────────────────────────────────────── */
        submissions.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-base bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800">
            No submissions found.
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.map((sub) => {
              const { label, color } = statusLabels[sub.status]
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
                        {sub.department && (
                          <>
                            <span>·</span>
                            <span>{sub.department.name}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>{new Date(sub.createdAt).toLocaleDateString("en-GB")}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`inline-flex px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap ${color}`}>
                        {label}
                      </span>
                      {isCollectionsOrAdmin && (
                        <DeleteSubmissionButton
                          id={sub.id}
                          reference={sub.reference.slice(0, 8).toUpperCase()}
                        />
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
