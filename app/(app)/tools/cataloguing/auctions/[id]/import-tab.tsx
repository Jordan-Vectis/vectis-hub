"use client"

import { useRef, useState, useTransition } from "react"
import * as XLSX from "xlsx"
import { importLots } from "@/lib/actions/catalogue"

interface Props {
  auctionId: string
  auctionCode: string
  onImported: () => void
}

interface PreviewRow {
  title: string; description: string
  keyPoints: string; barcode: string
  estimateLow: string; estimateHigh: string; reserve: string
  condition: string; status: string; vendor: string
  tote: string; receipt: string; category: string
  subCategory: string; brand: string; notes: string
}

export default function ImportTab({ auctionId, auctionCode, onImported }: Props) {
  const fileRef              = useRef<HTMLInputElement>(null)
  const [rows, setRows]      = useState<PreviewRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [format, setFormat]  = useState<"standard" | "catalogue">("standard")
  const [error, setError]    = useState<string | null>(null)
  const [result, setResult]  = useState<string | null>(null)
  const [pending, start]     = useTransition()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setResult(null)
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wb  = XLSX.read(ev.target!.result, { type: "binary" })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws)

        // col() tries multiple header name variants
        const col = (r: Record<string, string | number>, ...names: string[]) => {
          for (const n of names) {
            const v = r[n]
            if (v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim().toLowerCase() !== "undefined") {
              return String(v).trim()
            }
          }
          return ""
        }

        // Strip £ signs and commas from currency strings
        const money = (s: string) => s.replace(/[£,]/g, "").trim()

        // Auto-detect format: new catalogue export has a "Key Points" column
        const isCatalogue = raw.length > 0 && "Key Points" in raw[0]

        let parsed: PreviewRow[]

        if (isCatalogue) {
          // New catalogue export format
          parsed = raw.map(r => {
            const kp = col(r, "Key Points")
            const barcode = col(r, "Internal Barcode").toUpperCase()
            // Derive title from first line of key points (up to 83 chars)
            const title = kp.split("\n")[0].trim().slice(0, 83).trimEnd()
            return {
              title,
              description:  "",
              keyPoints:    kp,
              barcode,
              estimateLow:  money(col(r, "Estimate Low")),
              estimateHigh: money(col(r, "Estimate High")),
              reserve:      "",
              condition:    "",
              status:       "ENTERED",
              vendor:       col(r, "Vendor"),
              tote:         col(r, "Tote"),
              receipt:      col(r, "Receipt No"),
              category:     col(r, "Main Category"),
              subCategory:  col(r, "Sub Category"),
              brand:        col(r, "Brand"),
              notes:        col(r, "Parcel Size"),
            }
          }).filter(r => r.title || r.barcode)
          setFormat("catalogue")
        } else {
          // Existing standard format
          parsed = raw.map(r => ({
            title:        col(r, "Title", "Short Description"),
            description:  col(r, "Description", "Catalogue Description"),
            keyPoints:    "",
            barcode:      col(r, "Barcode", "Internal Barcode", "").toUpperCase(),
            estimateLow:  col(r, "Estimate Low", "Low Estimate"),
            estimateHigh: col(r, "Estimate High", "High Estimate"),
            reserve:      col(r, "Reserve", "Reserve Price"),
            condition:    col(r, "Condition", "Condition Report"),
            status:       col(r, "Status"),
            vendor:       col(r, "Vendor", "Vendor Name"),
            tote:         col(r, "Tote", "Tote No."),
            receipt:      col(r, "Receipt", "Receipt No."),
            category:     col(r, "Category", "Article Category Code"),
            subCategory:  col(r, "Sub-Category", "Article Subcategory Code"),
            brand:        col(r, "Brand"),
            notes:        col(r, "Notes"),
          })).filter(r => r.title)
          setFormat("standard")
        }

        if (parsed.length === 0) { setError("No valid rows found — make sure the file has a 'Title' or 'Key Points' column."); return }
        setRows(parsed)
      } catch {
        setError("Could not read file — make sure it's a valid Excel file.")
      }
    }
    reader.readAsBinaryString(file)
    e.target.value = ""
  }

  function handleImport() {
    if (rows.length === 0) return
    start(async () => {
      try {
        const count = await importLots(auctionId, rows)
        setResult(`✓ Imported ${count} lots successfully.`)
        setRows([])
        setFileName(null)
        onImported()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed")
      }
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Import Lots</h2>
        <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">{auctionCode} — upload an Excel file exported from this app</p>
      </div>

      {/* File picker */}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      <button onClick={() => fileRef.current?.click()}
        className="w-full py-8 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-600 dark:text-gray-400 hover:text-[#2AB4A6] transition-colors flex flex-col items-center gap-2 mb-4">
        <span className="text-3xl">📂</span>
        <span className="text-sm font-medium">{fileName ?? "Choose Excel file"}</span>
        <span className="text-xs text-gray-600">Supports standard exports and catalogue exports (auto-detected)</span>
      </button>

      {error  && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mb-4">{error}</p>}
      {result && <p className="text-xs text-[#2AB4A6] bg-[#2AB4A6]/10 rounded-lg px-3 py-2 mb-4">{result}</p>}

      {/* Preview */}
      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-600 dark:text-gray-400">{rows.length} lots ready to import</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${format === "catalogue" ? "bg-purple-900/40 text-purple-300" : "bg-gray-700 text-gray-600 dark:text-gray-400"}`}>
                {format === "catalogue" ? "Catalogue export" : "Standard format"}
              </span>
            </div>
            <button onClick={handleImport} disabled={pending}
              className="px-5 py-2 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-colors">
              {pending ? "Importing…" : `Import ${rows.length} Lots`}
            </button>
          </div>
          <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#141416]">
                  {format === "catalogue"
                    ? ["Barcode", "Key Points", "Vendor", "Category", "Est. Low/High"].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-gray-600 dark:text-gray-500 font-medium uppercase tracking-wide">{h}</th>
                      ))
                    : ["Title", "Vendor", "Tote", "Category", "Status"].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-gray-600 dark:text-gray-500 font-medium uppercase tracking-wide">{h}</th>
                      ))
                  }
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-[#2C2C2E]">
                    {format === "catalogue" ? <>
                      <td className="px-3 py-2 font-mono text-[#2AB4A6]">{r.barcode || "—"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[220px] truncate">{r.keyPoints || "—"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.vendor || "—"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.category || "—"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.estimateLow || "—"} / {r.estimateHigh || "—"}</td>
                    </> : <>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{r.title || "—"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.vendor || "—"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400 font-mono">{r.tote || "—"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.category || "—"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.status || "ENTERED"}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
