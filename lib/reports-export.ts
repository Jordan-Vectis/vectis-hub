import * as XLSX from "xlsx"

// Builds the "idle timers + lots, grouped per day" Excel workbook used by the
// cataloguing reports export. One sheet per cataloguer; inside each sheet the
// entries are grouped under a day header, listed with their EXACT clock time and
// duration, then a per-day totals line. Pure/synchronous — the route does the DB
// work and hands finished rows in here.

const UK_TZ = "Europe/London"
const dayKeyFmt   = new Intl.DateTimeFormat("en-CA", { timeZone: UK_TZ, year: "numeric", month: "2-digit", day: "2-digit" })          // yyyy-MM-dd
const dayLabelFmt = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" }) // "Mon 6 Jul 2026"
const timeFmt     = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) // "09:41:12"

/** Human duration, e.g. "1h 22m 5s". Blank-ish input → "—". */
export function fmtDur(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—"
  const t = Math.floor(ms / 1000)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Exact minutes (1 dp) — a numeric column so totals can be summed in Excel. */
function mins(ms: number): number {
  return Math.round((ms / 60000) * 10) / 10
}

function methodLabel(method: string): string {
  if (method === "WIZARD") return "Wizard"
  if (method === "PHOTO_ONLY") return "Photo only"
  return method
}

export type ExportEntry =
  | {
      kind: "LOT"
      ts: string // ISO instant
      durationMs: number
      method: string
      barcode: string | null
      keyPointsMs: number | null
      auctionCode: string
      auctionName: string
    }
  | {
      kind: "IDLE"
      ts: string // ISO instant
      durationMs: number
      reasonLabel: string
      toteNumbers: string | null
      notes: string | null
      auctionCode: string
      auctionName: string
    }

export type PersonReport = { userName: string; entries: ExportEntry[] }

const HEADER = ["Type", "Time", "Duration", "Mins", "Reason / Method", "Totes / Lot·Barcode", "Notes / Key Points", "Auction", "Auction name"]
const COL_WIDTHS = [6, 10, 12, 7, 18, 22, 34, 10, 26].map(wch => ({ wch }))

function sheetRowsForPerson(p: PersonReport, rangeLabel: string): (string | number)[][] {
  const rows: (string | number)[][] = []
  rows.push([`${p.userName}  —  ${rangeLabel}`])
  rows.push([])

  if (p.entries.length === 0) {
    rows.push(["No idle sessions or lots in this period."])
    return rows
  }

  rows.push(HEADER)

  // Group by London calendar day
  const byDay = new Map<string, ExportEntry[]>()
  for (const e of p.entries) {
    const key = dayKeyFmt.format(new Date(e.ts))
    const arr = byDay.get(key)
    if (arr) arr.push(e)
    else byDay.set(key, [e])
  }

  for (const dayKey of [...byDay.keys()].sort()) {          // ascending: earliest day first
    const entries = byDay.get(dayKey)!.sort((a, b) => a.ts.localeCompare(b.ts))
    const label = dayLabelFmt.format(new Date(entries[0].ts)).replace(",", "")
    rows.push([`──  ${label}  ──`])

    let lots = 0, catagMs = 0, idleMs = 0
    for (const e of entries) {
      if (e.kind === "LOT") {
        lots++; catagMs += e.durationMs
        rows.push([
          "LOT",
          timeFmt.format(new Date(e.ts)),
          fmtDur(e.durationMs),
          mins(e.durationMs),
          methodLabel(e.method),
          e.barcode ?? "",
          e.keyPointsMs ? fmtDur(e.keyPointsMs) : "",
          e.auctionCode,
          e.auctionName,
        ])
      } else {
        idleMs += e.durationMs
        rows.push([
          "IDLE",
          timeFmt.format(new Date(e.ts)),
          fmtDur(e.durationMs),
          mins(e.durationMs),
          e.reasonLabel,
          e.toteNumbers ?? "",
          e.notes ?? "",
          e.auctionCode,
          e.auctionName,
        ])
      }
    }
    rows.push(["Day totals", `${lots} lots`, `Cataloguing: ${fmtDur(catagMs)}`, mins(catagMs), `Idle: ${fmtDur(idleMs)}`, mins(idleMs)])
    rows.push([])
  }

  return rows
}

/** Sanitise a name into a valid, unique Excel sheet name (≤31 chars, no []:*?/\). */
function safeSheetName(name: string, used: Set<string>): string {
  let base = (name || "Cataloguer").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Cataloguer"
  let candidate = base
  let n = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/** Build the workbook as a Node Buffer ready to stream as an .xlsx download. */
export function buildReportsWorkbook(persons: PersonReport[], rangeLabel: string): Buffer {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()

  if (persons.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([["No idle sessions or lots in this period."], [rangeLabel]])
    XLSX.utils.book_append_sheet(wb, ws, "Report")
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  }

  for (const p of persons) {
    const ws = XLSX.utils.aoa_to_sheet(sheetRowsForPerson(p, rangeLabel))
    ws["!cols"] = COL_WIDTHS
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(p.userName, used))
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}
