"use client"

import { useMemo, useState } from "react"
import * as XLSX from "xlsx"

// Reconciles a "hotkey sheet" (the to-do list the BC macro works through: Tote / LotCount /
// pipe-separated Barcodes) against the "BC export" (Lines — what actually made it into BC).
// Outputs a fresh hotkey sheet containing ONLY the lots not yet in BC, and flags any lots that
// ARE in BC but have an Errors value (those are left for the user to fix in BC, not re-run).

const norm = (s: any) => String(s ?? "").trim().toUpperCase()

// "Errors"/"Warnings" in the BC export are numeric counts — 0 means no error. A non-empty,
// non-zero number (or any text) counts as a real error to flag.
const hasError = (v: any) => {
  const s = String(v ?? "").trim()
  if (!s) return false
  const n = Number(s)
  return Number.isFinite(n) ? n > 0 : true
}

async function readSheet(file: File): Promise<any[][]> {
  const name = file.name.toLowerCase()
  let wb: XLSX.WorkBook
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    // Force comma as the separator — the hotkey sheet's Barcodes column is pipe-heavy, and
    // XLSX's delimiter auto-detect would otherwise wrongly split on "|".
    const text = (await file.text()).replace(/^﻿/, "")
    wb = XLSX.read(text, { type: "string", FS: "," })
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as any[][]
}

function findCol(headers: any[], ...names: string[]): number {
  const wanted = names.map(n => n.toLowerCase())
  return headers.findIndex(h => wanted.includes(String(h).trim().toLowerCase()))
}

type ToteRow   = { tote: string; barcodes: string[] }
type ErrorFlag = { barcode: string; uniqueId: string; tote: string; error: string }

