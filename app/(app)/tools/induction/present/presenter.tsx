"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import InductionSlideView from "@/components/induction-slide"
import type { DeckSlide, LiveData } from "@/lib/induction-data"

// The presentation itself, run by an admin on a room screen while the tablet does the forms.
//
// It covers the Hub shell (fixed inset-0) rather than living on a separate top-level route:
// the app's own nav down the side of a projected slide looks like a mistake, but the page
// still sits inside (app) so the INDUCTION permission gate applies exactly once.

export default function Presenter({ slides, live }: { slides: DeckSlide[]; live: LiveData }) {
  const router = useRouter()
  const [i, setI] = useState(0)
  const [showNotes, setShowNotes] = useState(false)
  const total = slides.length

  const next = useCallback(() => setI(v => Math.min(v + 1, total - 1)), [total])
  const prev = useCallback(() => setI(v => Math.max(v - 1, 0)), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); next() }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev() }
      else if (e.key === "Home") setI(0)
      else if (e.key === "End") setI(Math.max(total - 1, 0))
      else if (e.key === "Escape") router.push("/tools/induction")
      else if (e.key.toLowerCase() === "n") setShowNotes(v => !v)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, prev, total, router])

  if (total === 0) {
    return (
      <div className="fixed inset-0 z-[150] bg-white dark:bg-[#0d0d0f] flex items-center justify-center p-8 text-center">
        <div>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">There are no slides to show.</p>
          <p className="text-gray-500 mt-2">Add some on the Slides tab, or tick an existing one back to active.</p>
          <button type="button" onClick={() => router.push("/tools/induction")}
            className="mt-6 px-6 py-3 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold">Back to Induction</button>
        </div>
      </div>
    )
  }

  const slide = slides[Math.min(i, total - 1)]

  return (
    <div className="fixed inset-0 z-[150] bg-white dark:bg-[#0d0d0f] flex flex-col">
      {/* Controls stay small and out of the way — the slide is the thing being looked at */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <button type="button" onClick={() => router.push("/tools/induction")}
          className="px-3 py-2 min-h-[44px] rounded-lg text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">✕ Finish</button>
        <span className="text-sm text-gray-500 font-semibold tabular-nums">{i + 1} / {total}</span>
        <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${((i + 1) / total) * 100}%` }} />
        </div>
        {slide.notes && (
          <button type="button" onClick={() => setShowNotes(v => !v)}
            className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-semibold ${showNotes ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
            🗒 Notes
          </button>
        )}
        <button type="button" onClick={prev} disabled={i === 0}
          className="px-4 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 disabled:opacity-30">← Back</button>
        <button type="button" onClick={next} disabled={i >= total - 1}
          className="px-5 py-2 min-h-[44px] rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-30">Next →</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 xl:px-10 py-8 xl:py-12">
          <InductionSlideView slide={slide} live={live} big />
        </div>
      </div>

      {/* Presenter notes — deliberately at the bottom of the SAME screen and off by default,
          because this is projected. It is a prompt for whoever is running it, not content. */}
      {showNotes && slide.notes && (
        <div className="shrink-0 border-t-4 border-amber-500 bg-amber-50 dark:bg-amber-500/10 px-6 py-4 max-h-[30vh] overflow-y-auto">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">Presenter note — not part of the slide</p>
          <p className="text-sm text-amber-900 dark:text-amber-200 whitespace-pre-line leading-relaxed">{slide.notes}</p>
        </div>
      )}

      <div className="shrink-0 px-4 py-1.5 text-center text-[11px] text-gray-400 border-t border-gray-200 dark:border-gray-800">
        Arrow keys or space to move · N for presenter notes · Esc to finish
      </div>
    </div>
  )
}
