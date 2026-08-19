"use client"

import Link from "next/link"
import InductionSlideView from "@/components/induction-slide"
import type { DeckSlide, LiveData } from "@/lib/induction-data"
import type { TrainingSlideRow } from "@/lib/training-data"

// One training slide, rendered the same way in the reader and in the presenter.
//
// ⚠ This deliberately RE-USES the induction slide renderer rather than copying it. A training
// slide and an induction slide are the same object — a title, a subtitle, bullets, an optional
// image or video, and a layout — and a second 350-line copy would drift the first time either
// was fixed. The layouts, the two-column bullet flow and the numbered-steps graphic all come
// free, and a deck built here looks like the deck people already know.
//
// The one thing training adds is `tryHref`: a lesson about a screen should be able to open
// that screen. It is rendered around the slide, not inside it, so the shared renderer stays
// the renderer for both.

const NO_LIVE: LiveData = { aiders: [], kits: [], plan: null }

function toDeckSlide(s: TrainingSlideRow): DeckSlide {
  return {
    id: s.id, title: s.title, subtitle: s.subtitle, body: s.body,
    imageKey: s.imageKey, videoUrl: s.videoUrl,
    liveBlock: "NONE",           // the First Aid live blocks are induction-only
    layout: s.layout || "CONTENT",
    graphic: s.graphic || "NONE",
    notes: s.notes, sortOrder: s.sortOrder, active: s.active,
  }
}

export default function TrainingSlideView({
  slide, big = false, showTry = true,
}: {
  slide: TrainingSlideRow
  big?: boolean
  /** Off in the editor preview, where a link out of the page loses unsaved work. */
  showTry?: boolean
}) {
  const centred = slide.layout === "TITLE" || slide.layout === "STATEMENT"

  return (
    <div className="w-full">
      <InductionSlideView slide={toDeckSlide(slide)} live={NO_LIVE} big={big} />

      {showTry && slide.tryHref && (
        <div className={`mt-8 ${centred ? "text-center" : ""}`}>
          <Link
            href={slide.tryHref}
            target="_blank"
            className={`inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold ${
              big ? "px-8 py-4 text-xl" : "px-5 py-3 text-sm"
            }`}
          >
            {slide.tryLabel || "Open it"} ↗
          </Link>
          {/* Opens in a new tab on purpose: somebody halfway through a deck who follows a link
              and loses their place has to start the lesson again. */}
          <p className={`text-gray-500 dark:text-gray-400 mt-2 ${big ? "text-base" : "text-xs"}`}>Opens in a new tab</p>
        </div>
      )}
    </div>
  )
}
