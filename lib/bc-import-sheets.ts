// Shared engine for reading and reconciling the two BC-import spreadsheets:
//   • the HOTKEY SHEET (ToteNumber / LotCount / pipe-separated Barcodes) — the
//     to-do list End of Day → BC generates and the overnight macro runs through
//   • the BC LINES EXPORT (Internal Barcode / Receipt No. / UniqueID / Errors)
//     — what actually made it into Business Central
//
// ONE copy of the parsing/reconcile logic, used by BOTH the Auction AI →
// BC Import Check tab and the End of Day → BC morning-after tools. Client-safe
// (no server imports) — parsing happens in the browser, the file never leaves it.

import * as XLSX from "xlsx"

export const normSheetVal = (s: unknown) => String(s ?? "").trim().toUpperCase()

// "Errors"/"Warnings" in the BC export are numeric counts — 0 means no error.
// A non-empty, non-zero number (or any text) counts as a real error to flag.
export const hasSheetError = (v: unknown) => {
  const s = String(v ?? "").trim()
  if (!s) return false
  const n = Number(s)
  return Number.isFinite(n) ? n > 0 : true
}

export async function readSheet(file: File): Promise<unknown[][]> {
  const name = file.name.toLowerCase()
  let wb: XLSX.WorkBook
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    // Force comma as the separator — the hotkey sheet's Barcodes column is
    // pipe-heavy, and XLSX's delimiter auto-detect would wrongly split on "|".
    const text = (await file.text()).replace(/^﻿/, "")
    wb = XLSX.read(text, { type: "string", FS: "," })
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as unknown[][]
}

export function findCol(headers: unknown[], ...names: string[]): number {
  const wanted = names.map(n => n.toLowerCase())
  return headers.findIndex(h => wanted.includes(String(h).trim().toLowerCase()))
}

export type HotkeyToteRow = { tote: string; barcodes: string[] }
export type BcErrorFlag   = { barcode: string; uniqueId: string; tote: string; error: string }
export type BcLinesRow    = { barcode: string; bcReceipt: string; bcUniqueId: string }

export function parseHotkeySheet(rows: unknown[][]): HotkeyToteRow[] {
  if (rows.length < 2) throw new Error("The hotkey sheet looks empty.")
  const headers = rows[0]
  const toteCol     = findCol(headers, "ToteNumber", "Tote No.", "Tote", "Receipt No.")
  const barcodesCol = findCol(headers, "Barcodes", "Barcode")
  if (barcodesCol < 0) throw new Error('Could not find a "Barcodes" column in the hotkey sheet.')
  const out: HotkeyToteRow[] = []
  for (let r = 1; r < rows.length; r++) {
    const tote = String(rows[r][toteCol] ?? "").trim()
    const barcodes = String(rows[r][barcodesCol] ?? "").split("|").map(b => b.trim()).filter(Boolean)
    if (barcodes.length) out.push({ tote, barcodes })
  }
  if (!out.length) throw new Error("No barcodes found in the hotkey sheet.")
  return out
}

// The done-so-far side of the reconcile: which barcodes are in BC, and which
// of them BC flagged with an error.
export function parseBcLinesExport(rows: unknown[][]): { barcodes: Set<string>; errors: BcErrorFlag[] } {
  if (rows.length < 2) throw new Error("The BC export looks empty.")
  const headers = rows[0]
  const bcCol   = findCol(headers, "Internal Barcode", "Barcode")
  const errCol  = findCol(headers, "Errors", "Error")
  const uidCol  = findCol(headers, "UniqueID")
  const toteCol = findCol(headers, "Tote No.", "ToteNumber", "Tote", "Receipt No.")
  if (bcCol < 0) throw new Error('Could not find an "Internal Barcode" column in the BC export.')
  const barcodes = new Set<string>()
  const errors: BcErrorFlag[] = []
  for (let r = 1; r < rows.length; r++) {
    const raw = String(rows[r][bcCol] ?? "").trim()
    if (!raw) continue
    barcodes.add(normSheetVal(raw))
    if (errCol >= 0 && hasSheetError(rows[r][errCol])) errors.push({
      barcode: raw,
      error: String(rows[r][errCol] ?? "").trim(),
      uniqueId: uidCol  >= 0 ? String(rows[r][uidCol]  ?? "").trim() : "",
      tote:     toteCol >= 0 ? String(rows[r][toteCol] ?? "").trim() : "",
    })
  }
  return { barcodes, errors }
}

// The BC-Match side: barcode → receipt + BC's UniqueID, one row per line.
export function parseBcLinesForMatch(rows: unknown[][]): BcLinesRow[] {
  if (rows.length < 2) throw new Error("The BC export looks empty.")
  const headers = rows[0]
  const bcCol  = findCol(headers, "Internal Barcode", "Barcode")
  const rcCol  = findCol(headers, "Receipt No.", "ReceiptNo", "Receipt")
  const uidCol = findCol(headers, "UniqueID")
  if (bcCol < 0)  throw new Error('Could not find an "Internal Barcode" column in the BC export.')
  if (uidCol < 0) throw new Error('Could not find a "UniqueID" column in the BC export.')
  const out: BcLinesRow[] = []
  for (let r = 1; r < rows.length; r++) {
    const barcode = String(rows[r][bcCol] ?? "").trim()
    if (!barcode) continue
    out.push({
      barcode,
      bcReceipt:  rcCol >= 0 ? String(rows[r][rcCol] ?? "").trim() : "",
      bcUniqueId: String(rows[r][uidCol] ?? "").trim(),
    })
  }
  if (!out.length) throw new Error("No barcodes found in the BC export.")
  return out
}

export type ImportCheckResult = {
  remainingTotes: HotkeyToteRow[]
  totalHotkey: number
  totalRemaining: number
  totalDone: number
  errors: BcErrorFlag[]
}

export function reconcileImport(hotkey: HotkeyToteRow[], bc: { barcodes: Set<string>; errors: BcErrorFlag[] }): ImportCheckResult {
  const done = bc.barcodes
  const remainingTotes: HotkeyToteRow[] = []
  let totalHotkey = 0, totalRemaining = 0
  for (const t of hotkey) {
    totalHotkey += t.barcodes.length
    const remaining = t.barcodes.filter(b => !done.has(normSheetVal(b)))
    totalRemaining += remaining.length
    if (remaining.length) remainingTotes.push({ tote: t.tote, barcodes: remaining })
  }
  return { remainingTotes, totalHotkey, totalRemaining, totalDone: totalHotkey - totalRemaining, errors: bc.errors }
}

export function buildHotkeyCsv(totes: HotkeyToteRow[]): string {
  const lines = ["ToteNumber,LotCount,Barcodes"]
  for (const t of totes) lines.push(`${t.tote},${t.barcodes.length},${t.barcodes.join("|")}`)
  return lines.join("\r\n")
}
