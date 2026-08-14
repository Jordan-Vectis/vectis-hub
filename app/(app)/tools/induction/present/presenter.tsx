"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import InductionSlideView from "@/components/induction-slide"
import type { DeckSlide, LiveData } from "@/lib/induction-data"

// The presentation itself, run by an admin on a room screen while the tablet does the forms.
//
// It covers the Hub shell (fixed inset-0) rather than living on a separate top-level route:
// the app's own nav down the side of a projected slide looks like a mistake, but the page
// still sits inside (app) so the INDUCTION permission gate applies exactly once.

// Never shrink past this — a slide nobody at the back can read is no better than one that
// scrolls, and if it needs more than this the slide should be split in two.
const MIN_SCALE = 0.5

export default function Presenter({ slides, live }: { slides: DeckSlide[]; live: LiveData }) {
  const router = useRouter()
  const [i, setI] = useState(0)
  const [showNotes, setShowNotes] = useState(false)
  const [chrome, setChrome] = useState(true)     // the controls; hidden while presenting
  const [scale, setScale] = useState(1)
  const [clipped, setClipped] = useState(false)  // scaled to the floor and STILL too tall
  const total = slides.length

  const stageRef   = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const next = useCallback(() => setI(v => Math.min(v + 1, total - 1)), [total])
  const prev = useCallback(() => setI(v => Math.max(v - 1, 0)), [])

  // ── Fit the slide to the screen ────────────────────────────────────────────
  // ⚠ The original version simply let a long slide scroll. On a projector that means the
  // presenter is scrolling mid-sentence and the back of the room reads half a bullet list —
  // the fire-equipment slide overflowed on a 1080p screen. offsetHeight reports the LAYOUT
  // box, which a CSS transform does not affect, so measuring while scaled is stable and
  // cannot feed back into itself.
  useLayoutEffect(() => {
    const stage = stageRef.current
    const content = contentRef.current
    if (!stage || !content) return

    const measure = () => {
      const available = stage.clientHeight
      const needed = content.offsetHeight
      if (!available || !needed) return
      const raw = Math.min(1, available / needed)
      // ⚠ Past the floor the bottom of the slide is simply not on screen, and the stage is
      // overflow-hidden, so there is no scrollbar to hint at it. Silently losing the last three
      // bullets of a fire procedure in front of a room is exactly the "nothing happened looks
      // like success" failure — say so instead.
      setClipped(raw < MIN_SCALE)
      setScale(Math.max(MIN_SCALE, raw))
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(content)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [i, showNotes, total])

  // ── Keys ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); next() }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev() }
      else if (e.key === "Home") setI(0)
      else if (e.key === "End") setI(Math.max(total - 1, 0))
      else if (e.key === "Escape") { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else router.push("/tools/induction") }
      else if (e.key.toLowerCase() === "n") setShowNotes(v => !v)
      else if (e.key.toLowerCase() === "f") toggleFullscreen()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, prev, total, router])

  // The controls fade out while nobody is touching anything, so the room sees the slide and
  // not a toolbar. Any movement brings them back.
  const wake = useCallback(() => {
    setChrome(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChrome(false), 3500)
  }, [])

  useEffect(() => {
    wake()
    window.addEventListener("mousemove", wake)
    window.addEventListener("keydown", wake)
    window.addEventListener("touchstart", wake)
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      window.removeEventListener("mousemove", wake)
      window.removeEventListener("keydown", wake)
      window.removeEventListener("touchstart", wake)
    }
  }, [wake])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  if (total === 0) {
    return (
      <div className="fixed inset-0 z-[150] bg-white dark:bg-[#0b0b0d] flex items-center justify-center p-8 text-center">
        <div>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">There are no slides to show.</p>
          <p className="text-gray-500 mt-2">Add some on the Slides tab, or tick an existing one back to active.</p>
          <button type="button" onClick={() => router.push("/tools/induction")}
            className="mt-6 px-6 py-3 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold">Back to Induction</button>
        </div>
      </div>
    )
  }

  const slide   = slides[Math.min(i, total - 1)]
  const centred = slide.layout === "TITLE" || slide.layout === "STATEMENT"

  return (
    <div className="fixed inset-0 z-[150] bg-white dark:bg-[#0b0b0d] flex flex-col overflow-hidden">
      {/* A soft amber wash in the corners, so a slide is not white type on a black rectangle */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: "radial-gradient(60rem 40rem at 12% -10%, rgba(245,158,11,0.13), transparent 60%), radial-gradient(50rem 35rem at 100% 110%, rgba(245,158,11,0.08), transparent 60%)" }} />

      {/* Controls — fade out while presenting, come back on any movement */}
      {/* ⚠ Two layers, and both halves matter.
          The BUTTONS go pointer-events-none while faded, or an invisible bar still takes the
          tap — on a tablet, touching the top-left to bring the controls back landed on ✕ Finish.
          But making them inert alone means the first tap or click on the bar does nothing at
          all and the user taps twice wondering why. So the WRAPPER stays live and its only job,
          while faded, is to bring the controls back — the way a video player's chrome behaves. */}
      <div className="relative z-10 shrink-0"
        onPointerDown={chrome ? undefined : e => { e.preventDefault(); e.stopPropagation(); wake() }}>
      <div className={`flex items-center gap-3 px-4 py-2 transition-opacity duration-500 ${chrome ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <button type="button" onClick={() => router.push("/tools/induction")}
          className="px-3 py-2 min-h-[44px] rounded-lg text-sm font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">✕ Finish</button>
        <span className="text-sm text-gray-500 dark:text-gray-400 font-semibold tabular-nums">{i + 1} / {total}</span>
        <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-300" style={{ width: `${((i + 1) / total) * 100}%` }} />
        </div>
        {clipped && (
          <span className="px-2 py-1 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold whitespace-nowrap">
            ⚠ Too long — the bottom is cut off
          </span>
        )}
        {slide.notes && (
          <button type="button" onClick={() => setShowNotes(v => !v)}
            className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-semibold ${showNotes ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300" : "text-gray-500 hover:text-gray-900 dark:hover:text-white"}`}>
            🗒 Notes
          </button>
        )}
        <button type="button" onClick={toggleFullscreen}
          className="px-3 py-2 min-h-[44px] rounded-lg text-sm font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">⛶ Full screen</button>
        <button type="button" onClick={prev} disabled={i === 0}
          className="px-4 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-white/15 text-sm font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-30">← Back</button>
        <button type="button" onClick={next} disabled={i >= total - 1}
          className="px-5 py-2 min-h-[44px] rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-30">Next →</button>
      </div>
      </div>

      {/* The slide. Clicking the right two-thirds advances, the left third goes back — a
          presenter with a clicker or a touchscreen should not have to find a button. */}
      <div ref={stageRef} className="relative z-10 flex-1 min-h-0 overflow-hidden">
        <div className="absolute inset-0 flex" aria-hidden>
          <button type="button" tabIndex={-1} aria-label="Previous slide" onClick={prev} className="w-1/3 cursor-w-resize" />
          <button type="button" tabIndex={-1} aria-label="Next slide" onClick={next} className="flex-1 cursor-e-resize" />
        </div>
        <div
          className={`px-8 xl:px-16 pointer-events-none ${centred ? "h-full flex items-center justify-center" : ""}`}
          style={{ transform: `scale(${scale})`, transformOrigin: centred ? "center center" : "top center", height: centred ? "100%" : undefined }}
        >
          <div ref={contentRef} className="max-w-[1400px] w-full mx-auto py-6 xl:py-10 [&_a]:pointer-events-auto [&_iframe]:pointer-events-auto [&_img]:pointer-events-auto">
            <InductionSlideView slide={slide} live={live} big />
          </div>
        </div>
      </div>

      {/* Presenter notes — deliberately at the bottom of the SAME screen and off by default,
          because this is projected. It is a prompt for whoever is running it, not content. */}
      {showNotes && slide.notes && (
        <div className="relative z-10 shrink-0 border-t-4 border-amber-500 bg-amber-50 dark:bg-amber-500/10 px-6 py-4 max-h-[30vh] overflow-y-auto">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">Presenter note — not part of the slide</p>
          <p className="text-sm text-amber-900 dark:text-amber-200 whitespace-pre-line leading-relaxed">{slide.notes}</p>
        </div>
      )}

      {/* Footer: branding left, the key hint right — both quiet enough to project */}
      <div className="relative z-10 shrink-0 flex items-center justify-between gap-4 px-5 py-2">
        {/* Quiet watermark. The logo needs its white pill to be legible at all, and at full
            strength that pill is the brightest thing in a dark room. */}
        <span className="inline-flex items-center bg-white rounded-full px-3 py-1 opacity-40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vectis-logo.svg" alt="Vectis Auctions" className="h-5 w-auto" />
        </span>
        <span className={`text-[11px] text-gray-500 dark:text-gray-400 transition-opacity duration-500 ${chrome ? "opacity-100" : "opacity-0"}`}>
          Arrow keys, space or a click move on · F for full screen · N for notes · Esc leaves full screen, then finishes
        </span>
        <span className="text-xs font-semibold text-gray-400 tabular-nums">{i + 1} / {total}</span>
      </div>
    </div>
  )
}
