"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { parseCsv, rowsToObjects } from "@/lib/csv-parse"

type Ticket = {
  Date:        string
  Title:       string
  Description: string
  FullThread:  string
  Resolution:  string
  Category:    string
  RaisedBy:    string
  TicketNo:    string
  selected:    boolean
  status:      "pending" | "processing" | "done" | "failed"
  warning?:    string
}

type Stage = "upload" | "summarising" | "review" | "committing" | "done"

export default function TicketImportPage() {
  const [csvText, setCsvText]   = useState("")
  const [fileName, setFileName] = useState("")
  const [stage, setStage]       = useState<Stage>("upload")
  const [tickets, setTickets]   = useState<Ticket[]>([])
  const [progress, setProgress] = useState(0)
  const [error, setError]       = useState("")
  const [defaultStatus, setDef] = useState<"RESOLVED" | "CLOSED" | "OPEN">("RESOLVED")
  const [importedCount, setImportedCount] = useState(0)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = ev => setCsvText(String(ev.target?.result ?? ""))
    reader.readAsText(f)
  }

  async function loadAndSummarise() {
    if (!csvText.trim()) { setError("Pick a CSV file first"); return }
    setError("")
    let parsed: Ticket[]
    try {
      const rows    = parseCsv(csvText)
      const records = rowsToObjects(rows)
      parsed = records.map(r => ({
        Date:        r["Date"]        ?? "",
        Title:       r["Title"]       ?? "",
        Description: r["Description"] ?? "",
        FullThread:  r["FullThread"]  ?? "",
        Resolution:  r["Resolution"]  ?? "",
        Category:    r["Category"]    ?? "AUCTION_MARKETER",
        RaisedBy:    r["RaisedBy"]    ?? "Jordan Orange",
        TicketNo:    r["TicketNo"]    ?? "",
        selected:    true,
        status:      "pending" as const,
      })).filter(t => t.Title && t.Description)
    } catch (e: any) {
      setError(`CSV parse failed: ${e?.message ?? e}`)
      return
    }
    if (parsed.length === 0) { setError("No usable rows in the CSV"); return }

    setTickets(parsed)
    setProgress(0)
    setStage("summarising")

    // Process sequentially — predictable, easy to debug, no quota spikes.
    for (let i = 0; i < parsed.length; i++) {
      setTickets(prev => {
        const next = [...prev]
        next[i] = { ...next[i], status: "processing" }
        return next
      })
      try {
        const r = await fetch("/api/tickets/import/summarise", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            title:       parsed[i].Title,
            description: parsed[i].Description,
            fullThread:  parsed[i].FullThread,
          }),
        })
        const d = await r.json()
        setTickets(prev => {
          const next = [...prev]
          next[i] = {
            ...next[i],
            Resolution: d.resolution ?? next[i].Resolution,
            warning:    d.warning,
            status:     r.ok ? "done" : "failed",
          }
          return next
        })
      } catch (e: any) {
        setTickets(prev => {
          const next = [...prev]
          next[i] = { ...next[i], status: "failed", warning: e?.message ?? "Network error" }
          return next
        })
      }
      setProgress(i + 1)
    }

    setStage("review")
  }

  async function commit() {
    const selected = tickets.filter(t => t.selected)
    if (selected.length === 0) { setError("No tickets selected"); return }
    if (!confirm(`Create ${selected.length} ticket${selected.length === 1 ? "" : "s"} with their original dates? This can't be undone in bulk.`)) return
    setError("")
    setStage("committing")
    try {
      // Re-emit a CSV from the (possibly-edited) selected tickets — keeps the
      // commit endpoint simple and column-driven.
      const cols    = ["Date", "Title", "Description", "Resolution", "Category", "RaisedBy"]
      const esc     = (v: string) => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
      const csvOut  = [
        cols.join(","),
        ...selected.map(t => cols.map(c => esc(String((t as any)[c] ?? ""))).join(",")),
      ].join("\r\n")

      const r = await fetch("/api/tickets/import/commit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ csv: csvOut, defaultStatus }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.error ?? "Import failed"); setStage("review"); return }
      setImportedCount(d.count ?? 0)
      setStage("done")
    } catch (e: any) {
      setError(e?.message ?? "Import failed")
      setStage("review")
    }
  }

  const selectedCount = useMemo(() => tickets.filter(t => t.selected).length, [tickets])
  const warnCount     = useMemo(() => tickets.filter(t => t.warning).length, [tickets])
  const failCount     = useMemo(() => tickets.filter(t => t.status === "failed").length, [tickets])

  function setAll(sel: boolean) {
    setTickets(prev => prev.map(t => ({ ...t, selected: sel })))
  }
  function updateAt<K extends keyof Ticket>(i: number, key: K, val: Ticket[K]) {
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
          Admin only. Uploads a structured CSV. For each row, Gemini reads the full email thread and summarises the
          resolution. Then you review, edit anything wrong, and commit.
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">{error}</div>
      )}

      {/* ─── Upload ─── */}
      {stage === "upload" && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">1. Pick the CSV file</div>
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="block text-sm" />
            {fileName && (
              <p className="text-xs text-gray-500 mt-1">
                {fileName} ({(csvText.length / 1024).toFixed(0)} KB)
              </p>
            )}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">2. Default status</div>
            <select
              value={defaultStatus}
              onChange={e => setDef(e.target.value as any)}
              className="text-sm border border-gray-200 rounded-md px-2 py-1.5"
            >
              <option value="RESOLVED">Resolved (auto-stamps resolvedAt with the original date)</option>
              <option value="CLOSED">Closed</option>
              <option value="OPEN">Open</option>
            </select>
          </div>
          <button
            onClick={loadAndSummarise}
            disabled={!csvText.trim()}
            className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg"
          >
            Process with Gemini →
          </button>
        </div>
      )}

      {/* ─── Summarising progress ─── */}
      {stage === "summarising" && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="text-base font-semibold text-gray-800 mb-2">
            Summarising tickets — {progress} / {tickets.length}
          </div>
          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-rose-500 transition-all duration-150"
              style={{ width: `${(progress / Math.max(1, tickets.length)) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-3">
            One Gemini call per ticket (~3-5s each). Leave the tab open.
          </p>
        </div>
      )}

      {/* ─── Review ─── */}
      {stage === "review" && (
        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              <strong>{tickets.length}</strong> processed · <strong>{selectedCount}</strong> selected
              {failCount > 0 && <> · <span className="text-red-600">{failCount} failed</span></>}
              {warnCount > 0 && <> · <span className="text-amber-700">{warnCount} warnings</span></>}
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
                  <th className="px-3 py-2 text-left">Resolution (Gemini)</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t, i) => (
                  <tr key={i} className={`border-t border-gray-100 align-top hover:bg-gray-50 ${t.status === "failed" ? "bg-red-50" : ""}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={t.selected} onChange={e => updateAt(i, "selected", e.target.checked)} />
                    </td>
                    <td className="px-3 py-2 text-gray-700 font-mono">
                      <input
                        type="date"
                        value={t.Date}
                        onChange={e => updateAt(i, "Date", e.target.value)}
                        className="text-xs border border-transparent hover:border-gray-200 rounded px-1 py-0.5 outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 w-64">
                      <input
                        type="text"
                        value={t.Title}
                        onChange={e => updateAt(i, "Title", e.target.value)}
                        className="w-full text-xs border border-transparent hover:border-gray-200 rounded px-1 py-0.5 outline-none font-medium"
                      />
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <textarea
                        value={t.Description}
                        onChange={e => updateAt(i, "Description", e.target.value)}
                        rows={4}
                        className="w-full text-xs border border-transparent hover:border-gray-200 rounded px-1 py-0.5 outline-none resize-y"
                      />
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <textarea
                        value={t.Resolution}
                        onChange={e => updateAt(i, "Resolution", e.target.value)}
                        rows={4}
                        placeholder={t.status === "failed" ? "(summarise failed — edit manually)" : "(no clear resolution found)"}
                        className="w-full text-xs border border-transparent hover:border-gray-200 rounded px-1 py-0.5 outline-none resize-y"
                      />
                      {t.warning && (
                        <p className="text-xs text-amber-700 mt-1">{t.warning}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Committing ─── */}
      {stage === "committing" && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-base font-semibold text-gray-800 mb-2">Importing…</div>
          <div className="mt-4 inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500" />
        </div>
      )}

      {/* ─── Done ─── */}
      {stage === "done" && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-green-900">Imported {importedCount} ticket{importedCount === 1 ? "" : "s"}</h2>
          <p className="text-sm text-green-800 mt-1">
            The IT Help chatbot will pick them up as sources immediately.
          </p>
          <div className="mt-4">
            <Link href="/tools/tickets" className="bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-4 py-2 rounded-lg">
              Back to tickets →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
