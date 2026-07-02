"use client"

import { useState } from "react"
import { GUIDE_SECTIONS } from "@/lib/bc-warehouse-guide"

// 📖 Guide tab — renders the per-section user guides from lib/bc-warehouse-guide.ts
// (the single source of truth shared with the PDF download route). The floating "?"
// on each section jumps here with that section pre-selected via `initialId`.

export default function GuideTab({ initialId }: { initialId?: string | null }) {
  const validInitial = GUIDE_SECTIONS.some((s) => s.id === initialId) ? initialId! : GUIDE_SECTIONS[0].id
  const [activeId, setActiveId] = useState<string>(validInitial)

  // If the user presses "?" on another section while the Guide is already mounted,
  // follow the new target (state-adjust-during-render pattern, not an effect).
  const [lastInitial, setLastInitial] = useState(initialId)
  if (initialId !== lastInitial) {
    setLastInitial(initialId)
    if (initialId && GUIDE_SECTIONS.some((s) => s.id === initialId)) setActiveId(initialId)
  }

  const section = GUIDE_SECTIONS.find((s) => s.id === activeId) ?? GUIDE_SECTIONS[0]

  return (
    <div className="flex h-full overflow-hidden">
      {/* Section list */}
      <div className="w-56 shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-y-auto p-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 mb-2">Guides</p>
        <div className="space-y-0.5">
          {GUIDE_SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                s.id === activeId
                  ? "bg-blue-600/15 text-blue-700 dark:text-blue-300 font-semibold"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60"
              }`}
            >
              <span>{s.icon}</span>
              <span className="truncate">{s.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Guide content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <span className="text-3xl">{section.icon}</span> {section.title}
            </h1>
            <a
              href={`/api/bc/warehouse-guide-pdf?section=${section.id}`}
              className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
              title="Download this section's guide as a printable PDF"
            >
              ⬇ Download PDF
            </a>
          </div>

          <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed mt-3">{section.intro}</p>

          <div className="mt-4 rounded-xl border border-sky-300/60 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-500/10 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300 mb-1">Where the data comes from</p>
            <p className="text-sm text-sky-900 dark:text-sky-200 leading-relaxed">{section.dataSource}</p>
          </div>

          <GuideHeading>What you&apos;ll see</GuideHeading>
          <ul className="space-y-1.5">
            {section.shows.map((s, i) => (
              <li key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed flex gap-2">
                <span className="text-gray-400 shrink-0">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>

          <GuideHeading>Buttons &amp; controls</GuideHeading>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {section.controls.map((c, i) => (
              <div key={i} className="px-4 py-2.5 bg-white dark:bg-gray-900/50">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{c.name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-0.5">{c.what}</p>
              </div>
            ))}
          </div>

          <GuideHeading>How to&hellip;</GuideHeading>
          <div className="space-y-4">
            {section.howTo.map((h, i) => (
              <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900/50">
                <p className="text-sm font-bold text-gray-900 dark:text-white mb-2">{h.task}</p>
                <ol className="space-y-1.5">
                  {h.steps.map((step, j) => (
                    <li key={j} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed flex gap-2.5">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600/15 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center mt-0.5">{j + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          {section.tips.length > 0 && (
            <>
              <GuideHeading>Tips</GuideHeading>
              <ul className="space-y-1.5">
                {section.tips.map((t, i) => (
                  <li key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed flex gap-2">
                    <span className="shrink-0">💡</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {section.gotchas.length > 0 && (
            <>
              <GuideHeading>Watch out for</GuideHeading>
              <div className="rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
                <ul className="space-y-1.5">
                  {section.gotchas.map((g, i) => (
                    <li key={i} className="text-sm text-amber-900 dark:text-amber-200 leading-relaxed flex gap-2">
                      <span className="shrink-0">⚠</span>
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <div className="h-10" />
        </div>
      </div>
    </div>
  )
}

function GuideHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mt-7 mb-2.5">{children}</h2>
  )
}
