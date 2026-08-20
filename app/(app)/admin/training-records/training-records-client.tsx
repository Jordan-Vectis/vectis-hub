"use client"

import { useMemo, useState } from "react"

export type SignatureRow = {
  id: string
  userName: string
  userEmail: string | null
  moduleKey: string
  moduleTitle: string
  slidesTotal: number
  tasksTotal: number
  tasksPassed: number
  declaration: string
  signature: string
  signedAt: string
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
})

export default function TrainingRecordsClient({ rows }: { rows: SignatureRow[] }) {
  const [q, setQ] = useState("")
  const [course, setCourse] = useState("")
  const [open, setOpen] = useState<SignatureRow | null>(null)

  const courses = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) m.set(r.moduleKey, r.moduleTitle)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (course && r.moduleKey !== course) return false
      if (!needle) return true
      return r.userName.toLowerCase().includes(needle)
        || (r.userEmail ?? "").toLowerCase().includes(needle)
        || r.moduleTitle.toLowerCase().includes(needle)
    })
  }, [rows, q, course])

  // How many DIFFERENT people have signed each course — the question a manager actually asks.
  // ⚠ Not a row count: signing again after a course is updated is normal and expected, so
  // counting rows would report the same person twice and overstate coverage.
  const perCourse = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const r of rows) {
      const set = m.get(r.moduleTitle) ?? new Set<string>()
      set.add(r.userName)
      m.set(r.moduleTitle, set)
    }
    return [...m.entries()].map(([title, people]) => ({ title, people: people.size }))
      .sort((a, b) => b.people - a.people)
  }, [rows])

  const input = "rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"

  if (rows.length === 0) {
    return (
      <div className="mt-6 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-2xl p-10 text-center">
        <p className="text-lg font-semibold text-gray-900 dark:text-white">Nothing signed yet.</p>
        <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-xl mx-auto">
          People sign at the end of a course, once every practice task is passed. If this is a fresh
          deploy, an admin needs to press Run Migrations first.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Who has covered what */}
      <div className="mt-6 flex flex-wrap gap-2">
        {perCourse.map(c => (
          <span key={c.title} className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200">
            {c.title} — <strong className="tabular-nums">{c.people}</strong> {c.people === 1 ? "person" : "people"}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search a name or a course…"
          className={`${input} w-72`}
        />
        <select value={course} onChange={e => setCourse(e.target.value)} className={input}>
          <option value="">All courses</option>
          {courses.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
        </select>
        <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums ml-auto">
          {shown.length} of {rows.length} signature{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Who</th>
                <th className="text-left px-5 py-3 font-semibold">Course</th>
                <th className="text-left px-5 py-3 font-semibold">Tasks</th>
                <th className="text-left px-5 py-3 font-semibold">Signed</th>
                <th className="text-left px-5 py-3 font-semibold">Signature</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {shown.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <td className="px-5 py-3">
                    <span className="font-semibold text-gray-900 dark:text-white">{r.userName}</span>
                    {r.userEmail && <span className="block text-xs text-gray-500 dark:text-gray-400">{r.userEmail}</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{r.moduleTitle}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300 tabular-nums">
                    {r.tasksPassed} / {r.tasksTotal}
                  </td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{when(r.signedAt)}</td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => setOpen(r)}
                      className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setOpen(null)}>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl w-full max-w-2xl my-8 border border-gray-200 dark:border-gray-800" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{open.userName}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {open.moduleTitle} · {when(open.signedAt)}
                </p>
              </div>
              <button onClick={() => setOpen(null)} className="px-3 py-2 min-h-[44px] text-gray-500 hover:text-gray-900 dark:hover:text-white text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* ⚠ The declaration as SIGNED, read off the row — not rebuilt from today's wording. */}
              <div className="rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">What they signed</p>
                <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{open.declaration}</p>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {open.tasksPassed} of {open.tasksTotal} practice tasks passed
                {open.slidesTotal > 0 ? ` · ${open.slidesTotal} slides in the course at the time` : ""}
              </p>
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">Signature</p>
                {/* White ground on purpose — the signature is drawn in near-black ink and would
                    be invisible on the dark theme otherwise. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={open.signature} alt={`${open.userName}'s signature`} className="w-full rounded-xl bg-white border border-gray-200 dark:border-gray-700" />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
