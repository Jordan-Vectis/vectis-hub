"use client"

import { useRef, useState } from "react"

export default function ExportImportButtons({
  auctions,
}: {
  auctions: { id: string; code: string; name: string }[]
}) {
  const [exportCode,    setExportCode]    = useState("")
  const [exportOpen,    setExportOpen]    = useState(false)
  const [exporting,     setExporting]     = useState(false)

  const [importOpen,    setImportOpen]    = useState(false)
  const [importing,     setImporting]     = useState(false)
  const [importResult,  setImportResult]  = useState<{ created: number; skipped: number; errors: string[]; code: string } | null>(null)
  const [importError,   setImportError]   = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    const code = exportCode.trim().toUpperCase()
    if (!code) return
    setExporting(true)
    try {
      const res = await fetch(`/api/catalogue/export?code=${encodeURIComponent(code)}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? "Export failed")
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = `${code}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      setExportOpen(false)
      setExportCode("")
    } finally {
      setExporting(false)
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res  = await fetch("/api/catalogue/import", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok || json.error) {
        setImportError(json.error ?? "Import failed")
        return
      }
      setImportResult({ created: json.created, skipped: json.skipped, errors: json.errors ?? [], code: json.code })
    } catch (e: any) {
      setImportError(e.message ?? "Unknown error")
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <>
      {/* Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setExportOpen(true); setImportOpen(false) }}
          className="px-3 py-2 text-sm font-medium bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-[#3a3a3c] transition-colors"
        >
          ↓ Export
        </button>
        <button
          onClick={() => { setImportOpen(true); setExportOpen(false); setImportResult(null); setImportError(null) }}
          className="px-3 py-2 text-sm font-medium bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-[#3a3a3c] transition-colors"
        >
          ↑ Import
        </button>
      </div>

      {/* Export panel */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Export Auction</h2>
              <button onClick={() => setExportOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Exports the auction and all its lots to an Excel file.
            </p>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block">Auction</label>
              <select
                value={exportCode}
                onChange={e => setExportCode(e.target.value)}
                className="w-full bg-gray-50 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#C8A96E]"
              >
                <option value="">— select auction —</option>
                {auctions.map(a => (
                  <option key={a.id} value={a.code}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setExportOpen(false)}
                className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={!exportCode || exporting}
                className="flex-1 px-4 py-2 text-sm font-semibold bg-[#C8A96E] hover:bg-[#b8945a] disabled:opacity-40 text-black rounded-lg transition-colors"
              >
                {exporting ? "Exporting…" : "Download"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import panel */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Import Auction</h2>
              <button onClick={() => setImportOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
            </div>

            {!importResult && !importError && (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Upload an Excel file exported from this page. The auction will be created if it doesn't exist. Existing lots are skipped — new lots are added.
                </p>
                <div>
                  <label className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${importing ? "opacity-50 cursor-not-allowed" : "border-gray-300 dark:border-gray-600 hover:border-[#C8A96E]"}`}>
                    <span className="text-2xl mb-1">📂</span>
                    <span className="text-sm text-gray-600 dark:text-gray-400">{importing ? "Importing…" : "Click to choose file"}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-600 mt-0.5">.xlsx only</span>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      disabled={importing}
                      onChange={handleImport}
                    />
                  </label>
                </div>
              </>
            )}

            {importError && (
              <div className="bg-red-950/30 border border-red-700/50 rounded-xl p-4 text-sm text-red-300">
                {importError}
              </div>
            )}

            {importResult && (
              <div className="space-y-3">
                <div className="bg-green-950/30 border border-green-700/50 rounded-xl p-4 space-y-1 text-sm">
                  <p className="font-semibold text-green-300">Import complete — <span className="font-mono">{importResult.code}</span></p>
                  <p className="text-green-400">✓ {importResult.created} lot{importResult.created !== 1 ? "s" : ""} created</p>
                  {importResult.skipped > 0 && (
                    <p className="text-gray-400">— {importResult.skipped} already existed, skipped</p>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <div className="bg-red-950/20 border border-red-800/40 rounded-xl p-3 space-y-1">
                    <p className="text-xs font-semibold text-red-400">Errors ({importResult.errors.length})</p>
                    {importResult.errors.map((e, i) => (
                      <p key={i} className="text-xs text-red-300">{e}</p>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => { window.location.reload() }}
                  className="w-full px-4 py-2 text-sm font-semibold bg-[#C8A96E] hover:bg-[#b8945a] text-black rounded-lg transition-colors"
                >
                  Refresh page
                </button>
              </div>
            )}

            {!importResult && (
              <button onClick={() => setImportOpen(false)}
                className="w-full px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
