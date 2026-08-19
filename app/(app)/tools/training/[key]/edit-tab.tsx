"use client"

import { useState, useTransition } from "react"
import TrainingSlideView from "@/components/training-slide"
import {
  saveTrainingSlide, deleteTrainingSlide, moveTrainingSlide,
  saveTrainingExercise, deleteTrainingExercise, saveTrainingModule,
} from "@/lib/actions/training"
import { SLIDE_LAYOUTS, SLIDE_GRAPHICS, EXERCISE_KINDS, ADMIN_CENTRE_PANELS, parseParams } from "@/lib/training"
import { CARD } from "@/lib/training-ui"
import type { TrainingModuleRow, TrainingSlideRow, TrainingExerciseRow } from "@/lib/training-data"

// Writing the course. Admin only — the actions check it again server-side, because a client
// that hides a button has not enforced anything.
//
// ⚠ The slide body is plain text, exactly as in the induction editor: a blank line starts a
// paragraph, "- " makes a bullet, and a short line with no full stop becomes a heading. No
// markup to learn, because the people who will keep this up to date are not developers.

const INP = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
const LBL = "block text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5"
const BTN = "px-4 py-2.5 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold"
const GHOST = "px-4 py-2.5 min-h-[44px] rounded-xl border-2 border-gray-200 dark:border-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200"

