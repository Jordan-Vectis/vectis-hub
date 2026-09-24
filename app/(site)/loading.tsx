// Shown the moment a link is followed on the test website, while the next page's data is read —
// the nav stays, the page area shows this. Without it a click did nothing visible until the
// server had answered (Jordan, 2026-09-24: "nothing happens then maybe 3 seconds later it moves
// to the page"). Every site page is server-rendered on demand, so every one benefits.
export default function SiteLoading() {
  return (
    <div className="bg-gray-50 min-h-[60vh]">
      <div className="h-1 bg-[#DB0606]/20 overflow-hidden">
        <div className="h-full w-1/3 bg-[#DB0606]" style={{ animation: "site-loading-slide 1.1s ease-in-out infinite" }} />
      </div>
      <style>{`@keyframes site-loading-slide { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }`}</style>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 flex items-center gap-3 text-gray-400">
        <span className="inline-block w-3 h-3 rounded-full bg-[#32348A] animate-pulse" aria-hidden="true" />
        <span className="text-xs font-black uppercase tracking-[0.25em]">Loading</span>
      </div>
    </div>
  )
}
