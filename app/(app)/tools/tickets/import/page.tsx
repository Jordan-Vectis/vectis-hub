"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

type Category = { id: string; key: string; label: string; active: boolean }

type ParsedTicket = {
  threadKey:      string
  title:          string
  description:    string
  resolutionNote: string
  category:       string
  originalDate:   string
  raisedBy:       string
}

type Selectable = ParsedTicket & { selected: boolean }

export default function TicketImportPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [csvText, setCsvText]       = useState("")
  const [fileName, setFileName]     = useState("")
  const [stage, setStage]           = useState<"upload" | "parsing" | "review" | "committing" | "done">("upload")
  const [tickets, setTickets]       = useState<Selectable[]>([])
  const [meta, setMeta]             = useState<{ skipped: number; threadCount: number; errors?: string[] } | null>(null)
  const [error, setError]           = useState("")
  const [defaultStatus, setDefStat] = useState<"RESOLVED" | "CLOSED" | "OPEN">("RESOLVED")
  const [importedCount, setImportedCount] = useState(0)

  useEffect(() => {
    fetch("/api/ticket-categories")
      .then(r => r.json())
      .then(d => setCategories((d.categories ?? []).filter((c: Category) => c.active)))
      .catch(() => {})
  }, [])

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = ev => setCsvText(String(ev.target?.result ?? ""))
    reader.readAsText(f)
  }

  async function parse() {
    if (!csvText.trim()) { setError("Pick a CSV file first"); return }
    setError("")
    setStage("parsing")
    try {
      const r = await fetch("/api/tickets/import/parse", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          csv:          csvText,
          categoryKeys: categories.map(c => c.key),
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        setError(d.error ?? "Parse failed")
        setStage("upload")
        return
      }
      setTickets((d.tickets ?? []).map((t: ParsedTicket) => ({ ...t, selected: true })))
      setMeta({ skipped: d.skipped ?? 0, threadCount: d.threadCount ?? 0, errors: d.errors })
      setStage("review")
    } catch (e: any) {
      setError(e?.message ?? "Parse failed")
      setStage("upload")
    }
  }

  async function commit() {
    const selected = tickets.filter(t => t.selected)
    if (selected.length === 0) { setError("No tickets selected"); return }
    if (!confirm(`Create ${selected.length} ticket${selected.length === 1 ? "" : "s"} with their original dates? This can't be undone in bulk.`)) return
    setError("")
    setStage("committing")
    try {
      const r = await fetch("/api/tickets/import/commit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tickets: selected, defaultStatus }),
      })
      const d = await r.json()
      if (!r.ok) {
        setError(d.error ?? "Commit failed")
        setStage("review")
        return
      }
      setImportedCount(d.count ?? 0)
      setStage("done")
    } catch (e: any) {
      setError(e?.message ?? "Commit failed")
      setStage("review")
    }
  }

  const selectedCount = useMemo(() => tickets.filter(t => t.selected).length, [tickets])

  function setAll(sel: boolean) {
    setTickets(prev => prev.map(t => ({ ...t, selected: sel })))
  }

  function updateAt<K extends keyof Selectable>(i: number, key: K, val: Selectable[K]) {
    setTickets(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [key]: val }
      return next
    })
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <Link href="/tools/tickets" className="text-sm text-gray-500 hover:text-gray-700">← Tickets</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Import tickets from CSV</h1>
        <p className="text-sm text-gray-500 mt-1">
          Admin only. Back-fills historical tickets from an Outlook CSV export (e.g. the Auction Marketer support folder).
          Gemini reads the email threads and pulls out title, problem, resolution, original date and category.
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {/* ─── Stage: upload ─── */}
      {stage === "upload" && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">1. Pick the CSV file</div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="block text-sm"
            />
            {fileName && (
              <p className="text-xs text-gray-500 mt-1">
                {fileName} ({(csvText.length / 1024).toFixed(0)} KB loaded)
              </p>
            )}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">2. Default status for imported tickets</div>
            <select
              value={defaultStatus}
              onChange={e => setDefStat(e.target.value as any)}
              className="text-sm border border-gray-200 rounded-md px-2 py-1.5"
            >
              <option value="RESOLVED">Resolved (auto-stamps resolvedAt with the original date)</option>
              <option value="CLOSED">Closed</option>
              <option value="OPEN">Open</option>
            </select>
          </div>
          <button
            onClick={parse}
            disabled={!csvText.trim()}
            className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg"
          >
            Parse with Gemini →
          </button>
        </div>
      )}

      {/* ─── Stage: parsing ─── */}
      {stage === "parsing" && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-base font-semibold text-gray-800 mb-2">Reading the CSV…</div>
          <p className="text-sm text-gray-500">Gemini is structuring each email thread. This can take a couple of minutes for big files — don&apos;t leave the tab.</p>
          <div className="mt-4 inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500" />
        </div>
      )}

      {/* ─── Stage: review ─── */}
      {stage === "review" && (
        <div>
          {meta?.errors && meta.errors.length > 0 && (
            <details className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
              <summary className="cursor-pointer font-medium">
                {meta.errors.length} batch warning{meta.errors.length === 1 ? "" : "s"} from Gemini — click to view
              </summary>
              <ul className="mt-2 space-y-0.5 font-mono">
                {meta.errors.map((e, i) => <li key={i}>· {e}</li>)}
              </ul>
            </details>
          )}
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              <strong>{tickets.length}</strong> tickets parsed
              {meta && <> · {meta.skipped} noise rows skipped · {meta.threadCount} threads grouped</>}
              · <strong>{selectedCount}</strong> selected
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAll(true)}  className="text-xs text-gray-600 hover:underline">Select all</button>
              <button onClick={() => setAll(false)} className="text-xs text-gray-600 hover:underline">Deselect all</button>
              <button
                onClick={commit}
                disabled={selectedCount === 0}
                className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
              >
                Import {selectedCount} ticket{selectedCount === 1 ? "" : "s"}
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left w-24">Date</th>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-left">Resolution</th>
                  <th className="px-3 py-2 text-left w-32">Category</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t, i) => (
                  <tr key={i} className="border-t border-gray-100 align-top hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={t.selected}
                        onChange={e => updateAt(i, "selected", e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-700 font-mono">
                      <input
                        type="date"
                        value={t.originalDate}
                        onChange={e => updateAt(i, "originalDate", e.target.value)}
                        className="text-xs border border-transparent hover:border-gray-200 rounded px-1 py-0.5 outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 w-64">
                      <input
                        type="text"
                        value={t.title}
                        onChange={e => updateAt(i, "title", e.target.value)}
                        className="w-full text-xs border border-transparent hover:border-gray-200 rounded px-1 py-0.5 outline-none font-medium"
                      />
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <textarea
                        value={t.description}
                        onChange={e => updateAt(i, "description", e.target.value)}
                        rows={3}
                        className="w-full text-xs border border-transparent hover:border-gray-200 rounded px-1 py-0.5 outline-none resize-y"
                      />
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <textarea
                        value={t.resolutionNote}
                        onChange={e => updateAt(i, "resolutionNote", e.target.value)}
                        rows={3}
                        placeholder="(no resolution found)"
                        className="w-full text-xs border border-transparent hover:border-gray-200 rounded px-1 py-0.5 outline-none resize-y"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={t.category}
                        onChange={e => updateAt(i, "category", e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded px-1 py-0.5"
                      >
                        {categories.map(c => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Stage: committing ─── */}
      {stage === "committing" && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-base font-semibold text-gray-800 mb-2">Importing…</div>
          <div className="mt-4 inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500" />
        </div>
      )}

      {/* ─── Stage: done ─── */}
      {stage === "done" && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-green-900">Imported {importedCount} ticket{importedCount === 1 ? "" : "s"}</h2>
          <p className="text-sm text-green-800 mt-1">
            They&apos;ll appear on the main tickets page with their original dates preserved. The IT Help chatbot will start
            picking them up as sources immediately.
          </p>
          <div className="mt-4 flex gap-2">
            <Link
              href="/tools/tickets"
              className="bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Back to tickets →
            </Link>
            <button
              onClick={() => {
                setCsvText(""); setFileName(""); setTickets([]); setMeta(null); setStage("upload")
              }}
              className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 px-4 py-2 rounded-lg"
            >
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
