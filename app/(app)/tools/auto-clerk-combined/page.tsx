'use client'

// Auto Clerk — Combined View
// Left:  Bidpath → Saleroom  (reads real Bidpath WebSocket, shows what to press on Saleroom)
// Right: Saleroom → Bidpath  (reads GAP relay via bookmarklet, shows what to press on Bidpath)

export default function AutoClerkCombinedPage() {
  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="h-10 shrink-0 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-900">
        <span className="text-sm font-bold text-slate-200 tracking-tight">
          Auto Clerk — Combined Shadow View
        </span>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            Left: Bidpath → Saleroom
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Right: Saleroom → Bidpath
          </span>
          <a href="/tools/auto-clerk" className="text-slate-600 hover:text-slate-400 transition-colors">
            ← Launcher
          </a>
        </div>
      </div>

      {/* ── Two panels ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left — Bidpath → Saleroom */}
        <div className="flex-1 flex flex-col border-r border-slate-700 overflow-hidden">
          <div className="h-7 shrink-0 flex items-center px-3 bg-blue-950/40 border-b border-blue-900/40">
            <span className="text-[11px] font-semibold text-blue-300 uppercase tracking-wider">
              📡 Bidpath feed → what to press on Saleroom
            </span>
          </div>
          <iframe
            src="/tools/auto-clerk-live"
            className="flex-1 w-full border-0"
            title="Bidpath to Saleroom shadow"
          />
        </div>

        {/* Right — Saleroom → Bidpath */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="h-7 shrink-0 flex items-center px-3 bg-amber-950/40 border-b border-amber-900/40">
            <span className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider">
              🏷 Saleroom feed → what to press on Bidpath
            </span>
          </div>
          <iframe
            src="/tools/auto-clerk-saleroom"
            className="flex-1 w-full border-0"
            title="Saleroom to Bidpath shadow"
          />
        </div>

      </div>
    </div>
  )
}
