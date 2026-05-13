"use client"

import { useState } from "react"
import Link from "next/link"

export default function TicketImportPage() {
  const [csvText, setCsvText]   = useState("")
  const [fileName, setFileName] = useState("")
  const [busy, setBusy]         = useState(false)
  const [result, setResult]     = useState<{ count: number; skipped: number } | null>(null)
  const [error, setError]       = useState("")
  const [defaultStatus, setDef] = useState<"RESOLVED" | "CLOSED" | "OPEN">("RESOLVED")

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = ev => setCsvText(String(ev.target?.result ?? ""))
    reader.readAsText(f)
  }

  async function importNow() {
    if (!csvText.trim()) { setError("Pick a CSV file first"); return }
    if (!confirm("Import these tickets with their original dates? This can't be undone in bulk.")) return
    setError(""); setBusy(true)
    try {
      const r = await fetch("/api/tickets/import/commit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ csv: csvText, defaultStatus }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.error ?? "Import failed"); return }
      setResult({ count: d.count ?? 0, skipped: d.skipped ?? 0 })
    } catch (e: any) {
      setError(e?.message ?? "Import failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/tools/tickets" className="text-sm text-gray-500 hover:text-gray-700">← Tickets</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Import tickets from CSV</h1>
        <p className="text-sm text-gray-500 mt-1">
          Admin only. Upload a structured CSV with columns:{" "}
          <code className="bg-gray-100 px-1 rounded">Date</code>,{" "}
          <code className="bg-gray-100 px-1 rounded">Title</code>,{" "}
          <code className="bg-gray-100 px-1 rounded">Description</code>,{" "}
          <code className="bg-gray-100 px-1 rounded">Resolution</code>,{" "}
          <code className="bg-gray-100 px-1 rounded">Category</code>,{" "}
          <code className="bg-gray-100 px-1 rounded">RaisedBy</code>.
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">{error}</div>
      )}

      {!result ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">1. Pick the CSV file</div>
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="block text-sm" />
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
              onChange={e => setDef(e.target.value as any)}
              className="text-sm border border-gray-200 rounded-md px-2 py-1.5"
            >
              <option value="RESOLVED">Resolved (auto-stamps resolvedAt with the original date)</option>
              <option value="CLOSED">Closed</option>
              <option value="OPEN">Open</option>
            </select>
          </div>
          <button
            onClick={importNow}
            disabled={!csvText.trim() || busy}
            className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg"
          >
            {busy ? "Importing…" : "Import →"}
          </button>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-green-900">
            Imported {result.count} ticket{result.count === 1 ? "" : "s"}
          </h2>
          {result.skipped > 0 && (
            <p className="text-sm text-green-800 mt-1">
              {result.skipped} row{result.skipped === 1 ? "" : "s"} skipped (missing title or description).
            </p>
          )}
          <p className="text-sm text-green-800 mt-1">
            The IT Help chatbot will pick them up as sources immediately.
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/tools/tickets" className="bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-4 py-2 rounded-lg">
              Back to tickets →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
