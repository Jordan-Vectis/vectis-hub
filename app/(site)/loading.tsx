// Shown the moment a link is followed on the test website, while the next page's data is read —
// the nav stays, the page area shows this. Without it a click did nothing visible until the
// server had answered (Jordan, 2026-09-24: "nothing happens then maybe 3 seconds later it moves
// to the page"). Every site page is server-rendered on demand, so every one benefits.
export default function SiteLoading() {
  return (
    <div className="min-h-[60vh]" aria-busy="true" aria-live="polite">
      <div className="h-[3px] bg-[var(--vs-line)] overflow-hidden">
        <div className="h-full w-1/3 bg-[var(--vs-navy)]" style={{ animation: "site-loading-slide 1.1s ease-in-out infinite" }} />
      </div>
      <style>{`@keyframes site-loading-slide { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }`}</style>
      <div className="vs-container py-16 flex items-center gap-3 text-[var(--vs-muted)]">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--vs-navy)] animate-pulse" aria-hidden="true" />
        <span className="vs-caps text-xs">Loading</span>
      </div>
    </div>
  )
}
