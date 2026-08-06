"use client"

// Cataloguing → Item Valuations. Two tabs:
//   • Valuations — price a customer's photos and export the list (the default)
//   • Search     — quick-launch the research sites (the original screen)
//
// ⚠ Named "Research" until 2026-08-06 and the ROUTE is still /research — it is
// bookmarked, and /api/research/log feeds the cataloguing reports. Renaming the
// folder would break both for no gain.
//
// ⚠ The research TIMER below is load-bearing and easy to destroy by accident.
// It counts visible time on this page and beacons it to /api/research/log, which
// feeds ResearchLog → the cataloguing reports and their PDFs (each person's
// research time and session count). It must stay mounted on the PAGE, not inside
// a tab, or switching tabs would restart the clock and lose the time.

import { useEffect, useRef, useState } from "react"
import SearchTab from "./search-tab"
import ValuationsTab from "./valuations-tab"

// ── Invisible research-time tracker ───────────────────────────────────────────
// Tracks active (visible) milliseconds on this page and sends them to the
// API on unmount or tab switch. Nothing is shown to the user.

function useResearchTimer() {
  const accMs      = useRef(0)
  // Seeded in the effect, not here — Date.now() during render is impure and can
  // give an unstable value if React re-renders. The effect runs on mount, so the
  // clock still starts the moment the page appears.
  const visibleAt  = useRef<number | null>(null)
  const hasFlushed = useRef(false)

  useEffect(() => {
    accMs.current      = 0
    visibleAt.current  = Date.now()
    hasFlushed.current = false

    function getActiveMs() {
      const live = visibleAt.current ? Date.now() - visibleAt.current : 0
      return accMs.current + live
    }

    function send(ms: number) {
      if (ms < 5_000) return
      const blob = new Blob(
        [JSON.stringify({ durationMs: ms, startedAt: new Date(Date.now() - ms).toISOString() })],
        { type: "application/json" },
      )
      navigator.sendBeacon("/api/research/log", blob)
    }

    function flush() {
      if (hasFlushed.current) return
      const ms = getActiveMs()
      if (ms < 5_000) return
      hasFlushed.current = true
      send(ms)
    }

    function onVisibility() {
      if (document.hidden) {
        if (visibleAt.current !== null) {
          accMs.current += Date.now() - visibleAt.current
          visibleAt.current = null
        }
        // Checkpoint save — reset so next visible stretch is a fresh segment
        const ms = accMs.current
        if (ms >= 5_000) {
          send(ms)
          accMs.current      = 0
          hasFlushed.current = false
        }
      } else {
        visibleAt.current  = Date.now()
        hasFlushed.current = false
      }
    }

    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("beforeunload", flush)
    return () => {
      flush()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("beforeunload", flush)
    }
  }, [])
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "search" | "valuations"

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "valuations", icon: "💷", label: "Valuations" },
  { key: "search",     icon: "🔍", label: "Search" },
]

export default function ResearchPage() {
  useResearchTimer()
  // Valuations first — it's what the page is named after now.
  const [tab, setTab] = useState<Tab>("valuations")

  return (
    <div className="min-h-full bg-[#141416] px-6 py-12">

      {/* Heading */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Item Valuations</h1>
      </div>

      {/* Tabs */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center rounded-xl bg-[#1C1C1E] border border-gray-800 p-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              style={tab === t.key
                ? { background: "#2AB4A6", color: "#1C1C1E" }
                : { color: "#9ca3af" }}
            >
              <span className="mr-2">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "search" ? <SearchTab /> : <ValuationsTab />}
    </div>
  )
}
