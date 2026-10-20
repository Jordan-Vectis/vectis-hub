import { ReportSkeleton } from "../skeleton"

// Goods In → Reports → one person, while their page is opening or a new range is being worked out
// (a name or a bar tapped, a range button): says so, rather than leaving the last screen up as if
// the tap had done nothing (RULES design rules 7 and 7b).

export default function PersonReportLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8" role="status" aria-live="polite">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Working out their figures for those days…</p>
      </div>
      <ReportSkeleton />
    </div>
  )
}
