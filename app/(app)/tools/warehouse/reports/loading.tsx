// Goods In → Reports, while a range is being worked out (a range button, Show these days, Back):
// says so plainly rather than leaving the old figures on screen as if the tap had done nothing
// (RULES design rules 7 and 7b). A long range is one grouped query that can take a moment.

import { ReportSkeleton } from "./skeleton"

export default function ReportsLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8" role="status" aria-live="polite">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Working out the figures for those days…</p>
      </div>
      <ReportSkeleton />
    </div>
  )
}
