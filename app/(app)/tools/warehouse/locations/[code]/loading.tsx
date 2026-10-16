// Goods In → one location, while it loads: says so plainly rather than leaving the previous screen
// up as if the tap had done nothing (RULES design rule 7).

export default function LocationLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6" role="status" aria-live="polite">
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 min-h-8 inline-flex items-center">← Locations</p>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-5 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading the location — what&apos;s there now and its latest moves…</p>
          <div className="space-y-3 animate-pulse" aria-hidden>
            <div className="h-9 w-48 max-w-full rounded bg-gray-100 dark:bg-gray-800" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-10 rounded bg-gray-100 dark:bg-gray-800" />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3 animate-pulse" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-6 rounded bg-gray-100 dark:bg-gray-800" />
        ))}
      </div>
    </div>
  )
}
