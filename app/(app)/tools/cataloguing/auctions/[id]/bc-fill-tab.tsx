"use client"

import { useMemo, useState } from "react"

interface LotItem {
  receiptUniqueId: string | null
  title:           string
  estimateLow:     number | null
  estimateHigh:    number | null
  aiEstimateLow:   number | null
  aiEstimateHigh:  number | null
  notes:           string | null   // parcel size: Small / Medium / Large / Contact / Collection Only
  category:        string | null
  subCategory:     string | null
}

interface Props {
  lots: LotItem[]
}

// BC import column headers this tab fills in. Every column is located by NAME
// (case-insensitive), never by position — so a shifted, extra or missing cell in
// the pasted sheet can never drop a value into the wrong column. This is the whole
// point: it removes the line-up errors of pasting column-by-column.
const COL = {
  uid:  "UniqueID",
  desc: "Short Description",
  low:  "Low Estimate",
  high: "High Estimate",
  size: "Size Classification",
  cat:  "Article Category Code",
  sub:  "Article Subcategory Code",
}

function findCol(headers: string[], name: string): number {
  const target = name.trim().toLowerCase()
  return headers.findIndex(h => h.trim().toLowerCase() === target)
}

type Report = {
  rows:            number
  filled:          number
  notFound:        string[]
  missingEstimate: string[]
  missingSize:     string[]
  missingCategory: string[]
  aiFallback:      string[]
  missingColumns:  string[]
  hubNotInSheet:   string[]
}

