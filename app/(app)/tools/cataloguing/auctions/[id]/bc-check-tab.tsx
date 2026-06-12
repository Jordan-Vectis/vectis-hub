"use client"

import { useState } from "react"
import * as XLSX from "xlsx"

interface LotItem {
  id: string
  barcode: string | null
  receiptUniqueId: string | null
  title: string
  estimateLow: number | null
  estimateHigh: number | null
}

interface BCRow {
  barcode: string
  uniqueId: string
  shortDescription: string
  lowEstimate: number | null
  highEstimate: number | null
}

interface MatchResult {
  lot: LotItem
  bcRow: BCRow
  titleMatch: boolean
  estimateLowMatch: boolean
  estimateHighMatch: boolean
  allMatch: boolean
}

interface Results {
  matched: MatchResult[]
  missingFromBc: LotItem[]
  extraInBc: BCRow[]
}

interface Props {
  lots: LotItem[]
}

function normTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

export default function BcCheckTab({ lots }: Props) {
  const [results, setResults]   = useState<Results | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const barcodeMap  = new Map(lots.filter(l => l.barcode).map(l => [l.barcode!.toLowerCase(), l]))
  const uniqueIdMap = new Map(lots.filter(l => l.receiptUniqueId).map(l => [l.receiptUniqueId!.toLowerCase(), l]))

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError(null)
    setResults(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb      = XLSX.read(ev.target?.result, { type: "array" })
        const ws      = wb.Sheets[wb.SheetNames[0]]
        const rows    = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]
        const header  = rows[0] as string[]

        const col = (name: string) => header.findIndex(h => h === name)
        const barcodeIdx   = col("Internal Barcode")
        const uniqueIdIdx  = col("UniqueID")
        const shortDescIdx = col("Short Description")
        const lowEstIdx    = col("Low Estimate")
        const highEstIdx   = col("High Estimate")

        if (barcodeIdx < 0 || shortDescIdx < 0) {
          setError("Doesn't look like a valid BC Lines export — expected columns not found.")
          return
        }

        const bcRows: BCRow[] = rows.slice(1)
          .filter(r => r[barcodeIdx] != null && String(r[barcodeIdx]).trim())
          .map(r => ({
            barcode:          String(r[barcodeIdx] ?? "").trim(),
            uniqueId:         String(r[uniqueIdIdx] ?? "").trim(),
            shortDescription: String(r[shortDescIdx] ?? "").trim(),
            lowEstimate:      r[lowEstIdx]  != null ? Number(r[lowEstIdx])  : null,
            highEstimate:     r[highEstIdx] != null ? Number(r[highEstIdx]) : null,
          }))

        const matchedLotIds   = new Set<string>()
        const matchedBcKeys   = new Set<string>()
        const matched: MatchResult[] = []

        for (const bcRow of bcRows) {
          let lot: LotItem | undefined
          if (bcRow.uniqueId) lot = uniqueIdMap.get(bcRow.uniqueId.toLowerCase())
          if (!lot && bcRow.barcode) lot = barcodeMap.get(bcRow.barcode.toLowerCase())

          if (lot) {
            matchedLotIds.add(lot.id)
            matchedBcKeys.add(bcRow.barcode)

            const titleMatch        = normTitle(bcRow.shortDescription) === normTitle(lot.title)
            const estimateLowMatch  = bcRow.lowEstimate === lot.estimateLow
            const estimateHighMatch = bcRow.highEstimate === lot.estimateHigh

            matched.push({
              lot, bcRow,
              titleMatch,
              estimateLowMatch,
              estimateHighMatch,
              allMatch: titleMatch && estimateLowMatch && estimateHighMatch,
            })
          }
        }

        const missingFromBc = lots.filter(l => !matchedLotIds.has(l.id))
        const extraInBc     = bcRows.filter(r => {
          let lot: LotItem | undefined
          if (r.uniqueId) lot = uniqueIdMap.get(r.uniqueId.toLowerCase())
          if (!lot && r.barcode) lot = barcodeMap.get(r.barcode.toLowerCase())
          return !lot
        })

        setResults({ matched, missingFromBc, extraInBc })
      } catch (err: any) {
        setError("Failed to read file: " + (err?.message ?? "Unknown error"))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const mismatches = results?.matched.filter(m => !m.allMatch) ?? []
  const allGood    = results?.matched.filter(m => m.allMatch) ?? []
  const totalIssues = mismatches.length + (results?.missingFromBc.length ?? 0) + (results?.extraInBc.length ?? 0)

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">BC Cross-Reference</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Upload the Lines export from BC to verify titles and estimates match our records.
        </p>
      </div>

      {/* Upload */}
      <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 cursor-pointer hover:border-[#C8A96E] transition-colors">
        <span className="text-3xl">📂</span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {fileName ? fileName : "Click to upload BC Lines export (.xlsx)"}
        </span>
        {fileName && <span className="text-xs text-gray-400">Click to upload a different file</span>}
        <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="sr-only" />
      </label>

      {error && <p className="text-sm text-red-400 px-1">{error}</p>}

      {results && (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-gray-900 dark:text-white">{results.matched.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">Matched</div>
            </div>
            <div className={`${allGood.length > 0 && allGood.length === results.matched.length ? "bg-green-950/20 border-green-800/40" : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"} border rounded-xl p-3 text-center`}>
              <div className={`text-xl font-bold ${allGood.length > 0 && allGood.length === results.matched.length ? "text-green-400" : "text-gray-900 dark:text-white"}`}>{allGood.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">All match</div>
            </div>
            <div className={`${mismatches.length > 0 ? "bg-amber-950/20 border-amber-800/40" : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"} border rounded-xl p-3 text-center`}>
              <div className={`text-xl font-bold ${mismatches.length > 0 ? "text-amber-400" : "text-gray-900 dark:text-white"}`}>{mismatches.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">Mismatches</div>
            </div>
            <div className={`${(results.missingFromBc.length + results.extraInBc.length) > 0 ? "bg-red-950/20 border-red-800/40" : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"} border rounded-xl p-3 text-center`}>
              <div className={`text-xl font-bold ${(results.missingFromBc.length + results.extraInBc.length) > 0 ? "text-red-400" : "text-gray-900 dark:text-white"}`}>{results.missingFromBc.length + results.extraInBc.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">Missing / extra</div>
            </div>
          </div>

          {totalIssues === 0 && (
            <div className="flex items-center gap-2 px-4 py-3 bg-green-950/20 border border-green-800/40 rounded-xl text-green-400 text-sm">
              ✅ Everything matches — titles and estimates are consistent with BC.
            </div>
          )}

          {/* Mismatches */}
          {mismatches.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-amber-400 mb-2">⚠️ Mismatches ({mismatches.length} lots)</h3>
              <div className="border border-amber-800/40 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-amber-950/20 border-b border-amber-800/40">
                      <th className="text-left px-3 py-2 text-amber-400 font-medium">Lot</th>
                      <th className="text-left px-3 py-2 text-amber-400 font-medium">Field</th>
                      <th className="text-left px-3 py-2 text-amber-400 font-medium">Our system</th>
                      <th className="text-left px-3 py-2 text-amber-400 font-medium">In BC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatches.flatMap(m => {
                      const id   = m.lot.receiptUniqueId || m.lot.barcode || "—"
                      const rows = []
                      if (!m.titleMatch) rows.push(
                        <tr key={`${m.lot.id}-title`} className="border-b border-gray-700/30">
                          <td className="px-3 py-2 font-mono text-gray-400 whitespace-nowrap">{id}</td>
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap">Title</td>
                          <td className="px-3 py-2 text-gray-300 max-w-[200px] truncate" title={m.lot.title}>{m.lot.title}</td>
                          <td className="px-3 py-2 text-gray-300 max-w-[200px] truncate" title={m.bcRow.shortDescription}>{m.bcRow.shortDescription}</td>
                        </tr>
                      )
                      if (!m.estimateLowMatch) rows.push(
                        <tr key={`${m.lot.id}-low`} className="border-b border-gray-700/30">
                          <td className="px-3 py-2 font-mono text-gray-400 whitespace-nowrap">{id}</td>
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap">Est. Low</td>
                          <td className="px-3 py-2 text-gray-300">{m.lot.estimateLow != null ? `£${m.lot.estimateLow}` : "—"}</td>
                          <td className="px-3 py-2 text-gray-300">{m.bcRow.lowEstimate != null ? `£${m.bcRow.lowEstimate}` : "—"}</td>
                        </tr>
                      )
                      if (!m.estimateHighMatch) rows.push(
                        <tr key={`${m.lot.id}-high`} className="border-b border-gray-700/30">
                          <td className="px-3 py-2 font-mono text-gray-400 whitespace-nowrap">{id}</td>
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap">Est. High</td>
                          <td className="px-3 py-2 text-gray-300">{m.lot.estimateHigh != null ? `£${m.lot.estimateHigh}` : "—"}</td>
                          <td className="px-3 py-2 text-gray-300">{m.bcRow.highEstimate != null ? `£${m.bcRow.highEstimate}` : "—"}</td>
                        </tr>
                      )
                      return rows
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Missing from BC */}
          {results.missingFromBc.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-red-400 mb-2">❌ In our system but not in BC ({results.missingFromBc.length})</h3>
              <div className="border border-red-800/40 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-red-950/20 border-b border-red-800/40">
                      <th className="text-left px-3 py-2 text-red-400 font-medium">Lot ID</th>
                      <th className="text-left px-3 py-2 text-red-400 font-medium">Barcode</th>
                      <th className="text-left px-3 py-2 text-red-400 font-medium">Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.missingFromBc.map((lot, i) => (
                      <tr key={lot.id} className={`border-b border-gray-700/30 last:border-0 ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}>
                        <td className="px-3 py-2 font-mono text-gray-400">{lot.receiptUniqueId || "—"}</td>
                        <td className="px-3 py-2 font-mono text-gray-400">{lot.barcode || "—"}</td>
                        <td className="px-3 py-2 text-gray-300 max-w-xs truncate" title={lot.title}>{lot.title}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Extra in BC */}
          {results.extraInBc.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-red-400 mb-2">❌ In BC but not in our system ({results.extraInBc.length})</h3>
              <div className="border border-red-800/40 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-red-950/20 border-b border-red-800/40">
                      <th className="text-left px-3 py-2 text-red-400 font-medium">BC Barcode</th>
                      <th className="text-left px-3 py-2 text-red-400 font-medium">UniqueID</th>
                      <th className="text-left px-3 py-2 text-red-400 font-medium">Short Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.extraInBc.map((row, i) => (
                      <tr key={`${row.barcode}-${i}`} className={`border-b border-gray-700/30 last:border-0 ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}>
                        <td className="px-3 py-2 font-mono text-gray-400">{row.barcode}</td>
                        <td className="px-3 py-2 font-mono text-gray-400">{row.uniqueId || "—"}</td>
                        <td className="px-3 py-2 text-gray-300 max-w-xs truncate" title={row.shortDescription}>{row.shortDescription}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
