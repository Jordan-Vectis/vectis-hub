"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

// Global Business Central connection indicator + one-click connect, in the top
// bar. A small "BC" badge with a status dot (green = connected, amber = not);
// clicking opens a little popover with a "Sign in with Microsoft" button that
// returns to the current page. So anyone — especially a manager who only uses
// the Manager Portal — can connect from anywhere instead of hunting for a
// per-tool banner. Uses the same per-user OAuth as every other BC tool.
export default function BcStatusButton() {
  const pathname = usePathname()
  const [connected, setConnected] = useState<boolean | null>(null)   // null = still checking
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Check once per full page load. A sign-in is a full redirect back here, so the
  // component remounts and re-checks — no need to poll on client navigation.
  useEffect(() => {
    let cancelled = false
    fetch("/api/bc/status")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setConnected(!!d?.connected) })
      .catch(() => { if (!cancelled) setConnected(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  // Return to the current page after sign-in — but only if it's a safe internal
  // path (matches the server's safeReturnPath rule); otherwise let it default.
  const safe = /^\/[A-Za-z0-9\-_/]*$/.test(pathname || "") ? pathname : "/hub"
  const authUrl = `/api/bc/auth?return=${encodeURIComponent(safe)}`

  const dot = connected == null ? "bg-gray-500" : connected ? "bg-emerald-400" : "bg-amber-400"
  const title = connected == null ? "Business Central — checking…" : connected ? "Business Central — connected" : "Business Central — not connected"

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title={title} aria-label={title}
        className="flex items-center text-gray-400 hover:text-white transition-colors">
        <span className="relative inline-flex items-center justify-center w-7 h-5 rounded bg-gray-800 border border-gray-600 text-[10px] font-bold tracking-tight">
          BC
          <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${dot} border border-gray-900`} />
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 z-50 rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3 text-sm">
          <p className="font-semibold text-white mb-1.5 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            Business Central
          </p>
          {connected == null ? (
            <p className="text-gray-400 text-xs">Checking connection…</p>
          ) : connected ? (
            <>
              <p className="text-emerald-400 text-xs mb-2">✓ Connected — you can see live BC figures across the app.</p>
              <a href={authUrl} className="text-xs text-gray-400 hover:text-white underline">Reconnect / switch account</a>
            </>
          ) : (
            <>
              <p className="text-gray-400 text-xs mb-3">Not connected. Sign in with your Microsoft account once to see live BC figures (e.g. the Manager Portal and BC tools).</p>
              <a href={authUrl} className="block text-center text-sm font-semibold px-3 py-1.5 rounded-lg bg-[#0078D4] hover:bg-blue-500 text-white">
                Sign in with Microsoft
              </a>
            </>
          )}
        </div>
      )}
    </div>
  )
}
