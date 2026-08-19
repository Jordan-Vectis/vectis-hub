"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { accent, CARD, INPUT } from "@/lib/training-ui"
import type { TrainingModuleRow } from "@/lib/training-data"

export type HomeModule = TrainingModuleRow & {
  section: string
  canOpenPanel: boolean
  deckRead: boolean
  passed: number
  completed: boolean
}

// The course list. Every panel in the Hub has an entry, whether or not anyone has written its
// lessons yet — that is the point of the shell: there is always somewhere for the training to
// go, and it is obvious at a glance what is still missing.
//
// ⚠ Courses with no content are shown, not hidden. Hiding them would make the tool look
// finished and leave nobody any way to see what still needs writing.

export default function TrainingHome({ modules, isAdmin }: { modules: HomeModule[]; isAdmin: boolean }) {
  const [q, setQ] = useState("")
  const [only, setOnly] = useState<"all" | "ready" | "todo">("all")

  const written = modules.filter(m => m.slideCount > 0 || m.exerciseCount > 0)
  const done    = modules.filter(m => m.completed).length

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return modules.filter(m => {
      const hasContent = m.slideCount > 0 || m.exerciseCount > 0
      if (only === "ready" && !hasContent) return false
      if (only === "todo"  &&  hasContent) return false
      if (!needle) return true
      return (
        m.title.toLowerCase().includes(needle) ||
        (m.blurb ?? "").toLowerCase().includes(needle) ||
        m.section.toLowerCase().includes(needle)
      )
    })
  }, [modules, q, only])

  // Grouped the way the Hub groups its cards, so someone looking for "the warehouse one" looks
  // where they already look.
  const grouped = useMemo(() => {
    const map = new Map<string, HomeModule[]>()
    for (const m of visible) {
      const arr = map.get(m.section) ?? []
      arr.push(m)
      map.set(m.section, arr)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visible])

  return (
    <div className="px-6 py-8 max-w-[1800px] mx-auto">
      <Link href="/hub" className="inline-block text-base text-gray-500 hover:text-indigo-500 mb-3">← Back to the Hub</Link>

      <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">🎓 Training</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 mt-2 max-w-4xl">
            Learn any panel of the Hub: read the deck, then do the practice tasks. The tasks use real
            records from this system and mark themselves, so what you practise on is what you will
            actually be looking at.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Stat value={written.length} of={modules.length} label="courses written" />
          <Stat value={done} of={modules.length} label="you have completed" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mt-6 mb-8">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search the courses…"
          className={`${INPUT} max-w-md`}
        />
        <div className="flex gap-2">
          {([["all", "Everything"], ["ready", "Ready to do"], ["todo", "Not written yet"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setOnly(k)}
              className={`px-5 py-3 min-h-[44px] rounded-xl text-sm font-semibold border-2 transition ${
                only === k
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                  : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className={`${CARD} p-10 text-center`}>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">Nothing matches that.</p>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {modules.length === 0
              ? "No courses exist yet. If this is a new environment, an admin needs to press Run Migrations."
              : "Try a different search, or switch the filter back to Everything."}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {grouped.map(([section, list]) => (
            <section key={section}>
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500 mb-4">
                {section}
              </h2>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list.map(m => <CourseCard key={m.id} m={m} isAdmin={isAdmin} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ value, of, label }: { value: number; of: number; label: string }) {
  return (
    <div className="text-right">
      <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
        {value}<span className="text-gray-400 dark:text-gray-600 text-xl"> / {of}</span>
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  )
}

function CourseCard({ m, isAdmin }: { m: HomeModule; isAdmin: boolean }) {
  const a = accent(m.accent)
  const hasContent = m.slideCount > 0 || m.exerciseCount > 0

  return (
    <Link
      href={`/tools/training/${m.key}`}
      className={`${CARD} border-2 ${hasContent ? a.border : "border-dashed border-gray-300 dark:border-gray-700"} p-5 flex flex-col gap-3 transition hover:ring-4 ${a.ring} min-h-[200px]`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-4xl leading-none" aria-hidden>{m.icon}</span>
        <div className="flex flex-col items-end gap-1.5">
          {m.completed && (
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300">
              ✓ Completed
            </span>
          )}
          {!m.completed && m.deckRead && (
            <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${a.chip}`}>
              Deck read
            </span>
          )}
          {!m.active && isAdmin && (
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              Hidden
            </span>
          )}
        </div>
      </div>

      <div className="flex-1">
        <h3 className={`text-xl font-bold ${hasContent ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
          {m.title}
        </h3>
        {m.blurb && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 line-clamp-3">{m.blurb}</p>
        )}
      </div>

      {hasContent ? (
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className={`px-2.5 py-1 rounded-lg ${a.chip}`}>
            {m.slideCount} slide{m.slideCount === 1 ? "" : "s"}
          </span>
          {m.exerciseCount > 0 && (
            <span className={`px-2.5 py-1 rounded-lg ${a.chip}`}>
              {m.passed}/{m.exerciseCount} task{m.exerciseCount === 1 ? "" : "s"}
            </span>
          )}
          {/* ⚠ Said out loud rather than left to be discovered at the end of a course. */}
          {!m.canOpenPanel && (
            <span className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
              You cannot open this panel yet
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500 font-semibold">
          {isAdmin ? "Nothing written yet — open it to start the course" : "Not written yet"}
        </p>
      )}
    </Link>
  )
}
