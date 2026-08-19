"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import TrainingSlideView from "@/components/training-slide"
import { markDeckRead } from "@/lib/actions/training"
import { accent, CARD } from "@/lib/training-ui"
import type { TrainingSlideRow } from "@/lib/training-data"

// The deck, read at a desk by one person — as opposed to /present, which is the same deck on a
// room screen. Same slides, same renderer; the difference is the contents rail, the keyboard
// being optional, and the fact that finishing HERE is what records the person as having read
// it. Nobody is marked as trained because they projected a deck at twenty other people.

export default function LearnTab({
  moduleId, moduleKey, accentName, slides, alreadyRead,
}: {
  moduleId: string
  moduleKey: string
  accentName: string
  slides: TrainingSlideRow[]
  alreadyRead: boolean
}) {
  const a = accent(accentName)
  const [i, setI] = useState(0)
  const [read, setRead] = useState(alreadyRead)
  const total = slides.length
  const topRef = useRef<HTMLDivElement | null>(null)
  // Guards the "you have read it" write, which is a POST — without it every re-render of the
  // last slide fires another one.
  const savedRef = useRef(alreadyRead)

  const next = useCallback(() => setI(v => Math.min(v + 1, total - 1)), [total])
  const prev = useCallback(() => setI(v => Math.max(v - 1, 0)), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Not while somebody is typing in the contents filter or anywhere else.
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.key === "ArrowRight") { e.preventDefault(); next() }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, prev])

  // Reaching the last slide is what counts as having read it. Deliberately not a "mark as
  // read" button somebody can press without scrolling — and deliberately not fired for a deck
  // of one slide that happens to load.
  useEffect(() => {
    if (savedRef.current || total < 2 || i < total - 1) return
    savedRef.current = true
    markDeckRead(moduleId, total).then(res => { if (res.ok) setRead(true) })
  }, [i, total, moduleId])

  if (total === 0) {
    return (
      <div className={`${CARD} p-10 text-center`}>
        <p className="text-xl font-semibold text-gray-900 dark:text-white">This course has no slides yet.</p>
        <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-xl mx-auto">
          Nothing has been written for this panel. An admin can add the first slide on the Edit tab.
        </p>
      </div>
    )
  }

  const slide = slides[Math.min(i, total - 1)]

  return (
    <div ref={topRef} className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] items-start">
      {/* Contents. A deck you cannot jump around in is a video, and somebody coming back to
          check one thing should not have to click through fourteen slides to reach it. */}
      <nav className={`${CARD} p-3 lg:sticky lg:top-4 max-h-[75vh] overflow-y-auto`}>
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500 px-2 py-2">
          Contents
        </p>
        <ol className="space-y-0.5">
          {slides.map((s, n) => (
            <li key={s.id}>
              <button
                onClick={() => setI(n)}
                className={`w-full text-left px-3 py-2.5 min-h-[44px] rounded-lg text-sm transition flex gap-2.5 ${
                  n === i
                    ? `${a.chip} font-semibold`
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                <span className="tabular-nums opacity-60 shrink-0">{n + 1}</span>
                <span className="min-w-0 line-clamp-2">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0">
        {/* Progress + present */}
        <div className="flex items-center gap-4 mb-4">
          <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
            {i + 1} / {total}
          </span>
          <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
            <div
              className={`h-full ${a.btn} transition-all duration-300`}
              style={{ width: `${((i + 1) / total) * 100}%` }}
            />
          </div>
          {read && (
            <span className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 shrink-0">
              ✓ Read
            </span>
          )}
          <Link
            href={`/tools/training/${moduleKey}/present`}
            className="px-4 py-2.5 min-h-[44px] rounded-xl border-2 border-gray-200 dark:border-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-700 shrink-0"
          >
            ⛶ Present
          </Link>
        </div>

        <div className={`${CARD} p-8 xl:p-12 min-h-[440px] flex items-center`}>
          <TrainingSlideView slide={slide} />
        </div>

        <div className="flex items-center justify-between gap-3 mt-5">
          <button
            onClick={prev}
            disabled={i === 0}
            className="px-6 py-3.5 min-h-[44px] rounded-xl border-2 border-gray-200 dark:border-gray-800 text-base font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">
            Arrow keys work too
          </span>
          {i < total - 1 ? (
            <button
              onClick={next}
              className={`px-8 py-3.5 min-h-[44px] rounded-xl ${a.btn} text-white text-base font-semibold`}
            >
              Next →
            </button>
          ) : (
            <span className="px-6 py-3.5 text-base font-semibold text-green-700 dark:text-green-400">
              ✓ That is the end of the deck
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
