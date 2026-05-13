// Minimal RFC 4180 CSV parser. Handles quoted fields with embedded newlines
// and escaped double-quotes (""). Outlook's CSV export uses this format.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[]      = []
  let field              = ""
  let i                  = 0
  let inQuotes           = false

  // Strip BOM if present — Outlook often writes UTF-8 with BOM.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  while (i < text.length) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }

    if (c === '"')  { inQuotes = true; i++; continue }
    if (c === ",")  { row.push(field); field = ""; i++; continue }
    if (c === "\r") { i++; continue }
    if (c === "\n") {
      row.push(field); field = ""
      // Skip blank rows (can appear at EOF)
      if (row.length > 1 || row[0] !== "") rows.push(row)
      row = []; i++; continue
    }
    field += c; i++
  }

  // Last row (no trailing newline)
  if (field !== "" || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== "") rows.push(row)
  }
  return rows
}

// Convert parsed rows to objects keyed by header.
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return []
  const headers = rows[0].map(h => h.trim())
  return rows.slice(1).map(r => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = r[i] ?? "" })
    return obj
  })
}
