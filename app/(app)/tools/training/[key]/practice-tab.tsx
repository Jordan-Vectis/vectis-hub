"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { accent, CARD, INPUT } from "@/lib/training-ui"
import { panelLabel } from "@/lib/training"
import { embedFor } from "../panel-embeds"
import TrainingSignOff from "@/components/training-sign-off"
import type { TrainingExerciseRow } from "@/lib/training-data"

// "Now you do it." The task on the left, the REAL panel on the right.
//
// ⚠ The task text is filled in by the server from live data — "look up F066001" names a lot
// that exists right now — and the answer is worked out from the same tables the panel reads.
// Nothing is stored as "the answer" anywhere, which is what stops these going stale the way a
// printed worksheet does.

type Task = {
  id: string
  title: string
  kind: string
  panel: string | null
  brief: string
  hint: string | null
  subject: string
  options?: string[]
  unavailable?: string
}

type Marked = {
  correct: boolean
  answer: string
  detail: string | null
  unavailable: boolean
  explain: string | null
  progress: { passed: number; total: number; completed: boolean } | null
}

export default function PracticeTab({
  moduleId, moduleKey, moduleTitle, accentName, exercises, panelHref, canOpenPanel,
  passedIds, alreadySigned, userName,
}: {
  moduleId: string
  moduleKey: string
  moduleTitle: string
  accentName: string
  exercises: TrainingExerciseRow[]
  panelHref: string | null
  canOpenPanel: boolean
  passedIds: string[]
  alreadySigned: boolean
  userName: string
}) {
  const a = accent(accentName)
  const [at, setAt] = useState(0)
  const [passed, setPassed] = useState<Set<string>>(new Set(passedIds))
  const [signed, setSigned] = useState(alreadySigned)
  // ⚠ Separate from `signed`. Somebody who closes the popup with "Not now" should not have it
  // reappear on the next answer of the same sitting — it offers itself again next visit.
  const [signOffOpen, setSignOffOpen] = useState(false)
  const [signOffDismissed, setDismissed] = useState(false)

  /**
   * Jump to a random task — the "come back to it next week" button.
   *
   * ⚠ Prefers one you have NOT passed. Somebody returning to practise is trying to find the
   * gaps, and a shuffle that keeps landing on the three they already know is a shuffle they
   * stop pressing. Falls back to any task once they have passed the lot, and never hands back
   * the one already on screen.
   */
  function shuffle() {
    const pool = exercises.map((e, n) => ({ e, n })).filter(x => x.n !== at)
    if (!pool.length) return
    const unseen = pool.filter(x => !passed.has(x.e.id))
    const from   = unseen.length ? unseen : pool
    setAt(from[Math.floor(Math.random() * from.length)].n)
  }

  if (exercises.length === 0) {
    return (
      <div className={`${CARD} p-10 text-center`}>
        <p className="text-xl font-semibold text-gray-900 dark:text-white">No practice tasks yet.</p>
        <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-xl mx-auto">
          Reading a deck is not the same as being able to use a panel. An admin can add the first task
          on the Edit tab.
        </p>
      </div>
    )
  }

  const ex = exercises[Math.min(at, exercises.length - 1)]

  return (
    <div className="space-y-5">
      {/* Every task sets itself from live data, so this is worth saying once at the top —
          otherwise somebody who did this last month assumes they are about to repeat it. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-gray-200 dark:border-gray-800 px-5 py-4">
        <p className="text-sm text-gray-600 dark:text-gray-300 max-w-3xl leading-relaxed">
          🎲 Every task picks a <strong>real lot from this system</strong> when you open it, so you get a
          different question each time. Come back as often as you like — and press <strong>Give me another</strong>
          {" "}on any task to be set the same question about a different lot.
        </p>
        <button
          onClick={shuffle}
          disabled={exercises.length < 2}
          className={`px-6 py-3 min-h-[44px] rounded-xl ${a.btn} text-white text-sm font-bold shrink-0 disabled:opacity-40`}
        >
          🎲 Surprise me
        </button>
      </div>

      {/* Task rail — how many, which one, which are done */}
      <div className="flex flex-wrap items-center gap-2">
        {exercises.map((e, n) => {
          const done = passed.has(e.id)
          return (
            <button
              key={e.id}
              onClick={() => setAt(n)}
              className={`px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold border-2 transition ${
                n === at
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                  : done
                    ? "border-green-500/60 text-green-700 dark:text-green-400"
                    : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
              }`}
            >
              {done ? "✓ " : ""}{n + 1}. {e.title}
            </button>
          )
        })}
        <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto tabular-nums">
          {passed.size} of {exercises.length} done
        </span>
      </div>

      {signed && (
        <div className="rounded-xl border-2 border-green-500/50 bg-green-50 dark:bg-green-500/10 px-4 py-3 text-sm font-semibold text-green-800 dark:text-green-300">
          ✓ You have signed to say you have been trained on this. Your signature is on file.
        </div>
      )}

      {/* Finished everything but not signed — the popup only fires on the answer that completes
          the course, so somebody returning later needs a way back to it. */}
      {!signed && exercises.length > 0 && passed.size >= exercises.length && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-green-500/50 bg-green-50 dark:bg-green-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-green-800 dark:text-green-300">
            🎓 Every task passed — sign to record that you have been trained on this.
          </p>
          <button
            onClick={() => setSignOffOpen(true)}
            className="ml-auto px-5 py-2.5 min-h-[44px] rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-bold"
          >
            Sign it off
          </button>
        </div>
      )}

      <TaskPane
        key={ex.id}
        exerciseId={ex.id}
        moduleKey={moduleKey}
        accentBtn={a.btn}
        panelHref={panelHref}
        canOpenPanel={canOpenPanel}
        alreadyPassed={passed.has(ex.id)}
        onPassed={() => setPassed(p => new Set(p).add(ex.id))}
        onCompleted={() => { if (!signed && !signOffDismissed) setSignOffOpen(true) }}
        onNext={at < exercises.length - 1 ? () => setAt(at + 1) : null}
      />

      {signOffOpen && (
        <TrainingSignOff
          moduleId={moduleId}
          moduleTitle={moduleTitle}
          tasksPassed={passed.size}
          tasksTotal={exercises.length}
          userName={userName}
          onClose={() => { setSignOffOpen(false); setDismissed(true) }}
          onSigned={() => { setSignOffOpen(false); setSigned(true) }}
        />
      )}
    </div>
  )
}

