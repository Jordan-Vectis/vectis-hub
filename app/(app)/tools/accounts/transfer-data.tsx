"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

// 🔁 Transfer between environments — export everything in Accounts as one JSON
// file (rows + 24h-signed links to every scan), import it on the other
// environment. Add-only: existing rows/files are skipped, nothing is deleted.

type Preview = {
  fileName: string
  data: any
  counts: { months: number; documents: number; statements: number; transactions: number; cardholders: number; supplierRules: number; files: number }
  exportedAt: string
}
type DoneSummary = {
  created: Record<string, number>
  skipped: Record<string, number>
  notes: string[]
  filesCopied: number
  filesExisting: number
  filesFailed: { key: string; error?: string }[]
}

export default function TransferData() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<"idle" | "rows" | "files" | "done">("idle")
  const [fileProg, setFileProg] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState<DoneSummary | null>(null)

  async function pickFile(f: File | null) {
    setError(null); setSummary(null); setPhase("idle")
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      if (data?.kind !== "vectis-accounts-transfer") throw new Error("That isn't a Vectis accounts export file.")
      setPreview({
        fileName: f.name,
        data,
        counts: {
          months: data.months?.length ?? 0,
          documents: data.documents?.length ?? 0,
          statements: data.statements?.length ?? 0,
          transactions: data.transactions?.length ?? 0,
          cardholders: data.cardholders?.length ?? 0,
          supplierRules: data.supplierRules?.length ?? 0,
          files: data.files?.length ?? 0,
        },
        exportedAt: data.exportedAt ?? "",
      })
    } catch (e: any) {
      setPreview(null)
      setError(e?.message ?? "Couldn't read that file.")
    }
  }

  async function runImport() {
    if (!preview) return
    setError(null)
    setPhase("rows")
    try {
      // 1. Data rows (add-only, ids preserved)
      const res = await fetch("/api/accounts/transfer/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview.data),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Import failed")

      // 2. Files, in chunks of 10, with progress
      const files: { key: string; url: string }[] = preview.data.files ?? []
      setPhase("files")
      setFileProg({ done: 0, total: files.length })
      let copied = 0, existing = 0
      const failed: { key: string; error?: string }[] = []
      for (let i = 0; i < files.length; i += 10) {
        const chunk = files.slice(i, i + 10)
        try {
          const fr = await fetch("/api/accounts/transfer/import-files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: chunk }),
          })
          const fj = await fr.json().catch(() => ({}))
          if (!fr.ok) throw new Error(fj.error || "File copy failed")
          for (const r of fj.results ?? []) {
            if (r.status === "copied") copied++
            else if (r.status === "exists") existing++
            else failed.push({ key: r.key, error: r.error })
          }
        } catch (e: any) {
          for (const c of chunk) failed.push({ key: c.key, error: e?.message })
        }
        setFileProg({ done: Math.min(i + 10, files.length), total: files.length })
      }

      setSummary({
        created: j.created ?? {},
        skipped: j.skipped ?? {},
        notes: j.notes ?? [],
        filesCopied: copied,
        filesExisting: existing,
        filesFailed: failed,
      })
      setPhase("done")
      setPreview(null)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? "Import failed")
      setPhase("idle")
    }
  }

  const busy = phase === "rows" || phase === "files"
  const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"
  const totalCreated = summary ? Object.values(summary.created).reduce((a, b) => a + b, 0) : 0
  const totalSkipped = summary ? Object.values(summary.skipped).reduce((a, b) => a + b, 0) : 0

  return (
    <div className={`${card} mt-3`}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
        <div>
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">🔁 Transfer between environments</p>
          <p className="text-xs text-gray-400 mt-0.5">Export everything here as one file; import it on the other environment (staging ⇄ production). Adds only — never overwrites or deletes.</p>
        </div>
        <span className="text-gray-400 text-lg">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <a href="/api/accounts/transfer/export" className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">
              ⬇ Export all data
            </a>
            <button onClick={() => fileInput.current?.click()} disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-50">
              ⬆ Import from file…
            </button>
            <span className="text-[11px] text-gray-400">Import within 24 hours of exporting — the file&apos;s scan links expire after that.</span>
          </div>

          {error && <p className="text-sm text-red-500">✗ {error}</p>}

          {preview && phase === "idle" && (
            <div className="rounded-xl border border-sky-300/60 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-500/10 p-3">
              <p className="text-sm font-semibold text-sky-800 dark:text-sky-200">{preview.fileName}</p>
              <p className="text-xs text-sky-700 dark:text-sky-300 mt-1">
                {preview.counts.months} months · {preview.counts.documents} lines · {preview.counts.statements} statements · {preview.counts.transactions} transactions · {preview.counts.cardholders} cards · {preview.counts.supplierRules} learned rules · {preview.counts.files} scan files
                {preview.exportedAt ? ` — exported ${new Date(preview.exportedAt).toLocaleString("en-GB")}` : ""}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={runImport} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white">Import into THIS environment</button>
                <button onClick={() => setPreview(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">Cancel</button>
              </div>
            </div>
          )}

          {phase === "rows" && <p className="text-sm text-gray-500">⏳ Importing the data rows…</p>}
          {phase === "files" && (
            <div>
              <p className="text-sm text-gray-500 mb-1">⏳ Copying scan files… {fileProg.done} of {fileProg.total}</p>
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                <div className="h-full bg-sky-500 transition-all" style={{ width: `${fileProg.total ? Math.round((fileProg.done / fileProg.total) * 100) : 100}%` }} />
              </div>
            </div>
          )}

          {phase === "done" && summary && (
            <div className="rounded-xl border border-emerald-300/60 dark:border-emerald-700/50 bg-emerald-50 dark:bg-emerald-500/10 p-3 text-sm">
              <p className="font-semibold text-emerald-800 dark:text-emerald-200">✓ Import finished</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                Added: {summary.created.months ?? 0} months, {summary.created.documents ?? 0} lines, {summary.created.statements ?? 0} statements, {summary.created.transactions ?? 0} transactions, {summary.created.cardholders ?? 0} cards, {summary.created.supplierRules ?? 0} rules.
                {totalSkipped > 0 && ` Skipped ${totalSkipped} already-present item${totalSkipped === 1 ? "" : "s"}.`}
                {totalCreated === 0 && totalSkipped > 0 && " (Everything was already here.)"}
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                Files: {summary.filesCopied} copied, {summary.filesExisting} already present{summary.filesFailed.length > 0 ? `, ${summary.filesFailed.length} FAILED` : ""}.
              </p>
              {summary.notes.map((n, i) => <p key={i} className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">⚠ {n}</p>)}
              {summary.filesFailed.length > 0 && (
                <p className="text-xs text-red-500 mt-1">
                  ⚠ {summary.filesFailed.length} file{summary.filesFailed.length === 1 ? "" : "s"} couldn&apos;t be copied ({summary.filesFailed[0].error ?? "unknown error"}). Re-export a fresh file on the other environment and import it again — already-copied files will be skipped.
                </p>
              )}
            </div>
          )}

          <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
        </div>
      )}
    </div>
  )
}
