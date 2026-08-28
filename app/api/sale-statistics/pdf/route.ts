import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { buildSaleStatsPdf } from "@/lib/stats-pdf"
import {
  reportFilename,
  type SaleStatsReport, type ReportTable, type ReportColumn, type ReportStat, type CellFormat,
} from "@/lib/sale-stats-report"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

// POST /api/sale-statistics/pdf — turns the report object the Sale Statistics screen built into
// a branded A4 landscape PDF.
//
// ⚠ THE SCREEN SENDS THE NUMBERS, this route does not recalculate them. That is deliberate: the
// figures come from a streamed Business Central query that can take minutes, and re-running it
// here would (a) double the load for one button and (b) let the PDF disagree with the screen it
// was exported from, which is the one thing a report must never do. The trade-off is that this
// route trusts an authenticated user's arithmetic — acceptable, because they are exporting their
// own screen and could type any number into a spreadsheet anyway.
//
// It does NOT trust the shape. A malformed or enormous payload is rejected before pdf-lib sees it.

const MAX_TABLES = 12
const MAX_ROWS   = 5000
const MAX_COLS   = 30
const MAX_STATS  = 24
const FORMATS: CellFormat[] = ["text", "money", "money2", "moneySigned", "int", "pct", "pctSigned", "auto", "autoSigned"]

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "")

function parseColumn(v: unknown): ReportColumn {
  const o = (v ?? {}) as Record<string, unknown>
  const format = FORMATS.includes(o.format as CellFormat) ? (o.format as CellFormat) : "text"
  return { label: str(o.label, 60), format }
}

function parseTable(v: unknown): ReportTable | null {
  const o = (v ?? {}) as Record<string, unknown>
  if (!Array.isArray(o.columns) || !Array.isArray(o.rows)) return null
  const columns = o.columns.slice(0, MAX_COLS).map(parseColumn)
  if (!columns.length) return null
  const rows = o.rows.slice(0, MAX_ROWS).map(r => {
    const arr = Array.isArray(r) ? r : []
    // Padded to the column count so a short row can never shift cells left under the wrong header.
    return columns.map((_, i) => {
      const cell = arr[i]
      if (typeof cell === "number" && isFinite(cell)) return cell
      return str(cell, 200)
    })
  })
  // Parallel to rows — a short or absent array simply means "use the column format".
  const rowFormat = Array.isArray(o.rowFormat)
    ? o.rowFormat.slice(0, MAX_ROWS).map(f => (FORMATS.includes(f as CellFormat) ? (f as CellFormat) : "text"))
    : undefined

  return { title: str(o.title, 120), note: str(o.note, 300) || undefined, columns, rows, rowFormat }
}

function parseReport(body: unknown): SaleStatsReport {
  const o = (body ?? {}) as Record<string, unknown>
  const stats: ReportStat[] = Array.isArray(o.stats)
    ? o.stats.slice(0, MAX_STATS).map(s => {
        const t = (s ?? {}) as Record<string, unknown>
        return { label: str(t.label, 40), value: str(t.value, 40), sub: str(t.sub, 60) || undefined }
      })
    : []
  const tables = Array.isArray(o.tables)
    ? o.tables.slice(0, MAX_TABLES).map(parseTable).filter((t): t is ReportTable => t !== null)
    : []
  return {
    title:       str(o.title, 120) || "Sale Statistics",
    subtitle:    str(o.subtitle, 300),
    generatedAt: str(o.generatedAt, 40) || new Date().toISOString(),
    generatedBy: str(o.generatedBy, 80),
    stats,
    tables,
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const report = parseReport(await req.json())
    if (!report.tables.length && !report.stats.length) {
      return NextResponse.json({ error: "Nothing to export — load some figures first" }, { status: 400 })
    }

    const bytes = await buildSaleStatsPdf(report)
    const name  = reportFilename(report, "pdf")
    // Content-Disposition values must be Latin-1; reportFilename already reduces to [A-Za-z0-9_],
    // but the belt-and-braces pair is what the other PDF routes here send.
    const ascii = name.replace(/[^\x20-\x7E]/g, "_")

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control":       "no-store",
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "PDF generation failed"
    console.error("sale-statistics/pdf error:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