export default function BcImportCheckTab() {
  const [hotkeyName, setHotkeyName] = useState<string | null>(null)
  const [bcName,     setBcName]     = useState<string | null>(null)
  const [hotkey,     setHotkey]     = useState<ToteRow[] | null>(null)
  const [bc,         setBc]         = useState<{ barcodes: Set<string>; errors: ErrorFlag[] } | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [copied,     setCopied]     = useState(false)

  async function loadHotkey(file: File) {
    setError(null)
    try {
      const rows = await readSheet(file)
      if (rows.length < 2) throw new Error("The hotkey sheet looks empty.")
      const headers = rows[0]
      const toteCol     = findCol(headers, "ToteNumber", "Tote No.", "Tote", "Receipt No.")
      const barcodesCol = findCol(headers, "Barcodes", "Barcode")
      if (barcodesCol < 0) throw new Error('Could not find a "Barcodes" column in the hotkey sheet.')
      const out: ToteRow[] = []
      for (let r = 1; r < rows.length; r++) {
        const tote = String(rows[r][toteCol] ?? "").trim()
        const barcodes = String(rows[r][barcodesCol] ?? "").split("|").map(b => b.trim()).filter(Boolean)
        if (barcodes.length) out.push({ tote, barcodes })
      }
      if (!out.length) throw new Error("No barcodes found in the hotkey sheet.")
      setHotkey(out); setHotkeyName(file.name)
    } catch (e: any) { setError(e?.message ?? "Could not read the hotkey sheet."); setHotkey(null); setHotkeyName(null) }
  }

  async function loadBc(file: File) {
    setError(null)
    try {
      const rows = await readSheet(file)
      if (rows.length < 2) throw new Error("The BC export looks empty.")
      const headers = rows[0]
      const bcCol   = findCol(headers, "Internal Barcode", "Barcode")
      const errCol  = findCol(headers, "Errors", "Error")
      const uidCol  = findCol(headers, "UniqueID")
      const toteCol = findCol(headers, "Tote No.", "ToteNumber", "Tote", "Receipt No.")
      if (bcCol < 0) throw new Error('Could not find an "Internal Barcode" column in the BC export.')
      const barcodes = new Set<string>()
      const errors: ErrorFlag[] = []
      for (let r = 1; r < rows.length; r++) {
        const raw = String(rows[r][bcCol] ?? "").trim()
        if (!raw) continue
        barcodes.add(norm(raw))
        if (errCol >= 0 && hasError(rows[r][errCol])) errors.push({
          barcode: raw,
          error: String(rows[r][errCol] ?? "").trim(),
          uniqueId: uidCol  >= 0 ? String(rows[r][uidCol]  ?? "").trim() : "",
          tote:     toteCol >= 0 ? String(rows[r][toteCol] ?? "").trim() : "",
        })
      }
      setBc({ barcodes, errors }); setBcName(file.name)
    } catch (e: any) { setError(e?.message ?? "Could not read the BC export."); setBc(null); setBcName(null) }
  }

  const result = useMemo(() => {
    if (!hotkey || !bc) return null
    const done = bc.barcodes
    const remainingTotes: ToteRow[] = []
    let totalHotkey = 0, totalRemaining = 0
    for (const t of hotkey) {
      totalHotkey += t.barcodes.length
      const remaining = t.barcodes.filter(b => !done.has(norm(b)))
      totalRemaining += remaining.length
      if (remaining.length) remainingTotes.push({ tote: t.tote, barcodes: remaining })
    }
    return { remainingTotes, totalHotkey, totalRemaining, totalDone: totalHotkey - totalRemaining, errors: bc.errors }
  }, [hotkey, bc])

  const outputCsv = useMemo(() => {
    if (!result) return ""
    const lines = ["ToteNumber,LotCount,Barcodes"]
    for (const t of result.remainingTotes) lines.push(`${t.tote},${t.barcodes.length},${t.barcodes.join("|")}`)
    return lines.join("\r\n")
  }, [result])

  async function copyOut() {
    try { await navigator.clipboard.writeText(outputCsv); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch {}
  }
  function download() {
    const url = URL.createObjectURL(new Blob([outputCsv], { type: "text/csv" }))
    const a = document.createElement("a"); a.href = url; a.download = "bc_import_remaining.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  const drop = "flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-600 rounded-xl p-6 cursor-pointer hover:border-[#C8A96E] transition-colors text-center"

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">🩹 BC Import Check</h2>
        <p className="text-sm text-gray-400">
          When the "add to BC" hotkey breaks part-way through, drop in the <strong>hotkey sheet</strong> (the to-do list)
          and the <strong>BC export</strong> (Lines — what's actually in BC). It matches by barcode, removes the lots
          already done, and gives you a fresh hotkey sheet with <strong>only the lots still to do</strong>. Lots that went
          into BC but have an error are <strong>flagged separately</strong> for you to fix — they're not put in the re-run sheet.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className={drop}>
          <span className="text-2xl">⌨️</span>
          <span className="text-sm font-medium text-gray-200">{hotkeyName ?? "Hotkey sheet (to-do)"}</span>
          <span className="text-xs text-gray-500">CSV/XLSX with ToteNumber · Barcodes</span>
          <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) loadHotkey(f); e.target.value = "" }} />
        </label>
        <label className={drop}>
          <span className="text-2xl">📋</span>
          <span className="text-sm font-medium text-gray-200">{bcName ?? "BC export (Lines — done so far)"}</span>
          <span className="text-xs text-gray-500">XLSX with Internal Barcode · Errors</span>
          <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) loadBc(f); e.target.value = "" }} />
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-white">{result.totalHotkey}</div>
              <div className="text-xs text-gray-500 mt-0.5">In hotkey sheet</div>
            </div>
            <div className="bg-green-950/20 border border-green-800/40 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-green-400">{result.totalDone}</div>
              <div className="text-xs text-gray-500 mt-0.5">Already in BC</div>
            </div>
            <div className={`${result.totalRemaining > 0 ? "bg-amber-950/20 border-amber-800/40" : "bg-gray-900 border-gray-700"} border rounded-xl p-3 text-center`}>
              <div className={`text-xl font-bold ${result.totalRemaining > 0 ? "text-amber-400" : "text-white"}`}>{result.totalRemaining}</div>
              <div className="text-xs text-gray-500 mt-0.5">Still to do</div>
            </div>
            <div className={`${result.errors.length > 0 ? "bg-red-950/20 border-red-800/40" : "bg-gray-900 border-gray-700"} border rounded-xl p-3 text-center`}>
              <div className={`text-xl font-bold ${result.errors.length > 0 ? "text-red-400" : "text-white"}`}>{result.errors.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">In BC with errors</div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-xl border border-red-700/50 bg-red-950/20 p-3">
              <p className="text-xs uppercase tracking-wider text-red-400 font-semibold mb-2">⚠ {result.errors.length} lot{result.errors.length === 1 ? "" : "s"} in BC with errors — fix these in BC, then re-export and re-check</p>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <div key={`${e.barcode}-${i}`} className="text-xs text-red-200 flex flex-wrap gap-x-2">
                    <span className="font-mono font-semibold">{e.barcode}</span>
                    {e.uniqueId && <span className="text-red-400/80">{e.uniqueId}</span>}
                    {e.tote && <span className="text-red-400/60">tote {e.tote}</span>}
                    <span className="text-red-300">— {e.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.totalRemaining > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-300">Re-run sheet — {result.totalRemaining} lot{result.totalRemaining === 1 ? "" : "s"} across {result.remainingTotes.length} tote{result.remainingTotes.length === 1 ? "" : "s"}</label>
                <div className="flex gap-2">
                  <button onClick={copyOut} className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${copied ? "bg-green-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"}`}>{copied ? "✓ Copied" : "Copy"}</button>
                  <button onClick={download} className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-[#C8A96E] hover:bg-[#b8945a] text-black transition-colors">⬇ Download CSV</button>
                </div>
              </div>
              <textarea readOnly value={outputCsv} spellCheck={false} onFocus={e => e.target.select()}
                className="w-full h-40 font-mono text-xs bg-[#161618] border border-gray-700 rounded-xl px-3 py-2 text-gray-300 focus:outline-none focus:border-[#C8A96E] resize-y whitespace-pre overflow-x-auto" />
              <p className="text-xs text-gray-500 mt-1.5">Same format as the hotkey sheet (Tote / Count / Barcodes), with finished totes removed and counts recomputed. Feed this back to the macro.</p>
            </div>
          ) : (
            <p className="text-sm text-green-400">✓ Every lot in the hotkey sheet is already in BC — nothing left to re-run.</p>
          )}
        </div>
      )}
    </div>
  )
}