function IdList({ label, ids, tone }: { label: string; ids: string[]; tone: "red" | "amber" | "blue" | "gray" }) {
  const [open, setOpen] = useState(false)
  if (ids.length === 0) return null
  const toneCls =
    tone === "red"   ? "bg-red-950/20 border-red-800/40 text-red-300"
    : tone === "amber" ? "bg-amber-950/20 border-amber-800/40 text-amber-300"
    : tone === "blue"  ? "bg-blue-950/20 border-blue-800/40 text-blue-300"
    : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
  return (
    <div className={`border rounded-xl px-4 py-3 text-sm ${toneCls}`}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 font-medium w-full text-left">
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        <span>{label} ({ids.length})</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ids.map((id, i) => (
            <span key={`${id}-${i}`} className="font-mono text-xs px-1.5 py-0.5 rounded bg-black/20 dark:bg-black/30">{id}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BcFillTab({ lots }: Props) {
  const [input,  setInput]  = useState("")
  const [output, setOutput] = useState("")
  const [error,  setError]  = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  const lotMap = useMemo(
    () => new Map(lots.filter(l => l.receiptUniqueId).map(l => [l.receiptUniqueId!.trim().toLowerCase(), l] as const)),
    [lots]
  )

  function process() {
    setError(null); setOutput(""); setReport(null); setCopied(false)

    const raw = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const lines = raw.split("\n")
    // Excel adds a trailing newline when you copy — drop trailing blanks so they
    // don't become phantom rows, but keep every real row in place.
    while (lines.length && lines[lines.length - 1] === "") lines.pop()
    if (lines.length < 2) { setError("Paste the BC sheet — including the header row — with at least one lot row below it."); return }

    const headers = lines[0].split("\t")
    const idx = {
      uid:  findCol(headers, COL.uid),
      desc: findCol(headers, COL.desc),
      low:  findCol(headers, COL.low),
      high: findCol(headers, COL.high),
      size: findCol(headers, COL.size),
      cat:  findCol(headers, COL.cat),
      sub:  findCol(headers, COL.sub),
    }
    if (idx.uid < 0) {
      setError(`Couldn't find a "${COL.uid}" column in what you pasted. Make sure the header row is included (select from the very top of the sheet).`)
      return
    }

    const missingColumns: string[] = []
    ;([["desc", COL.desc], ["low", COL.low], ["high", COL.high], ["size", COL.size], ["cat", COL.cat], ["sub", COL.sub]] as const)
      .forEach(([k, label]) => { if (idx[k] < 0) missingColumns.push(label) })

    const notFound: string[] = []
    const missingEstimate: string[] = []
    const missingSize: string[] = []
    const missingCategory: string[] = []
    const aiFallback: string[] = []
    const seen = new Set<string>()
    let filled = 0
    let dataRows = 0

    const outLines: string[] = [lines[0]]
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split("\t")
      // Pad short rows so the column positions stay correct on paste-back.
      while (cells.length < headers.length) cells.push("")
      const uid = (cells[idx.uid] ?? "").trim()
      if (!uid) { outLines.push(cells.join("\t")); continue }
      dataRows++
      const lot = lotMap.get(uid.toLowerCase())
      if (!lot) { notFound.push(uid); outLines.push(cells.join("\t")); continue }
      seen.add(uid.toLowerCase())

      // Short description ← lot title
      if (idx.desc >= 0) cells[idx.desc] = lot.title ?? ""

      // Estimate ← real (agreed) estimate, falling back to the AI estimate
      const usingReal = lot.estimateLow != null || lot.estimateHigh != null
      const lo = usingReal ? lot.estimateLow : lot.aiEstimateLow
      const hi = usingReal ? lot.estimateHigh : lot.aiEstimateHigh
      if (!usingReal && (lot.aiEstimateLow != null || lot.aiEstimateHigh != null)) aiFallback.push(uid)
      if (lo == null && hi == null) missingEstimate.push(uid)
      if (idx.low  >= 0) cells[idx.low]  = lo == null ? "" : String(lo)
      if (idx.high >= 0) cells[idx.high] = hi == null ? "" : String(hi)

      // Size Classification ← parcel size (stored on the lot's notes field)
      const size = (lot.notes ?? "").trim()
      if (!size) missingSize.push(uid)
      if (idx.size >= 0) cells[idx.size] = size

      // Category / subcategory (Hub already stores BC-style codes, e.g. RETRO_TOYS)
      const cat = (lot.category ?? "").trim()
      if (!cat) missingCategory.push(uid)
      if (idx.cat >= 0) cells[idx.cat] = cat
      if (idx.sub >= 0) cells[idx.sub] = (lot.subCategory ?? "").trim()

      filled++
      outLines.push(cells.join("\t"))
    }

    const hubNotInSheet = lots
      .filter(l => l.receiptUniqueId && !seen.has(l.receiptUniqueId.trim().toLowerCase()))
      .map(l => l.receiptUniqueId!)

    setOutput(outLines.join("\r\n"))
    setReport({ rows: dataRows, filled, notFound, missingEstimate, missingSize, missingCategory, aiFallback, missingColumns, hubNotInSheet })
  }

  async function copyOut() {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true); setTimeout(() => setCopied(false), 2500)
    } catch { /* clipboard blocked — the user can still select the box manually */ }
  }

  function clearAll() { setInput(""); setOutput(""); setReport(null); setError(null); setCopied(false) }

  const issues = report ? report.notFound.length + report.missingEstimate.length + report.missingSize.length + report.missingCategory.length : 0

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">📤 Push to BC</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
          Fills the BC import sheet straight from this auction&apos;s lots. Copy the BC sheet
          <strong> including its header row</strong>, paste it below, and press Build. Each row is matched by its
          <strong> UniqueID</strong> — never by position — so titles, estimates, parcel size and categories always
          land on the right lot. Copy the result back over the same top-left cell and every other column stays exactly where it was.
        </p>
      </div>

      {/* What it fills */}
      <div className="flex flex-wrap gap-2 text-xs">
        {["Short Description", "Low / High Estimate", "Size Classification", "Article Category Code", "Article Subcategory Code"].map(c => (
          <span key={c} className="px-2 py-1 rounded-lg bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 text-[#2AB4A6]">{c}</span>
        ))}
      </div>

      {/* Step 1 — paste in */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          1. Paste the BC sheet here (with the header row)
        </label>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Paste straight from Excel — select from the very top-left cell so the header row is included…"
          spellCheck={false}
          className="w-full h-44 font-mono text-xs bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[#2AB4A6] resize-y whitespace-pre overflow-x-auto"
        />
        <div className="flex items-center gap-3 mt-2">
          <button onClick={process} disabled={!input.trim()}
            className="px-5 py-2 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-white font-semibold text-sm rounded-lg transition-colors">
            Build BC sheet →
          </button>
          {(input || output) && (
            <button onClick={clearAll}
              className="px-4 py-2 text-xs border border-gray-600 text-gray-600 dark:text-gray-400 hover:border-red-500 hover:text-red-400 rounded-lg transition-colors">
              Clear
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
      </div>

      {/* Report */}
      {report && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-gray-900 dark:text-white">{report.rows}</div>
              <div className="text-xs text-gray-500 mt-0.5">Rows in sheet</div>
            </div>
            <div className="bg-green-950/20 border border-green-800/40 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-green-400">{report.filled}</div>
              <div className="text-xs text-gray-500 mt-0.5">Filled from Hub</div>
            </div>
            <div className={`${report.notFound.length > 0 ? "bg-red-950/20 border-red-800/40" : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"} border rounded-xl p-3 text-center`}>
              <div className={`text-xl font-bold ${report.notFound.length > 0 ? "text-red-400" : "text-gray-900 dark:text-white"}`}>{report.notFound.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">UniqueID not in Hub</div>
            </div>
            <div className={`${issues > 0 ? "bg-amber-950/20 border-amber-800/40" : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"} border rounded-xl p-3 text-center`}>
              <div className={`text-xl font-bold ${issues > 0 ? "text-amber-400" : "text-gray-900 dark:text-white"}`}>{issues}</div>
              <div className="text-xs text-gray-500 mt-0.5">Things to check</div>
            </div>
          </div>

          {report.missingColumns.length > 0 && (
            <div className="border rounded-xl px-4 py-3 text-sm bg-amber-950/20 border-amber-800/40 text-amber-300">
              These columns weren&apos;t in what you pasted, so they were left as-is: <strong>{report.missingColumns.join(", ")}</strong>. If you expected them filled, copy the full sheet from the top-left.
            </div>
          )}

          <div className="space-y-2">
            <IdList label="UniqueIDs in the sheet with no matching lot in the Hub" ids={report.notFound} tone="red" />
            <IdList label="Lots with no estimate (left blank)" ids={report.missingEstimate} tone="amber" />
            <IdList label="Lots with no parcel size (Size Classification left blank)" ids={report.missingSize} tone="amber" />
            <IdList label="Lots with no category (left blank)" ids={report.missingCategory} tone="amber" />
            <IdList label="Used the AI estimate (no agreed estimate set)" ids={report.aiFallback} tone="blue" />
            <IdList label="Hub lots not present in the pasted sheet" ids={report.hubNotInSheet} tone="gray" />
          </div>
        </div>
      )}

      {/* Step 2 — paste back */}
      {output && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              2. Copy this back over the same top-left cell in Excel
            </label>
            <button onClick={copyOut}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${copied ? "bg-green-600 text-white" : "bg-[#C8A96E] hover:bg-[#b8945a] text-black"}`}>
              {copied ? "✓ Copied" : "Copy result"}
            </button>
          </div>
          <textarea
            value={output}
            readOnly
            spellCheck={false}
            onFocus={e => e.target.select()}
            className="w-full h-44 font-mono text-xs bg-gray-50 dark:bg-[#161618] border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-gray-900 dark:text-gray-300 focus:outline-none focus:border-[#C8A96E] resize-y whitespace-pre overflow-x-auto"
          />
          <p className="text-xs text-gray-500 mt-1.5">
            Same columns, same order, same rows — only the Hub-owned cells changed. In Excel, click the very first cell you copied from and paste.
          </p>
        </div>
      )}
    </div>
  )
}
