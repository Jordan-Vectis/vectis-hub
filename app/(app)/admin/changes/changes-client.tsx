"use client"

// Admin → Patches & Changes.
// Left: the record of what has gone in. Right: reports written from it.
// The AI writes a first draft for a manager; you edit it before it goes anywhere.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { saveChangeReport, deleteChangeReport } from "@/lib/actions/changes"

type Change = {
  id: string; sha: string; subject: string
  author: string | null; committedAt: string; housekeeping: boolean
}
type Report = {
  id: string; title: string; body: string
  periodFrom: string; periodTo: string
  changeCount: number; model: string | null
  createdBy: string | null; createdAt: string
}
type Capture = { source: string; capturedAt: string | null; count: number } | null

const card  = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"
const btn   = "px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
const ghost = `${btn} bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white`
const input = "px-3 py-2 rounded-xl text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"

const RANGES = [
  { days: 7,   label: "7 days" },
  { days: 14,  label: "2 weeks" },
  { days: 30,  label: "30 days" },
  { days: 90,  label: "3 months" },
  { days: 365, label: "1 year" },
]

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export default function ChangesClient({
  notReady, days, from, to, capture, changes, reports,
}: {
  notReady: boolean
  days: number
  from: string
  to: string
  capture: Capture
  changes: Change[]
  reports: Report[]
}) {
  const router = useRouter()
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [note, setNote]     = useState<string | null>(null)
  const [showInternal, setShowInternal] = useState(false)
  const [audience, setAudience] = useState("")
  const [draft, setDraft]   = useState<string | null>(null)
  const [title, setTitle]   = useState("")
  const [usedModel, setUsedModel] = useState<string | null>(null)
  const [openReport, setOpenReport] = useState<Report | null>(null)

  const shown = showInternal ? changes : changes.filter(c => !c.housekeeping)
  const internalCount = changes.length - changes.filter(c => !c.housekeeping).length

  // Group by day so a period reads as a diary rather than one long list.
  const byDay = shown.reduce<Record<string, Change[]>>((acc, c) => {
    const key = c.committedAt.slice(0, 10)
    ;(acc[key] ??= []).push(c)
    return acc
  }, {})

  async function generate() {
    setBusy(true); setError(null); setNote(null)
    try {
      const res  = await fetch("/api/admin/changes/summarise", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, audience }),
      })
      const json = await res.json().catch(() => ({ error: "The server sent something unreadable." }))
      if (!res.ok) { setError(json?.error ?? `Request failed (${res.status})`); return }
      setDraft(json.body)
      setUsedModel(json.model ?? null)
      setTitle(`Hub progress — ${fmtDate(from)} to ${fmtDate(to)}`)
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the server")
    } finally { setBusy(false) }
  }

  async function save() {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      const res = await saveChangeReport({ title, body: draft, from, to, changeCount: shown.length, model: usedModel ?? undefined })
      if (!res.ok) { setError(res.error ?? "Could not save"); return }
      setNote("Report saved.")
      setDraft(null)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the server")
    } finally { setBusy(false) }
  }

  // Posts what is ON SCREEN, so a draft prints with your edits in it and a saved
  // report prints as saved — no need to save first just to print.
  async function downloadPdf(r: { title: string; body: string; periodFrom: string; periodTo: string; changeCount: number }) {
    setBusy(true); setError(null)
    try {
      const res = await fetch("/api/admin/changes/pdf", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? `Couldn't make the PDF (${res.status})`)
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href = url
      a.download = `${r.title}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke on the next tick — Safari cancels the download if it goes too soon.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e: any) {
      setError(e?.message ?? "Couldn't reach the server")
    } finally { setBusy(false) }
  }

  async function remove(id: string) {
    if (!confirm("Delete this saved report?")) return
    setBusy(true); setError(null)
    try {
      const res = await deleteChangeReport(id)
      if (!res.ok) { setError(res.error ?? "Could not delete"); return }
      setOpenReport(null)
      router.refresh()
    } finally { setBusy(false) }
  }

  if (notReady) {
    return (
      <div className={`${card} p-6`}>
        <p className="text-base font-semibold text-gray-900 dark:text-white mb-1">Not switched on yet</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This page needs its database tables creating before it can record anything. Nothing is lost in the meantime —
          the history is captured with each release and will fill in as soon as it&apos;s ready.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      {note  && <Banner tone="ok">{note}</Banner>}

      {/* How complete is this record? Say it plainly rather than letting a short
          list read as "not much happened". */}
      {capture && (capture.source === "git-shallow" || capture.source === "deploy-env" || capture.source === "none") && (
        <Banner tone="warn">
          This release could only record its own headline change, so anything that went out alongside it is missing from the
          list below. Everything up to 13 August is complete. Worth mentioning to IT if it keeps happening.
        </Banner>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-5 items-start">
        {/* ── The record ───────────────────────────────────────────────── */}
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">What&apos;s gone in</h2>
            <div className="flex gap-1 bg-gray-100 dark:bg-[#2C2C2E] rounded-xl p-1">
              {RANGES.map(r => (
                <button
                  key={r.days}
                  onClick={() => router.push(`/admin/changes?days=${r.days}`)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    days === r.days ? "bg-indigo-600 text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 dark:text-gray-400 mb-3">
            <span><strong className="text-gray-800 dark:text-gray-200">{shown.length}</strong> changes · {fmtDate(from)} to {fmtDate(to)}</span>
            {internalCount > 0 && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={showInternal} onChange={e => setShowInternal(e.target.checked)} />
                Show {internalCount} internal {internalCount === 1 ? "entry" : "entries"} (notes, tidying)
              </label>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Nothing recorded in this period.</p>
          ) : (
            <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
              {Object.entries(byDay).map(([day, rows]) => (
                <div key={day}>
                  <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-1.5">
                    {fmtDay(day)} <span className="text-gray-400 font-normal normal-case">· {rows.length}</span>
                  </p>
                  <ul className="space-y-1">
                    {rows.map(c => (
                      <li key={c.id} className="flex items-baseline gap-2 text-sm">
                        <span className={c.housekeeping ? "text-gray-400 dark:text-gray-500" : "text-gray-700 dark:text-gray-200"}>
                          {c.subject}
                        </span>
                        {c.author && <span className="text-xs text-gray-400 shrink-0 ml-auto">{c.author.split(" ")[0]}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── The report ───────────────────────────────────────────────── */}
        <div className="space-y-5">
          <div className={`${card} p-4`}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Report for managers</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Writes up all {shown.length} changes above as a log a manager can read — grouped by area, in plain English,
              with no names. Every change is accounted for, so expect a long list. Edit it before it goes anywhere.
            </p>

            {!draft ? (
              <>
                <label className="block mb-3">
                  <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Who&apos;s it for? (optional)</span>
                  <input
                    className={`${input} w-full`}
                    placeholder="e.g. Bryan — interested in the warehouse and cataloguing side"
                    value={audience}
                    onChange={e => setAudience(e.target.value)}
                  />
                </label>
                <button className={`${btn} bg-indigo-600 hover:bg-indigo-700 text-white`} disabled={busy || shown.length === 0} onClick={generate}>
                  {busy ? "Writing…" : "✨ Write the report"}
                </button>
              </>
            ) : (
              <>
                <input className={`${input} w-full mb-2`} value={title} onChange={e => setTitle(e.target.value)} placeholder="Report title" />
                <textarea
                  className={`${input} w-full min-h-[22rem] font-sans leading-relaxed`}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                />
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button className={`${btn} bg-indigo-600 hover:bg-indigo-700 text-white`} disabled={busy} onClick={save}>Save report</button>
                  <button
                    className={ghost}
                    disabled={busy}
                    onClick={() => downloadPdf({ title: title || "Vectis Hub progress report", body: draft, periodFrom: from, periodTo: to, changeCount: shown.length })}
                  >
                    🖨 PDF
                  </button>
                  <button className={ghost} disabled={busy} onClick={() => navigator.clipboard.writeText(draft).then(() => setNote("Copied — paste it straight into an email."))}>Copy</button>
                  <button className={ghost} disabled={busy} onClick={generate}>Rewrite</button>
                  <button className={ghost} disabled={busy} onClick={() => setDraft(null)}>Discard</button>
                  {usedModel && <span className="text-xs text-gray-400 ml-auto">Drafted by {usedModel} — check it before sending.</span>}
                </div>
              </>
            )}
          </div>

          {reports.length > 0 && (
            <div className={`${card} p-4`}>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Saved reports</h2>
              <div className="space-y-2">
                {reports.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setOpenReport(r)}
                    className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 p-3 hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors"
                  >
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {fmtDate(r.periodFrom)} – {fmtDate(r.periodTo)} · {r.changeCount} changes
                      {r.createdBy ? ` · ${r.createdBy}` : ""}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {openReport && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={() => setOpenReport(null)}>
          <div className={`${card} w-full max-w-3xl p-5`} onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{openReport.title}</h2>
              <button onClick={() => setOpenReport(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {fmtDate(openReport.periodFrom)} – {fmtDate(openReport.periodTo)} · {openReport.changeCount} changes
              {openReport.createdBy ? ` · written by ${openReport.createdBy}` : ""}
            </p>
            <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200 leading-relaxed max-h-[55vh] overflow-y-auto font-sans">
              {openReport.body}
            </pre>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              <button
                className={`${btn} bg-indigo-600 hover:bg-indigo-700 text-white`}
                disabled={busy}
                onClick={() => downloadPdf({
                  title: openReport.title, body: openReport.body,
                  periodFrom: openReport.periodFrom, periodTo: openReport.periodTo,
                  changeCount: openReport.changeCount,
                })}
              >
                🖨 PDF
              </button>
              <button className={ghost} onClick={() => navigator.clipboard.writeText(openReport.body).then(() => setNote("Copied."))}>Copy</button>
              <button className={`${btn} ml-auto text-red-500 hover:text-red-700`} disabled={busy} onClick={() => remove(openReport.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Banner({ tone, children }: { tone: "error" | "warn" | "ok"; children: React.ReactNode }) {
  const cls = tone === "error"
    ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300"
    : tone === "warn"
      ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
      : "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300"
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>
}
