import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { SubmissionStatus } from "@/app/generated/prisma/enums"
import ContactForm from "./contact-form"
import LogisticsForm from "./logistics-form"
import ValuationSection from "./valuation-section"
import PhotoViewer from "./photo-viewer"
import PhotoLink from "./photo-link"
import ValuationLink from "./valuation-link"
import StatusSelect from "./status-select"
import FollowUpToggle from "./follow-up-toggle"
import NotesSection from "./notes-section"

const statusLabels: Record<SubmissionStatus, { label: string; color: string }> = {
  PENDING_ASSIGNMENT: { label: "Pending", color: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300" },
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

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  const { id } = await params

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: {
      contact: true,
      items: { include: { valuation: { include: { cataloguer: true } } } },
      contactLogs: { include: { user: true }, orderBy: { createdAt: "desc" } },
      logistics: true,
      staffNotes: { orderBy: { createdAt: "desc" } },
    },
  })

  if (!submission) notFound()

  const cataloguers = await prisma.user.findMany({
    where: { role: "CATALOGUER" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  })

  const { label, color } = statusLabels[submission.status]
  const isCollectionsOrAdmin = session?.user.role === "ADMIN" || session?.user.role === "COLLECTIONS"
  const isCataloguer = session?.user.role === "CATALOGUER" || session?.user.role === "ADMIN"

  const totalEstimate = submission.items
    .filter((i) => i.valuation)
    .reduce((sum, i) => sum + (i.valuation?.estimatedValue ?? 0), 0)

  const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"
  const cardPad = `${card} p-5`
  const title = "text-lg font-bold text-gray-900 dark:text-white"
  const railLabel = "text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3"

  const showContactLog = isCollectionsOrAdmin && (
    submission.status === "VALUATION_COMPLETE" ||
    submission.status === "PENDING_CUSTOMER_DECISION" ||
    submission.status === "FOLLOW_UP" ||
    submission.status === "APPROVED" ||
    submission.status === "DECLINED"
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <Link href="/submissions" className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-2 inline-flex items-center gap-1">
          &larr; Back to submissions
        </Link>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{submission.contact.name}</h1>
            <p className="text-sm font-mono text-gray-400 mt-1">
              REF {submission.reference.slice(0, 8).toUpperCase()} · {submission.channel.replace("_", " ")} · {new Date(submission.createdAt).toLocaleDateString("en-GB")}
            </p>
          </div>
          <span className={`inline-flex px-4 py-2 rounded-full text-base font-semibold ${color}`}>{label}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

        {/* ── Main column ───────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Customer */}
          <section className={cardPad}>
            <h2 className={`${title} mb-4`}>Customer Details</h2>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-base">
              <div>
                <dt className="text-gray-400 text-xs uppercase tracking-wide">Name</dt>
                <dd className="text-gray-800 dark:text-gray-100 font-semibold mt-0.5">{submission.contact.name}</dd>
              </div>
              {submission.contact.email && (
                <div className="min-w-0">
                  <dt className="text-gray-400 text-xs uppercase tracking-wide">Email</dt>
                  <dd className="text-gray-800 dark:text-gray-100 mt-0.5 truncate">{submission.contact.email}</dd>
                </div>
              )}
              {submission.contact.phone && (
                <div>
                  <dt className="text-gray-400 text-xs uppercase tracking-wide">Phone</dt>
                  <dd className="text-gray-800 dark:text-gray-100 mt-0.5">{submission.contact.phone}</dd>
                </div>
              )}
            </dl>
            {submission.notes && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Customer note</p>
                <p className="text-base text-gray-700 dark:text-gray-300">{submission.notes}</p>
              </div>
            )}
          </section>

          {/* Internal staff notes */}
          <section className={cardPad}>
            <h2 className={`${title} mb-4`}>
              Notes <span className="text-sm font-normal text-gray-400">· internal</span>
            </h2>
            <NotesSection
              submissionId={submission.id}
              notes={submission.staffNotes.map((n) => ({
                id: n.id,
                body: n.body,
                authorName: n.authorName,
                when: new Date(n.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
              }))}
            />
          </section>

          {/* Items */}
          <section className={cardPad}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className={title}>Items ({submission.items.length})</h2>
              {submission.items.some((i) => i.valuation) && (
                <span className="text-base font-semibold text-gray-700 dark:text-gray-300">
                  Total: <span className="text-green-700 dark:text-green-400">&pound;{totalEstimate.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                </span>
              )}
            </div>
            <div className="space-y-3">
              {submission.items.map((item) => {
                const hasExternal = (item as any).externalEstimate != null
                const hasAnyValuation = !!item.valuation || hasExternal
                return (
                <div key={item.id} className="border border-gray-100 dark:border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="font-semibold text-gray-800 dark:text-gray-100 text-base">{item.name}</p>
                    {!hasAnyValuation && (
                      <span className="text-sm text-gray-400">Awaiting valuation</span>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-sm text-gray-500 mt-1">{item.description}</p>
                  )}
                  <PhotoViewer imageUrls={item.imageUrls} />

                  {/* Internal cataloguer valuation */}
                  {item.valuation && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-xs font-semibold text-green-600 dark:text-green-500 uppercase tracking-wide">Valuation</p>
                        <p className="text-lg font-bold text-green-700 dark:text-green-400">
                          &pound;{item.valuation.estimatedValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      {item.valuation.comments && (
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{item.valuation.comments}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">by {item.valuation.cataloguer.name}</p>
                    </div>
                  )}

                  {/* External valuer's estimate */}
                  {hasExternal && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Valuer&apos;s Estimate</p>
                        <p className="text-lg font-bold text-blue-700 dark:text-blue-400">
                          &pound;{((item as any).externalEstimate as number).toLocaleString("en-GB")}
                        </p>
                      </div>
                      {(item as any).externalNotes && (
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{(item as any).externalNotes}</p>
                      )}
                    </div>
                  )}

                  {isCataloguer && !item.valuation && submission.cataloguerId === session?.user.id && (
                    <ValuationSection item={item} submissionId={submission.id} />
                  )}
                </div>
              )})}
            </div>
          </section>

          {/* Log Customer Contact */}
          {showContactLog && (
            <section className={cardPad}>
              <h2 className={`${title} mb-4`}>Log Customer Contact</h2>
              <ContactForm submissionId={submission.id} />
            </section>
          )}

          {/* Arrange Collection */}
          {isCollectionsOrAdmin && submission.status === "APPROVED" && !submission.logistics && (
            <section className={cardPad}>
              <h2 className={`${title} mb-4`}>Arrange Collection / Delivery</h2>
              <LogisticsForm submissionId={submission.id} />
            </section>
          )}

          {/* Logistics details */}
          {submission.logistics && (
            <section className={cardPad}>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className={title}>Logistics</h2>
                {!submission.logistics.arrived && isCollectionsOrAdmin && (
                  <form action={async () => {
                    "use server"
                    const { markArrived } = await import("@/lib/actions/logistics")
                    await markArrived(submission.id)
                  }}>
                    <button
                      type="submit"
                      className="text-base bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-xl transition-colors font-semibold"
                    >
                      Mark as Arrived
                    </button>
                  </form>
                )}
                {submission.logistics.arrived && (
                  <span className="text-base text-teal-600 font-semibold">
                    Arrived {submission.logistics.arrivedAt
                      ? new Date(submission.logistics.arrivedAt).toLocaleDateString("en-GB")
                      : ""}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-base">
                <div>
                  <dt className="text-gray-400 text-xs uppercase tracking-wide">Type</dt>
                  <dd className="text-gray-800 dark:text-gray-100 font-semibold mt-0.5">
                    {submission.logistics.type === "SENT_IN" ? "Sending items in" : "Collection arranged"}
                  </dd>
                </div>
                {submission.logistics.type === "COLLECTION" && (
                  <>
                    <div>
                      <dt className="text-gray-400 text-xs uppercase tracking-wide">Contact name</dt>
                      <dd className="text-gray-800 dark:text-gray-100 mt-0.5">{submission.logistics.collectionName}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-gray-400 text-xs uppercase tracking-wide">Address</dt>
                      <dd className="text-gray-800 dark:text-gray-100 mt-0.5">{submission.logistics.collectionAddress}</dd>
                    </div>
                    {submission.logistics.collectionPhone && (
                      <div>
                        <dt className="text-gray-400 text-xs uppercase tracking-wide">Phone</dt>
                        <dd className="text-gray-800 dark:text-gray-100 mt-0.5">{submission.logistics.collectionPhone}</dd>
                      </div>
                    )}
                    {submission.logistics.collectionEmail && (
                      <div>
                        <dt className="text-gray-400 text-xs uppercase tracking-wide">Email</dt>
                        <dd className="text-gray-800 dark:text-gray-100 mt-0.5">{submission.logistics.collectionEmail}</dd>
                      </div>
                    )}
                    {submission.logistics.collectionNotes && (
                      <div className="sm:col-span-2">
                        <dt className="text-gray-400 text-xs uppercase tracking-wide">Notes</dt>
                        <dd className="text-gray-800 dark:text-gray-100 mt-0.5">{submission.logistics.collectionNotes}</dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
            </section>
          )}

          {/* Contact history */}
          {submission.contactLogs.length > 0 && (
            <section className={cardPad}>
              <h2 className={`${title} mb-4`}>Contact History</h2>
              <div className="space-y-4">
                {submission.contactLogs.map((log) => (
                  <div key={log.id} className="border-l-2 border-gray-200 dark:border-gray-800 pl-4">
                    <div className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
                      <span className="font-semibold text-gray-600 dark:text-gray-400 capitalize">{log.method}</span>
                      <span>&middot;</span>
                      <span>{log.user.name}</span>
                      <span>&middot;</span>
                      <span>{new Date(log.createdAt).toLocaleDateString("en-GB")}</span>
                      {log.isFollowUp && (
                        <span className="bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 px-2 py-0.5 rounded text-sm">follow-up</span>
                      )}
                    </div>
                    {log.outcome && (
                      <p className="text-base text-gray-700 dark:text-gray-300 mt-1 capitalize">{log.outcome.replace("_", " ")}</p>
                    )}
                    {log.notes && <p className="text-base text-gray-600 dark:text-gray-400 mt-1">{log.notes}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Sticky action rail ────────────────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-6 self-start">

          {/* Status */}
          {isCollectionsOrAdmin && (
            <div className={cardPad}>
              <p className={railLabel}>Status</p>
              <StatusSelect submissionId={submission.id} current={submission.status} />
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <FollowUpToggle submissionId={submission.id} initial={(submission as any).needsFollowUp ?? false} />
              </div>
            </div>
          )}

          {isCollectionsOrAdmin && (
            <PhotoLink submissionId={submission.id} token={submission.photoUploadToken ?? null} />
          )}

          {isCollectionsOrAdmin && (
            <ValuationLink
              submissionId={submission.id}
              token={(submission as any).valuationToken ?? null}
              customerName={submission.contact.name}
              items={submission.items.map(i => ({ name: i.name }))}
              cataloguers={cataloguers}
              sentTo={(submission as any).valuationSentTo ?? null}
            />
          )}

          {(submission as any).valuationNotes && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40 rounded-2xl p-5">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide mb-2">External Valuation Notes</p>
              <p className="text-base text-blue-800 dark:text-blue-300">{(submission as any).valuationNotes}</p>
              {(submission as any).valuationSubmittedAt && (
                <p className="text-sm text-blue-400 mt-2">
                  Received {new Date((submission as any).valuationSubmittedAt).toLocaleDateString("en-GB")}
                </p>
              )}
            </div>
          )}

          {submission.followUpCount > 0 && (
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/40 rounded-2xl p-5">
              <p className="text-base font-semibold text-orange-700 dark:text-orange-400">
                {submission.followUpCount} follow-up{submission.followUpCount !== 1 ? "s" : ""} sent
              </p>
              {submission.lastFollowUpAt && (
                <p className="text-sm text-orange-500 dark:text-orange-400/70 mt-1">
                  Last: {new Date(submission.lastFollowUpAt).toLocaleDateString("en-GB")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