export default function EditTab({
  module: m, slides, exercises,
}: {
  module: TrainingModuleRow
  slides: TrainingSlideRow[]
  exercises: TrainingExerciseRow[]
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const [slide, setSlide] = useState<TrainingSlideRow | "NEW" | null>(null)
  const [task, setTask] = useState<TrainingExerciseRow | "NEW" | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null)
    start(async () => {
      const res = await fn()
      setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: res.error ?? "Failed" })
    })
  }

  return (
    <div className="space-y-6">
      {msg && (
        <div className={`rounded-xl border-2 p-4 text-sm font-semibold ${
          msg.ok
            ? "border-green-500/50 bg-green-50 dark:bg-green-500/10 text-green-800 dark:text-green-300"
            : "border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300"
        }`}>
          {msg.text}
        </div>
      )}

      {/* ── The course itself ── */}
      <div className={`${CARD} p-6`}>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">The course</h2>
        <form action={fd => run(() => saveTrainingModule(fd), "Course saved")} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={m.id} />
          <label className="block">
            <span className={LBL}>Title</span>
            <input name="title" defaultValue={m.title} className={INP} />
          </label>
          <label className="block">
            <span className={LBL}>Icon</span>
            <input name="icon" defaultValue={m.icon} className={INP} />
          </label>
          <label className="block sm:col-span-2">
            <span className={LBL}>What this course is for</span>
            <textarea name="blurb" defaultValue={m.blurb ?? ""} rows={2} className={INP} />
          </label>
          <label className="block">
            <span className={LBL}>The panel it teaches</span>
            <input name="href" defaultValue={m.href ?? ""} placeholder="/tools/lot-lookup" className={INP} />
          </label>
          <label className="block">
            <span className={LBL}>Colour</span>
            <input name="accent" defaultValue={m.accent} className={INP} />
          </label>
          <label className="flex items-center gap-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <input type="checkbox" name="active" defaultChecked={m.active} className="w-5 h-5 accent-indigo-600" />
            Show this course to everyone
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={pending} className={BTN}>Save the course</button>
          </div>
        </form>
      </div>

      {/* ── Slides ── */}
      <div className={`${CARD} p-6`}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Slides <span className="text-gray-400 dark:text-gray-500 font-normal">({slides.length})</span>
          </h2>
          <button onClick={() => setSlide("NEW")} className={BTN}>+ Add a slide</button>
        </div>

        {slides.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">
            No slides yet. A course usually opens with a title slide, then one idea per slide.
          </p>
        ) : (
          <ol className="space-y-2">
            {slides.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3">
                <span className="text-sm tabular-nums text-gray-400 w-6 shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className={`font-semibold truncate ${s.active ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-gray-500 line-through"}`}>
                    {s.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {s.layout}{s.graphic !== "NONE" ? ` · ${s.graphic}` : ""}{s.tryHref ? " · has a Try it button" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => run(() => moveTrainingSlide(s.id, "up", m.key), "Moved")} disabled={pending || i === 0}
                    className="px-3 py-2 min-h-[44px] rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-25" aria-label="Move up">↑</button>
                  <button onClick={() => run(() => moveTrainingSlide(s.id, "down", m.key), "Moved")} disabled={pending || i === slides.length - 1}
                    className="px-3 py-2 min-h-[44px] rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-25" aria-label="Move down">↓</button>
                  <button onClick={() => setSlide(s)} className={GHOST}>Edit</button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── Practice tasks ── */}
      <div className={`${CARD} p-6`}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Practice tasks <span className="text-gray-400 dark:text-gray-500 font-normal">({exercises.length})</span>
          </h2>
          <button onClick={() => setTask("NEW")} className={BTN}>+ Add a task</button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-3xl leading-relaxed">
          Prefer the live task types. They pick a real record when the task is handed out and work the
          answer out from the database, so they cannot ask about a lot that has since been deleted.
          A typed-in answer goes stale exactly the way a printed worksheet does.
        </p>

        {exercises.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No tasks yet.</p>
        ) : (
          <ol className="space-y-2">
            {exercises.map((e, i) => (
              <li key={e.id} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3">
                <span className="text-sm tabular-nums text-gray-400 w-6 shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className={`font-semibold truncate ${e.active ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-gray-500 line-through"}`}>
                    {e.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{e.kind} · {e.brief}</p>
                </div>
                <button onClick={() => setTask(e)} className={`${GHOST} shrink-0`}>Edit</button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {slide && (
        <SlideEditor
          module={m}
          slide={slide === "NEW" ? null : slide}
          pending={pending}
          onClose={() => setSlide(null)}
          onSave={fd => { run(() => saveTrainingSlide(fd), "Slide saved"); setSlide(null) }}
          onDelete={id => { run(() => deleteTrainingSlide(id, m.key), "Slide deleted"); setSlide(null) }}
        />
      )}

      {task && (
        <TaskEditor
          module={m}
          task={task === "NEW" ? null : task}
          pending={pending}
          onClose={() => setTask(null)}
          onSave={fd => { run(() => saveTrainingExercise(fd), "Task saved"); setTask(null) }}
          onDelete={id => { run(() => deleteTrainingExercise(id, m.key), "Task deleted"); setTask(null) }}
        />
      )}
    </div>
  )
}

// ─── Slide editor ────────────────────────────────────────────────────────────

function SlideEditor({
  module: m, slide, pending, onClose, onSave, onDelete,
}: {
  module: TrainingModuleRow
  slide: TrainingSlideRow | null
  pending: boolean
  onClose: () => void
  onSave: (fd: FormData) => void
  onDelete: (id: string) => void
}) {
  // Live preview. The induction editor proved this earns its place: a body-text convention you
  // cannot see the result of is a convention people get wrong every time.
  const [draft, setDraft] = useState<TrainingSlideRow>(slide ?? {
    id: "", title: "", subtitle: null, body: null, imageKey: null, videoUrl: null,
    layout: "CONTENT", graphic: "NONE", tryHref: null, tryLabel: null, notes: null,
    sortOrder: 0, active: true,
  })

  return (
    <Modal title={slide ? "Edit slide" : "New slide"} onClose={onClose} wide>
      <form action={onSave} className="grid gap-5 lg:grid-cols-2">
        <input type="hidden" name="id" value={slide?.id ?? ""} />
        <input type="hidden" name="moduleId" value={m.id} />
        <input type="hidden" name="moduleKey" value={m.key} />

        <div className="space-y-4">
          <label className="block">
            <span className={LBL}>Title</span>
            <input name="title" defaultValue={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} className={INP} autoFocus />
          </label>
          <label className="block">
            <span className={LBL}>Subtitle</span>
            <input name="subtitle" defaultValue={draft.subtitle ?? ""} onChange={e => setDraft({ ...draft, subtitle: e.target.value })} className={INP} />
          </label>
          <label className="block">
            <span className={LBL}>Body</span>
            <textarea
              name="body" rows={12} defaultValue={draft.body ?? ""}
              onChange={e => setDraft({ ...draft, body: e.target.value })}
              className={`${INP} font-mono text-xs leading-relaxed`}
            />
            <span className="block text-xs text-gray-400 dark:text-gray-500 mt-1.5 leading-relaxed">
              A blank line starts a paragraph. A line beginning &quot;- &quot; is a bullet. A short line with
              no full stop becomes a heading.
            </span>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className={LBL}>Layout</span>
              <select name="layout" defaultValue={draft.layout} onChange={e => setDraft({ ...draft, layout: e.target.value })} className={INP}>
                {SLIDE_LAYOUTS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={LBL}>Graphic</span>
              <select name="graphic" defaultValue={draft.graphic} onChange={e => setDraft({ ...draft, graphic: e.target.value })} className={INP}>
                {SLIDE_GRAPHICS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className={LBL}>&quot;Try it&quot; link</span>
              <input name="tryHref" defaultValue={draft.tryHref ?? ""} placeholder={m.href ?? "/tools/…"} className={INP} />
            </label>
            <label className="block">
              <span className={LBL}>Button wording</span>
              <input name="tryLabel" defaultValue={draft.tryLabel ?? ""} placeholder="Try it now" className={INP} />
            </label>
          </div>
          <label className="block">
            <span className={LBL}>Video (YouTube)</span>
            <input name="videoUrl" defaultValue={draft.videoUrl ?? ""} className={INP} />
          </label>
          <label className="block">
            <span className={LBL}>Presenter notes — never shown on the slide</span>
            <textarea name="notes" rows={3} defaultValue={draft.notes ?? ""} className={INP} />
          </label>
          <label className="flex items-center gap-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <input type="checkbox" name="active" defaultChecked={draft.active} className="w-5 h-5 accent-indigo-600" />
            In the deck
          </label>
        </div>

        <div className="space-y-4">
          <p className={LBL}>Preview</p>
          <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 p-6 bg-white dark:bg-[#1C1C1E] min-h-[300px]">
            {/* showTry off — a link out of a half-written slide loses the edit. */}
            <TrainingSlideView slide={draft} showTry={false} />
          </div>
        </div>

        <div className="lg:col-span-2 flex items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          {slide ? (
            <button
              type="button"
              onClick={() => { if (confirm("Delete this slide permanently?")) onDelete(slide.id) }}
              className="text-sm font-semibold text-red-600 hover:underline px-2 py-2 min-h-[44px]"
            >
              Delete slide
            </button>
          ) : <span />}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className={GHOST}>Cancel</button>
            <button type="submit" disabled={pending} className={BTN}>Save slide</button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

// ─── Task editor ─────────────────────────────────────────────────────────────

function TaskEditor({
  module: m, task, pending, onClose, onSave, onDelete,
}: {
  module: TrainingModuleRow
  task: TrainingExerciseRow | null
  pending: boolean
  onClose: () => void
  onSave: (fd: FormData) => void
  onDelete: (id: string) => void
}) {
  const existing = parseParams(task?.params)
  const [kind, setKind] = useState(task?.kind ?? "WHO_CATALOGUED")
  const [mode, setMode] = useState(existing.mode ?? "PICK")
  const spec = EXERCISE_KINDS.find(k => k.key === kind)

  return (
    <Modal title={task ? "Edit task" : "New task"} onClose={onClose}>
      <form action={onSave} className="space-y-4">
        <input type="hidden" name="id" value={task?.id ?? ""} />
        <input type="hidden" name="moduleId" value={m.id} />
        <input type="hidden" name="moduleKey" value={m.key} />

        <label className="block">
          <span className={LBL}>Title</span>
          <input name="title" defaultValue={task?.title ?? ""} className={INP} autoFocus />
        </label>

        <label className="block">
          <span className={LBL}>Type of task</span>
          <select name="kind" value={kind} onChange={e => setKind(e.target.value)} className={INP}>
            {EXERCISE_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          {spec && <span className="block text-xs text-gray-400 dark:text-gray-500 mt-1.5">{spec.blurb}</span>}
        </label>

        <label className="block">
          <span className={LBL}>What they are asked to do</span>
          <textarea name="brief" rows={3} defaultValue={task?.brief ?? ""} className={INP} />
          <span className="block text-xs text-gray-400 dark:text-gray-500 mt-1.5">
            Write <code>{"{{q}}"}</code> where the receipt, barcode or sale should appear — it is filled in
            with a real one each time the task is handed out.
          </span>
        </label>

        {spec?.live && (
          <>
            <label className="block">
              <span className={LBL}>Which example</span>
              <select name="mode" value={mode} onChange={e => setMode(e.target.value as "PICK" | "FIXED")} className={INP}>
                <option value="PICK">Pick a real one each time (recommended)</option>
                <option value="FIXED">Always this one</option>
              </select>
            </label>
            {mode === "FIXED" && (
              <label className="block">
                <span className={LBL}>⚠ The number to pin it to — this will go stale</span>
                <input name="fixedQ" defaultValue={existing.q ?? ""} className={INP} />
              </label>
            )}
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={LBL}>Search by</span>
                <select name="type" defaultValue={existing.type ?? "receipt"} className={INP}>
                  <option value="receipt">Receipt number</option>
                  <option value="tote">Tote number</option>
                  <option value="vendor">Customer number</option>
                </select>
              </label>
              <label className="block">
                <span className={LBL}>Smallest example to use</span>
                <input name="min" type="number" min={1} defaultValue={existing.min ?? 2} className={INP} />
              </label>
            </div>
          </>
        )}

        {kind === "CHOICE" && (
          <div className="space-y-3">
            <span className={LBL}>Options — tick the right one</span>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <input
                  type="radio" name="correct" value={i}
                  defaultChecked={(existing.correct ?? 0) === i}
                  className="w-5 h-5 accent-indigo-600 shrink-0"
                />
                <input name={`option${i}`} defaultValue={existing.options?.[i] ?? ""} placeholder={`Option ${i + 1}`} className={INP} />
              </div>
            ))}
          </div>
        )}

        {kind === "FREE_TEXT" && (
          <label className="block">
            <span className={LBL}>⚠ The answer to mark against — fixed, so keep it to something that cannot change</span>
            <input name="expectedAnswer" defaultValue={existing.q ?? ""} className={INP} />
          </label>
        )}

        <label className="block">
          <span className={LBL}>Which tab to open beside it</span>
          <select name="panel" defaultValue={task?.panel ?? ""} className={INP}>
            <option value="">None — no panel beside the task</option>
            {ADMIN_CENTRE_PANELS.map(p => <option key={p.key} value={p.key}>{p.icon} {p.label}</option>)}
          </select>
        </label>

        <label className="block">
          <span className={LBL}>Hint, shown if they ask for it</span>
          <textarea name="hint" rows={2} defaultValue={task?.hint ?? ""} className={INP} />
        </label>

        <label className="block">
          <span className={LBL}>Explanation, shown once they have answered</span>
          <textarea name="explain" rows={3} defaultValue={task?.explain ?? ""} className={INP} />
        </label>

        <label className="flex items-center gap-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
          <input type="checkbox" name="active" defaultChecked={task?.active ?? true} className="w-5 h-5 accent-indigo-600" />
          Set this task
        </label>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
          {task ? (
            <button
              type="button"
              onClick={() => { if (confirm("Delete this task permanently?")) onDelete(task.id) }}
              className="text-sm font-semibold text-red-600 hover:underline px-2 py-2 min-h-[44px]"
            >
              Delete task
            </button>
          ) : <span />}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className={GHOST}>Cancel</button>
            <button type="submit" disabled={pending} className={BTN}>Save task</button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function Modal({
  title, onClose, children, wide = false,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div
        className={`bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl w-full my-8 ${wide ? "max-w-6xl" : "max-w-2xl"}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="px-3 py-2 min-h-[44px] text-gray-400 hover:text-gray-900 dark:hover:text-white text-xl" aria-label="Close">✕</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
