// Goods In → Reports: the grey shapes both loading screens show while the figures are worked out.

/** Grey shapes where the range bar, tiles and table will be — shared with the per-person page's loading. */
export function ReportSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-hidden>
      <div className="h-24 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2">
            <div className="h-3 w-16 rounded bg-gray-100 dark:bg-gray-800" />
            <div className="h-7 w-12 rounded bg-gray-100 dark:bg-gray-800" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-6 rounded bg-gray-100 dark:bg-gray-800" />
        ))}
      </div>
    </div>
  )
}
