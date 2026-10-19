// Goods In → History, while a filter or a page is loading: says so plainly rather than leaving the
// old rows on screen as if the filter had done nothing (RULES design rule 7).

export default function HistoryLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8" role="status" aria-live="polite">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">History</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Loading the moves…</p>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3 animate-pulse" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-6 rounded bg-gray-100 dark:bg-gray-800" />
        ))}
      </div>
    </div>
  )
}
