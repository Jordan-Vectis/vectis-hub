// App-wide navigation loading boundary. Without this, clicking a link to a
// page that does slow work on load (GA in Marketing Reports, Business Central
// in the BC tools) gave NO feedback until the server finished — so it felt like
// the click did nothing and you had to click several times. This shows an
// instant spinner in the content area the moment a navigation starts.
export default function AppLoading() {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[70vh]">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-300 dark:border-gray-700 border-t-pink-600 rounded-full animate-spin" />
        <p className="text-sm font-medium">Loading…</p>
      </div>
    </div>
  )
}
