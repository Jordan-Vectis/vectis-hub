"use client"

import { useTransition } from "react"
import { updateSubmissionStatus } from "@/lib/actions/submissions"

const STATUSES: [string, string][] = [
  ["PENDING_ASSIGNMENT", "Pending Assignment"],
  ["PENDING_VALUATION", "Pending Valuation"],
  ["VALUATION_COMPLETE", "Valuation Complete"],
  ["PENDING_CUSTOMER_DECISION", "Awaiting Decision"],
  ["APPROVED", "Approved"],
  ["DECLINED", "Declined"],
  ["FOLLOW_UP", "Follow-up"],
  ["COLLECTION_PENDING", "Collection Pending"],
  ["ARRIVED", "Arrived"],
  ["COMPLETED", "Completed"],
]

export default function StatusSelect({
  submissionId,
  current,
}: {
  submissionId: string
  current: string
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <select
      value={current}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value
        startTransition(async () => {
          await updateSubmissionStatus(submissionId, next as any)
        })
      }}
      className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
    >
      {STATUSES.map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  )
}
