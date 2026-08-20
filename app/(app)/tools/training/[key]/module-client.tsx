"use client"

import { useState } from "react"
import Link from "next/link"
import LearnTab from "./learn-tab"
import PracticeTab from "./practice-tab"
import EditTab from "./edit-tab"
import { accent } from "@/lib/training-ui"
import type { TrainingModuleRow, TrainingSlideRow, TrainingExerciseRow } from "@/lib/training-data"

// One course. Learn it, then prove you can do it — and, for an admin, write it.
//
// Full width and large type throughout: the person on this screen is by definition the person
// least at home in the tool being taught, which is the same reason the Admin Centre itself is
// built this way (RULES.md design rules 1 and 5).

type Tab = "learn" | "practice" | "edit"

export default function ModuleClient({
  module: m, slides, exercises, canOpenPanel, isAdmin, deckRead, passedIds, completed,
  alreadySigned, userName,
}: {
  module: TrainingModuleRow
  slides: TrainingSlideRow[]
  exercises: TrainingExerciseRow[]
  canOpenPanel: boolean
  isAdmin: boolean
  deckRead: boolean
  passedIds: string[]
  completed: boolean
  alreadySigned: boolean
  userName: string
}) {
  const a = accent(m.accent)
  const [tab, setTab] = useState<Tab>(slides.length === 0 && exercises.length > 0 ? "practice" : "learn")

  const TABS: { key: Tab; icon: string; label: string; blurb: string }[] = [
    { key: "learn",    icon: "📖", label: "Learn",    blurb: `${slides.length} slide${slides.length === 1 ? "" : "s"}` },
    { key: "practice", icon: "🎯", label: "Practice", blurb: `${passedIds.length}/${exercises.length} task${exercises.length === 1 ? "" : "s"} done` },
    ...(isAdmin ? [{ key: "edit" as Tab, icon: "✏️", label: "Edit", blurb: "Write the course" }] : []),
  ]

  return (
    <div className="px-6 py-8 max-w-[1800px] mx-auto">
      <Link href="/tools/training" className="inline-block text-base text-gray-500 hover:text-indigo-500 mb-3">
        ← All courses
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <span aria-hidden>{m.icon}</span>
            <span>{m.title}</span>
            {completed && (
              <span className="text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300">
                ✓ Completed
              </span>
            )}
          </h1>
          {m.blurb && <p className="text-lg text-gray-600 dark:text-gray-400 mt-2 max-w-4xl">{m.blurb}</p>}
        </div>
        {m.href && (
          <Link
            href={m.href}
            target="_blank"
            className={`px-6 py-3.5 min-h-[44px] rounded-xl ${a.btn} text-white font-semibold shrink-0`}
          >
            Open {m.title} ↗
          </Link>
        )}
      </div>

      {/* Tabs — the Admin Centre's own big-target style rather than a text tab strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 max-w-4xl">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`flex items-center gap-4 text-left px-6 py-5 rounded-2xl border-2 transition ${
              tab === t.key
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 shadow-sm"
                : "border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            <span className="text-3xl leading-none" aria-hidden>{t.icon}</span>
            <span className="min-w-0">
              <span className={`block text-lg font-bold ${tab === t.key ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-white"}`}>
                {t.label}
              </span>
              <span className="block text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t.blurb}</span>
            </span>
          </button>
        ))}
      </div>

      {tab === "learn" && (
        <LearnTab
          moduleId={m.id}
          moduleKey={m.key}
          accentName={m.accent}
          slides={slides}
          alreadyRead={deckRead}
        />
      )}

      {tab === "practice" && (
        <PracticeTab
          moduleId={m.id}
          moduleKey={m.key}
          moduleTitle={m.title}
          accentName={m.accent}
          exercises={exercises}
          panelHref={m.href}
          canOpenPanel={canOpenPanel}
          passedIds={passedIds}
          alreadySigned={alreadySigned}
          userName={userName}
        />
      )}

      {tab === "edit" && isAdmin && (
        <EditTab module={m} slides={slides} exercises={exercises} />
      )}
    </div>
  )
}
