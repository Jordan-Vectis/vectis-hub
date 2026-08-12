"use client"

import { useMemo, useState } from "react"
import { readSheet, parseBcLinesExport, buildHotkeyCsv, normSheetVal, type HotkeyToteRow, type BcErrorFlag } from "@/lib/bc-import-sheets"

interface Lot {
  id: string
  barcode: string | null
  receipt: string | null
  receiptUniqueId: string | null
  title: string
}

interface Props {
  lots: Lot[]
  auctionCode: string
}

/**
 * Catch-up sheet for ONE sale.
 *
 * The End of Day sheet works out "already in BC" from the synced BC cache and covers every
 * non-complete sale at once; the Import Check panel needs the original hotkey sheet that ran.
 * Neither helps when a single sale has been fed into BC over several days, so this takes the
 * BC export as the ONLY source of truth for what is already in — no sync involved, which is
 * what makes it correct mid-sale when the sync is behind.
 *
 * ⚠ Matching is by BARCODE ONLY (RULES.md). Legacy Hub-minted {receipt}-N unique IDs collide
 * with BC's own numbering for other items, so a uniqueId "match" can point at a different lot.
 *
 * Read-only — it writes nothing, it just produces the CSV.
 */
export default function CatchupSheetTab({ lots, auctionCode }: Props) {
  const [bc, setBc]         = useState<{ barcodes: Set<string>; errors: BcErrorFlag[] } | null>(null)
  const [fileName, setName] = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      setBc(parseBcLinesExport(await readSheet(file)))
      setName(file.name)
    } catch (err: any) {
      setBc(null); setName(null)
      setError(err?.message ?? "Could not read that file.")
    }
    e.target.value = ""
  }

  const result = useMemo(() => {
    if (!bc) return null

    const noBarcode = lots.filter(l => !l.barcode?.trim())
    const withCode  = lots.filter(l => l.barcode?.trim())

    // ⚠ Ask "is it in BC?" FIRST. Checking the receipt first reported a lot that is already
    // safely in BC as a problem to go and fix, and left it out of the Already in BC count.
    const inBc      = (l: Lot) => bc.barcodes.has(normSheetVal(l.barcode))
    const alreadyIn = withCode.filter(inBc)
    const pending   = withCode.filter(l => !inBc(l))

    const noReceipt = pending.filter(l => !l.receipt?.trim())
    const sheetable = pending.filter(l => l.receipt?.trim())
    let   missing   = sheetable

    // Same rule as the End of Day sheet: a barcode sitting under two different receipts must
    // come OFF the sheet, visibly. Importing it would create the BC line on the wrong receipt.
    const receiptsByBarcode = new Map<string, Set<string>>()
    for (const l of missing) {
      const b = normSheetVal(l.barcode)
      if (!receiptsByBarcode.has(b)) receiptsByBarcode.set(b, new Set())
      receiptsByBarcode.get(b)!.add(normSheetVal(l.receipt))
    }
    const dupBarcodes = new Set([...receiptsByBarcode.entries()].filter(([, r]) => r.size > 1).map(([b]) => b))
    const duplicates  = missing.filter(l => dupBarcodes.has(normSheetVal(l.barcode)))
    missing = missing.filter(l => !dupBarcodes.has(normSheetVal(l.barcode)))

    // One row per receipt, barcodes deduped within it, receipts sorted numerically — the exact
    // shape the macro expects, identical to the End of Day sheet.
    // ⚠ Dedup within a receipt drops the SECOND lot sharing a barcode. That is right for the
    // sheet — one label, one BC line — but it used to happen silently: the lot appeared in no
    // panel and no tile, so the counts didn't add up and there was no way to find it.
    const sameReceiptDupes: Lot[] = []
    const byReceipt = new Map<string, { receipt: string; barcodes: string[]; seen: Set<string> }>()
    for (const l of missing) {
      const receipt = normSheetVal(l.receipt)
      let g = byReceipt.get(receipt)
      if (!g) { g = { receipt, barcodes: [], seen: new Set() }; byReceipt.set(receipt, g) }
      const b = l.barcode!.trim()
      if (!g.seen.has(b.toUpperCase())) { g.seen.add(b.toUpperCase()); g.barcodes.push(b) }
      else sameReceiptDupes.push(l)
    }
    const rows: HotkeyToteRow[] = [...byReceipt.values()]
      .sort((a, b) => a.receipt.localeCompare(b.receipt, "en-GB", { numeric: true }))
      .map(g => ({ tote: g.receipt, barcodes: g.barcodes }))

    // Rows in the export that aren't in this sale are NORMAL — the overnight macro puts every
    // sale's lots into one BC sale, so the export spans several. Noted, never flagged.
    const ourCodes = new Set(withCode.map(l => normSheetVal(l.barcode)))
    let otherSales = 0
    for (const b of bc.barcodes) if (!ourCodes.has(b)) otherSales++

    return { noBarcode, noReceipt, alreadyIn, missing, duplicates, sameReceiptDupes, rows, otherSales,
             sheetLots: rows.reduce((n, r) => n + r.barcodes.length, 0) }
  }, [bc, lots])

  function download() {
    if (!result?.rows.length) return
    const blob = new Blob([buildHotkeyCsv(result.rows)], { type: "text/csv;charset=utf-8" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    // The macro looks for this exact filename — don't date it.
    a.href = url; a.download = "BC_Import.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const drop = "relative flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 cursor-pointer hover:border-[#C8A96E] transition-colors text-center"

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">📄 Catch-up sheet</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
          For a sale that has gone into BC in stages. Upload the BC export of what is already in, and this
          gives you a fresh <span className="font-mono">BC_Import.csv</span> of everything in{" "}
          <span className="font-mono font-semibold">{auctionCode}</span> that is still missing — ready for the macro.
          Your upload is the only thing it trusts, so it does not matter how out of date the BC data sync is.
        </p>
      </div>

      <label className={drop}>
        <span className="text-3xl">📋</span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {fileName ?? "Click to upload the BC export (what's already in BC)"}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          XLSX/CSV with an Internal Barcode column{fileName ? " · click to use a different file" : ""}
        </span>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="sr-only" />
      </label>

      {error && (
        <div className="rounded-xl border border-red-300 dark:border-red-700/60 bg-red-50 dark:bg-red-900/15 px-4 py-3 text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Lots in this sale" value={lots.length} />
            <Tile label="Already in BC" value={result.alreadyIn.length} sub="per your upload" tone="good" />
            <Tile label="Still missing" value={result.sheetLots} sub={`${result.rows.length} receipt${result.rows.length === 1 ? "" : "s"}`} tone={result.sheetLots > 0 ? "warn" : "plain"} />
            <Tile label="Can't go on a sheet" value={result.noBarcode.length + result.noReceipt.length + result.duplicates.length + result.sameReceiptDupes.length}
              sub={result.noBarcode.length + result.noReceipt.length + result.duplicates.length + result.sameReceiptDupes.length > 0 ? "listed below" : undefined}
              tone={result.noBarcode.length + result.noReceipt.length + result.duplicates.length + result.sameReceiptDupes.length > 0 ? "bad" : "plain"} />
          </div>

          {result.sheetLots > 0 ? (
            <button onClick={download}
              className="px-5 py-2.5 bg-[#2AB4A6] hover:bg-[#239a8e] text-white font-semibold text-sm rounded-lg transition-colors">
              ⬇ Download BC_Import.csv ({result.sheetLots} lot{result.sheetLots === 1 ? "" : "s"}, {result.rows.length} receipt{result.rows.length === 1 ? "" : "s"})
            </button>
          ) : (
            <div className="rounded-xl border border-green-300 dark:border-green-700/60 bg-green-50 dark:bg-green-900/15 px-4 py-3 text-sm text-green-800 dark:text-green-300">
              ✓ Nothing left to import — every lot in this sale that can go on a sheet is already in BC.
            </div>
          )}

          {result.otherSales > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {result.otherSales} barcode{result.otherSales === 1 ? "" : "s"} in your export {result.otherSales === 1 ? "is" : "are"} not
              in this sale — normal, the overnight run puts several sales into one BC sale.
            </p>
          )}

          {result.duplicates.length > 0 && (
            <Problem tone="bad" title={`${result.duplicates.length} lot${result.duplicates.length === 1 ? "" : "s"} held back — same barcode under two receipts`}
              note="Left off the sheet on purpose: importing one would put the BC line on the wrong receipt. Fix the receipt on these lots, then take the sheet again."
              lots={result.duplicates} />
          )}
          {result.sameReceiptDupes.length > 0 && (
            <Problem tone="warn" title={`${result.sameReceiptDupes.length} lot${result.sameReceiptDupes.length === 1 ? "" : "s"} share a barcode with another lot on the same receipt`}
              note="Only one of each barcode goes on the sheet — one label, one line in BC. These are the extras. If they are genuinely separate items they need their own barcodes."
              lots={result.sameReceiptDupes} />
          )}
          {result.noReceipt.length > 0 && (
            <Problem tone="warn" title={`${result.noReceipt.length} lot${result.noReceipt.length === 1 ? "" : "s"} have no receipt`}
              note="The sheet is receipt-keyed, so these cannot go on it. Set a receipt (Manage Lots → Change Vendor) and take the sheet again."
              lots={result.noReceipt} />
          )}
          {result.noBarcode.length > 0 && (
            <Problem tone="warn" title={`${result.noBarcode.length} lot${result.noBarcode.length === 1 ? "" : "s"} have no barcode`}
              note="A lot with no barcode cannot be matched against BC or imported by the macro."
              lots={result.noBarcode} />
          )}

          {bc && bc.errors.length > 0 && (
            <div className="rounded-xl border border-red-300 dark:border-red-700/60 bg-red-50 dark:bg-red-900/15 p-4">
              <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                ⚠ BC flagged {bc.errors.length} row{bc.errors.length === 1 ? "" : "s"} in your export with an error
              </p>
              <p className="text-xs text-gray-700 dark:text-gray-300 mt-1">
                These are in BC but it did not like them — worth a look before you run the sheet.
              </p>
              <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
                {bc.errors.slice(0, 200).map((e, i) => (
                  <div key={i} className="text-xs font-mono flex flex-wrap gap-x-3 text-gray-800 dark:text-gray-200">
                    <span className="font-semibold">{e.barcode}</span>
                    {e.uniqueId && <span className="text-gray-500 dark:text-gray-400">{e.uniqueId}</span>}
                    <span className="text-red-700 dark:text-red-300">{e.error}</span>
                  </div>
                ))}
                {bc.errors.length > 200 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">…and {bc.errors.length - 200} more.</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Tile({ label, value, sub, tone = "plain" }: { label: string; value: number; sub?: string; tone?: "plain" | "good" | "warn" | "bad" }) {
  const toneCls = tone === "good" ? "text-green-700 dark:text-green-400"
    : tone === "warn" ? "text-amber-700 dark:text-amber-400"
    : tone === "bad"  ? "text-red-700 dark:text-red-400"
    : "text-gray-900 dark:text-white"
  return (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl p-3 text-center">
      <p className={`text-2xl font-bold ${toneCls}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function Problem({ tone, title, note, lots }: { tone: "warn" | "bad"; title: string; note: string; lots: Lot[] }) {
  const cls = tone === "bad"
    ? "border-red-300 dark:border-red-700/60 bg-red-50 dark:bg-red-900/15"
    : "border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/15"
  const head = tone === "bad" ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className={`text-sm font-semibold ${head}`}>{title}</p>
      <p className="text-xs text-gray-700 dark:text-gray-300 mt-1">{note}</p>
      <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
        {lots.slice(0, 200).map(l => (
          <div key={l.id} className="text-xs flex flex-wrap gap-x-3 text-gray-800 dark:text-gray-200">
            <span className="font-mono font-semibold">{l.barcode || "no barcode"}</span>
            {l.receipt && <span className="font-mono text-gray-500 dark:text-gray-400">{l.receipt}</span>}
            <span className="truncate max-w-md">{l.title}</span>
          </div>
        ))}
        {lots.length > 200 && <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">…and {lots.length - 200} more.</p>}
      </div>
    </div>
  )
}
