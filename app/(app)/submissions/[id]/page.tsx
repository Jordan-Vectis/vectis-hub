import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { SubmissionStatus } from "@/app/generated/prisma/enums"
import AssignForm from "./assign-form"
import ContactForm from "./contact-form"
import LogisticsForm from "./logistics-form"
import ValuationSection from "./valuation-section"
import PhotoViewer from "./photo-viewer"
import PhotoLink from "./photo-link"

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
      department: true,
      cataloguer: true,
      createdBy: true,
      items: { include: { valuation: { include: { cataloguer: true } } } },
      contactLogs: { include: { user: true }, orderBy: { createdAt: "desc" } },
      logistics: true,
    },
  })

  if (!submission) notFound()

  const departments = await prisma.department.findMany({ orderBy: { name: "asc" } })
  const cataloguers = await prisma.user.findMany({
    where: { role: "CATALOGUER" },
    include: { department: true },
    orderBy: { name: "asc" },
  })

  const { label, color } = statusLabels[submission.status]
  const isCollectionsOrAdmin = session?.user.role === "ADMIN" || session?.user.role === "COLLECTIONS"
  const isCataloguer = session?.user.role === "CATALOGUER" || session?.user.role === "ADMIN"

  const totalEstimate = submission.items
    .filter((i) => i.valuation)
    .reduce((sum, i) => sum + (i.valuation?.estimatedValue ?? 0), 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link href="/submissions" className="text-sm text-gray-400 hover:text-gray-600 mb-1 block">
            &larr; Back to submissions
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {submission.contact.name}
          </h1>
          <p className="text-xs font-mono text-gray-400 mt-0.5">
            REF: {submission.reference.slice(0, 8).toUpperCase()}
          </p>
        </div>
        <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${color}`}>
          {label}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">

          {/* Customer info */}
          <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Customer Details</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-400">Name</dt>
                <dd className="text-gray-800 dark:text-gray-100 font-medium">{submission.contact.name}</dd>
              </div>
              {submission.contact.email && (
                <div>
                  <dt className="text-gray-400">Email</dt>
                  <dd className="text-gray-800 dark:text-gray-100">{submission.contact.email}</dd>
                </div>
              )}
              {submission.contact.phone && (
                <div>
                  <dt className="text-gray-400">Phone</dt>
                  <dd className="text-gray-800 dark:text-gray-100">{submission.contact.phone}</dd>
                </div>
              )}
              <div>
                <dt className="text-gray-400">Channel</dt>
                <dd className="text-gray-800 dark:text-gray-100">{submission.channel.replace("_", " ")}</dd>
              </div>
            </dl>
            {submission.notes && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-400 mb-1">Notes</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{submission.notes}</p>
              </div>
            )}
          </section>

          {/* Items + Valuations */}
          <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Items ({submission.items.length})</h2>
              {submission.items.some((i) => i.valuation) && (
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Total estimate: <span className="text-green-700">&pound;{totalEstimate.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                </span>
              )}
            </div>
            <div className="space-y-3">
              {submission.items.map((item) => (
                <div key={item.id} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-800 dark:text-gray-100 text-sm">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                      )}
                    <PhotoViewer imageUrls={item.imageUrls} />
                    </div>
                    {item.valuation ? (
                      <div className="text-right">
                        <p className="text-sm font-semibold text-green-700">
                          &pound;{item.valuation.estimatedValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                        </p>
                        {item.valuation.comments && (
                          <p className="text-xs text-gray-500 mt-0.5 max-w-xs text-right">{item.valuation.comments}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">by {item.valuation.cataloguer.name}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">No valuation yet</span>
                    )}
                  </div>
                  {isCataloguer && !item.valuation && submission.cataloguerId === session?.user.id && (
                    <ValuationSection item={item} submissionId={submission.id} />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Assignment - collections/admin only */}
          {isCollectionsOrAdmin && submission.status === "PENDING_ASSIGNMENT" && (
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Assign to Department & Cataloguer</h2>
              <AssignForm
                submissionId={submission.id}
                departments={departments}
                cataloguers={cataloguers}
              />
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                <span className="text-xs text-gray-400">or</span>
                <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
              </div>
              <form action={async () => {
                "use server"
                const { updateSubmissionStatus } = await import("@/lib/actions/submissions")
                await updateSubmissionStatus(submission.id, SubmissionStatus.APPROVED)
              }}>
                <button
                  type="submit"
                  className="w-full text-sm bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Accept without valuation
                </button>
              </form>
            </section>
          )}

          {/* Contact Log - collections/admin */}
          {isCollectionsOrAdmin && (
            submission.status === "VALUATION_COMPLETE" ||
            submission.status === "PENDING_CUSTOMER_DECISION" ||
            submission.status === "FOLLOW_UP" ||
            submission.status === "APPROVED" ||
            submission.status === "DECLINED"
          ) && (
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Log Customer Contact</h2>
              <ContactForm submissionId={submission.id} />
            </section>
          )}

          {/* Logistics - after approval */}
          {isCollectionsOrAdmin && submission.status === "APPROVED" && !submission.logistics && (
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Arrange Collection / Delivery</h2>
              <LogisticsForm submissionId={submission.id} />
            </section>
          )}

          {/* Logistics details if set */}
          {submission.logistics && (
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800 dark:text-gray-100">Logistics</h2>
                {!submission.logistics.arrived && isCollectionsOrAdmin && (
                  <form action={async () => {
                    "use server"
                    const { markArrived } = await import("@/lib/actions/logistics")
                    await markArrived(submission.id)
                  }}>
                    <button
                      type="submit"
                      className="text-sm bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Mark as Arrived
                    </button>
                  </form>
                )}
                {submission.logistics.arrived && (
                  <span className="text-sm text-teal-600 font-medium">
                    Arrived {submission.logistics.arrivedAt
                      ? new Date(submission.logistics.arrivedAt).toLocaleDateString("en-GB")
                      : ""}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-gray-400">Type</dt>
                  <dd className="text-gray-800 dark:text-gray-100 font-medium">
                    {submission.logistics.type === "SENT_IN" ? "Sending items in" : "Collection arranged"}
                  </dd>
                </div>
                {submission.logistics.type === "COLLECTION" && (
                  <>
                    <div>
                      <dt className="text-gray-400">Contact name</dt>
                      <dd className="text-gray-800 dark:text-gray-100">{submission.logistics.collectionName}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-gray-400">Address</dt>
                      <dd className="text-gray-800 dark:text-gray-100">{submission.logistics.collectionAddress}</dd>
                    </div>
                    {submission.logistics.collectionPhone && (
                      <div>
                        <dt className="text-gray-400">Phone</dt>
                        <dd className="text-gray-800 dark:text-gray-100">{submission.logistics.collectionPhone}</dd>
                      </div>
                    )}
                    {submission.logistics.collectionEmail && (
                      <div>
                        <dt className="text-gray-400">Email</dt>
                        <dd className="text-gray-800 dark:text-gray-100">{submission.logistics.collectionEmail}</dd>
                      </div>
                    )}
                    {submission.logistics.collectionNotes && (
                      <div className="col-span-2">
                        <dt className="text-gray-400">Notes</dt>
                        <dd className="text-gray-800 dark:text-gray-100">{submission.logistics.collectionNotes}</dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
            </section>
          )}

          {/* Contact history */}
          {submission.contactLogs.length > 0 && (
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Contact History</h2>
              <div className="space-y-3">
                {submission.contactLogs.map((log) => (
                  <div key={log.id} className="border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="font-medium text-gray-600 dark:text-gray-400 capitalize">{log.method}</span>
                      <span>&middot;</span>
                      <span>{log.user.name}</span>
                      <span>&middot;</span>
                      <span>{new Date(log.createdAt).toLocaleDateString("en-GB")}</span>
                      {log.isFollowUp && (
                        <span className="bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 px-1.5 py-0.5 rounded text-xs">follow-up</span>
                      )}
                    </div>
                    {log.outcome && (
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 capitalize">{log.outcome.replace("_", " ")}</p>
                    )}
                    {log.notes && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{log.notes}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Assignment</h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-gray-400 text-xs">Department</dt>
                <dd className="text-gray-800 dark:text-gray-100">{submission.department?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-400 text-xs">Cataloguer</dt>
                <dd className="text-gray-800 dark:text-gray-100">{submission.cataloguer?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-400 text-xs">Created by</dt>
                <dd className="text-gray-800 dark:text-gray-100">{submission.createdBy.name}</dd>
              </div>
              <div>
                <dt className="text-gray-400 text-xs">Created</dt>
                <dd className="text-gray-800 dark:text-gray-100">{new Date(submission.createdAt).toLocaleDateString("en-GB")}</dd>
              </div>
            </dl>
          </div>

          {isCollectionsOrAdmin && (
            <PhotoLink submissionId={submission.id} token={submission.photoUploadToken ?? null} />
          )}

          {submission.followUpCount > 0 && (
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/40 rounded-xl p-4">
              <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
                {submission.followUpCount} follow-up{submission.followUpCount !== 1 ? "s" : ""} sent
              </p>
              {submission.lastFollowUpAt && (
                <p className="text-xs text-orange-500 dark:text-orange-400/70 mt-0.5">
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