function TaskPane({
  exerciseId, moduleKey, accentBtn, panelHref, canOpenPanel, alreadyPassed, onPassed, onCompleted, onNext,
}: {
  exerciseId: string
  moduleKey: string
  accentBtn: string
  panelHref: string | null
  canOpenPanel: boolean
  alreadyPassed: boolean
  onPassed: () => void
  onCompleted: () => void
  onNext: (() => void) | null
}) {
  const [task, setTask] = useState<Task | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [answer, setAnswer] = useState("")
  const [choice, setChoice] = useState<number | null>(null)
  const [marking, setMarking] = useState(false)
  const [result, setResult] = useState<Marked | null>(null)
  const [showHint, setShowHint] = useState(false)

  const load = useCallback(async () => {
    setTask(null); setLoadError(null); setResult(null); setAnswer(""); setChoice(null); setShowHint(false)
    try {
      const res  = await fetch(`/api/training/practice?id=${encodeURIComponent(exerciseId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setTask(json)
    } catch (e: any) { setLoadError(e.message) }
  }, [exerciseId])

  useEffect(() => { load() }, [load])

  async function submit() {
    if (!task || marking) return
    const given = task.kind === "CHOICE" ? (choice === null ? "" : String(choice)) : answer.trim()
    if (!given) return
    setMarking(true)
    try {
      const res = await fetch("/api/training/practice", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id: task.id, subject: task.subject, answer: given }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setResult(json)
      if (json.correct) onPassed()
      if (json.correct && json.progress?.completed) onCompleted()
    } catch (e: any) {
      setLoadError(e.message)
    } finally { setMarking(false) }
  }

  const Embed = embedFor(moduleKey)
  const useButton = task ? panelLabel(task.panel) : ""

  return (
    <div className={`grid gap-5 ${Embed && canOpenPanel ? "xl:grid-cols-[minmax(380px,460px)_minmax(0,1fr)]" : ""} items-start`}>
      {/* ── The task ── */}
      <div className={`${CARD} p-6 xl:sticky xl:top-4`}>
        {loadError && (
          <div className="mb-4 rounded-xl border-2 border-red-500/40 bg-red-50 dark:bg-red-500/10 p-4 text-red-800 dark:text-red-300">
            {loadError}
          </div>
        )}

        {!task && !loadError && <p className="text-gray-500 dark:text-gray-400">Setting the task…</p>}

        {task && (
          <>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">{task.title}</h3>
              {alreadyPassed && (
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300">
                  ✓ Done before
                </span>
              )}
            </div>

            <p className="text-lg text-gray-700 dark:text-gray-200 leading-relaxed">{task.brief}</p>

            {/* Which of the five buttons to press. The Admin Centre is one page with a single
                search, so this is a nudge rather than a different screen to open. */}
            {useButton && (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                Use the <strong className="text-gray-700 dark:text-gray-200">{useButton}</strong> option
              </p>
            )}

            {/* ⚠ An environment with no matching data says so, rather than asking a question
                about nothing and letting the trainee think they got it wrong. */}
            {task.unavailable ? (
              <div className="mt-5 rounded-xl border-2 border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200">
                {task.unavailable}
              </div>
            ) : (
              <>
                <div className="mt-5 space-y-3">
                  {task.kind === "CHOICE" ? (
                    (task.options ?? []).map((opt, n) => (
                      <button
                        key={n}
                        onClick={() => setChoice(n)}
                        disabled={!!result}
                        className={`w-full text-left px-5 py-4 min-h-[44px] rounded-xl border-2 text-base transition ${
                          choice === n
                            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-800 dark:text-indigo-200 font-semibold"
                            : "border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-700"
                        } disabled:opacity-70`}
                      >
                        {opt}
                      </button>
                    ))
                  ) : (
                    <input
                      value={answer}
                      onChange={e => setAnswer(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") submit() }}
                      disabled={!!result}
                      placeholder="Your answer…"
                      className={INPUT}
                    />
                  )}
                </div>

                {!result && (
                  <div className="flex flex-wrap items-center gap-3 mt-4">
                    <button
                      onClick={submit}
                      disabled={marking || (task.kind === "CHOICE" ? choice === null : !answer.trim())}
                      className={`px-8 py-3.5 min-h-[44px] rounded-xl ${accentBtn} text-white text-base font-semibold disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {marking ? "Checking…" : "Check my answer"}
                    </button>
                    {task.hint && (
                      <button
                        onClick={() => setShowHint(v => !v)}
                        className="text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-3 py-2 min-h-[44px]"
                      >
                        {showHint ? "Hide the hint" : "💡 I'm stuck"}
                      </button>
                    )}
                  </div>
                )}

                {showHint && task.hint && !result && (
                  <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 leading-relaxed">
                    {task.hint}
                  </p>
                )}
              </>
            )}

            {result && <Verdict result={result} accentBtn={accentBtn} onRetry={load} onNext={onNext} />}
          </>
        )}
      </div>

      {/* ── The panel itself ── */}
      {Embed && canOpenPanel && (
        <div className={`${CARD} p-5 min-w-0`}>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500 mb-4">
            The real panel — work in here
          </p>
          <Embed />
        </div>
      )}

      {/* Not a mock-up and not a screenshot, so there is nothing to fall back to. Say what is
          missing and who fixes it, rather than rendering a dead box. */}
      {Embed && !canOpenPanel && (
        <div className={`${CARD} p-8`}>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            You do not have access to this panel yet
          </p>
          <p className="text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
            The practice tasks run the real thing rather than a copy of it, so they need the same
            permission the panel does. Ask an admin to grant it in Admin → Users &amp; Permissions,
            then come back. You can still read the deck in the meantime.
          </p>
          {panelHref && (
            <Link href={panelHref} className="inline-block mt-4 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
              {panelHref}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function Verdict({
  result, accentBtn, onRetry, onNext,
}: {
  result: Marked
  accentBtn: string
  onRetry: () => void
  onNext: (() => void) | null
}) {
  if (result.unavailable) {
    return (
      <div className="mt-5 rounded-xl border-2 border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-5">
        <p className="font-bold text-amber-800 dark:text-amber-200">That could not be checked.</p>
        <p className="text-sm text-amber-800/90 dark:text-amber-200/90 mt-1 leading-relaxed">
          The record this task was set on has changed or been deleted since it was handed out. That is
          not your answer being wrong — take a fresh one.
        </p>
        <button onClick={onRetry} className={`mt-4 px-6 py-3 min-h-[44px] rounded-xl ${accentBtn} text-white font-semibold`}>
          Set me a new one
        </button>
      </div>
    )
  }

  return (
    <div
      className={`mt-5 rounded-xl border-2 p-5 ${
        result.correct
          ? "border-green-500/50 bg-green-50 dark:bg-green-500/10"
          : "border-red-500/40 bg-red-50 dark:bg-red-500/10"
      }`}
    >
      <p className={`text-lg font-bold ${result.correct ? "text-green-800 dark:text-green-300" : "text-red-800 dark:text-red-300"}`}>
        {result.correct ? "✓ That's right" : "✗ Not quite"}
      </p>

      {!result.correct && (
        <p className="text-base text-gray-800 dark:text-gray-100 mt-2">
          The answer was <strong>{result.answer}</strong>
          {result.detail ? <span className="text-gray-500 dark:text-gray-400"> — {result.detail}</span> : null}
        </p>
      )}
      {result.correct && result.detail && (
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{result.detail}</p>
      )}

      {result.explain && (
        <p className="text-sm text-gray-700 dark:text-gray-200 mt-3 leading-relaxed">{result.explain}</p>
      )}

      {result.progress && (
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-3 tabular-nums">
          {result.progress.passed} of {result.progress.total} tasks done
          {result.progress.completed ? " — course completed 🎉" : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-3 mt-4">
        <button
          onClick={onRetry}
          className="px-6 py-3 min-h-[44px] rounded-xl border-2 border-gray-200 dark:border-gray-800 font-semibold text-gray-700 dark:text-gray-200"
        >
          {result.correct ? "Give me another" : "Try another one"}
        </button>
        {onNext && (
          <button onClick={onNext} className={`px-6 py-3 min-h-[44px] rounded-xl ${accentBtn} text-white font-semibold`}>
            Next task →
          </button>
        )}
      </div>
    </div>
  )
}
