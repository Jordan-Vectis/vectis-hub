import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import * as XLSX from "xlsx"
import { prisma } from "@/lib/prisma"
import { NOMINAL_COLUMNS } from "@/lib/accounting"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const monthId = req.nextUrl.searchParams.get("monthId")
    if (!monthId) return NextResponse.json({ error: "monthId required" }, { status: 400 })

    const month = await prisma.accountingMonth.findUnique({
      where: { id: monthId },
      include: { documents: { orderBy: { createdAt: "asc" } } },
    })
    if (!month) return NextResponse.json({ error: "Month not found" }, { status: 404 })

    const docs = month.documents
    const blank = NOMINAL_COLUMNS.map(() => "")

    // Cardholder grouping order: managed list first, then any historical value
    // still on a document (so nothing is dropped if a card was renamed/removed).
    const chRows = await prisma.accountingCardholder.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })
    const cardholderOrder = Array.from(new Set([...chRows.map((c) => c.name), ...docs.map((d) => d.cardholder)].filter(Boolean)))

    // ── Main sheet (April-26 style): grouped by cardholder, net in nominal cols ──
    const rows: (string | number)[][] = []
    rows.push(["", "Date", "Vat", "Value", "VAT", ...NOMINAL_COLUMNS.map((c) => c.label)])
    rows.push(["", "", "", "", "", ...NOMINAL_COLUMNS.map((c) => c.code)])

    for (const ch of cardholderOrder) {
      const chDocs = docs.filter((d) => d.cardholder === ch)
      if (chDocs.length === 0) continue
      rows.push([ch])
      let gTot = 0, vTot = 0
      const colTot: Record<string, number> = {}
      for (const d of chDocs) {
        const cols = NOMINAL_COLUMNS.map((c) => (c.key === d.column ? round(d.net) : ""))
        rows.push([d.supplier || "(no description)", fmtDate(d.docDate), d.vatCode, round(d.gross), d.vat ? round(d.vat) : "", ...cols])
        gTot += d.gross; vTot += d.vat
        colTot[d.column] = (colTot[d.column] ?? 0) + d.net
      }
      const totCols = NOMINAL_COLUMNS.map((c) => (colTot[c.key] ? round(colTot[c.key]) : ""))
      rows.push(["Total", "", "", round(gTot), vTot ? round(vTot) : "", ...totCols])
      rows.push([])
    }

    // Grand totals
    rows.push(["GRAND TOTAL", "", "", round(sum(docs.map((d) => d.gross))), round(sum(docs.map((d) => d.vat))), ...blank])

    const wsMain = XLSX.utils.aoa_to_sheet(rows)

    // ── VAT summary sheet ──
    const code1 = docs.filter((d) => d.vatCode === 1)
    const code2 = docs.filter((d) => d.vatCode === 2)
    const code7 = docs.filter((d) => d.vatCode === 7)
    const vatRows: (string | number)[][] = []
    vatRows.push(["VAT summary —", month.label])
    vatRows.push([])
    vatRows.push(["", "Date", "Vat", "Value", "VAT"])
    for (const d of code1) vatRows.push([d.supplier || "(no description)", fmtDate(d.docDate), 1, round(d.gross), round(d.vat)])
    vatRows.push(["Subtotal (code 1)", "", "", round(sum(code1.map((d) => d.gross))), round(sum(code1.map((d) => d.vat)))])
    vatRows.push([])
    for (const d of code2) vatRows.push([d.supplier || "(no description)", fmtDate(d.docDate), 2, round(d.gross), ""])
    vatRows.push(["Subtotal (code 2)", "", "", round(sum(code2.map((d) => d.gross))), ""])
    if (code7.length) {
      vatRows.push([])
      for (const d of code7) vatRows.push([d.supplier || "(no description)", fmtDate(d.docDate), 7, round(d.gross), ""])
      vatRows.push(["Subtotal (code 7)", "", "", round(sum(code7.map((d) => d.gross))), ""])
    }
    vatRows.push([])
    vatRows.push(["Total VAT reclaimable", "", "", "", round(sum(code1.map((d) => d.vat)))])
    vatRows.push(["Total value (all)", "", "", round(sum(docs.map((d) => d.gross))), ""])
    const wsVat = XLSX.utils.aoa_to_sheet(vatRows)

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsMain, month.label.slice(0, 31))
    XLSX.utils.book_append_sheet(wb, wsVat, ("VAT " + month.label).slice(0, 31))

    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })
    const filename = `Accounts ${month.label}.xlsx`.replace(/[^a-zA-Z0-9 ._-]/g, "")
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (e: any) {
    console.error("accounts/export error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

function round(n: number): number { return Math.round((n ?? 0) * 100) / 100 }
function sum(arr: number[]): number { return arr.reduce((a, b) => a + (b ?? 0), 0) }
function fmtDate(dt: Date | null): string {
  if (!dt) return ""
  const [y, m, d] = dt.toISOString().slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}
