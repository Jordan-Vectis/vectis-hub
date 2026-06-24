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
    const reconciledOnly = req.nextUrl.searchParams.get("reconciled") === "true"

    const month = await prisma.accountingMonth.findUnique({
      where: { id: monthId },
      include: { documents: { where: { reserved: false }, orderBy: { createdAt: "asc" } } },
    })
    if (!month) return NextResponse.json({ error: "Month not found" }, { status: 404 })

    let docs = month.documents

    if (reconciledOnly) {
      const stmts = await prisma.bankStatement.findMany({
        where: { monthId },
        include: { transactions: { select: { matchedDocIds: true, ignored: true } } },
      })
      const matchedIds = new Set<string>()
      for (const s of stmts) for (const t of s.transactions) if (!t.ignored) for (const id of t.matchedDocIds) matchedIds.add(id)
      docs = docs.filter((d) => matchedIds.has(d.id))
    }
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
      // Keep split-invoice parts next to each other (in first-appearance order).
      const chDocs = orderByGroup(docs.filter((d) => d.cardholder === ch))
      if (chDocs.length === 0) continue
      rows.push([ch])
      let gTot = 0, vTot = 0
      const colTot: Record<string, number> = {}
      const seenGroup = new Set<string>()
      for (const d of chDocs) {
        // Label split parts so they read as one invoice: continuation rows get "↳ "
        // and the category (item) is appended to tell them apart.
        const members = d.splitGroupId ? chDocs.filter((x) => x.splitGroupId === d.splitGroupId) : []
        const inGroup = members.length > 1
        const isCont = inGroup && !!d.splitGroupId && seenGroup.has(d.splitGroupId)
        if (d.splitGroupId) seenGroup.add(d.splitGroupId)
        const desc = inGroup
          ? `${isCont ? "↳ " : ""}${d.supplier || "(no description)"}${d.item ? " — " + d.item : ""}`
          : (d.supplier || "(no description)")
        const cols = NOMINAL_COLUMNS.map((c) => (c.key === d.column ? round(d.net) : ""))
        rows.push([desc, fmtDate(d.docDate), d.vatCode, round(d.gross), d.vat ? round(d.vat) : "", ...cols])
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
    const filename = (reconciledOnly ? `Reconciled ${month.label}.xlsx` : `Accounts ${month.label}.xlsx`).replace(/[^a-zA-Z0-9 ._-]/g, "")
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

// Keep split-group members contiguous (first-appearance order); singles stay put.
function orderByGroup<T extends { id: string; splitGroupId: string | null }>(items: T[]): T[] {
  const out: T[] = []
  const placed = new Set<string>()
  for (const r of items) {
    if (placed.has(r.id)) continue
    if (r.splitGroupId) {
      const members = items.filter((x) => x.splitGroupId === r.splitGroupId)
      if (members.length > 1) { for (const m of members) { out.push(m); placed.add(m.id) }; continue }
    }
    out.push(r); placed.add(r.id)
  }
  return out
}

function round(n: number): number { return Math.round((n ?? 0) * 100) / 100 }
function sum(arr: number[]): number { return arr.reduce((a, b) => a + (b ?? 0), 0) }
function fmtDate(dt: Date | null): string {
  if (!dt) return ""
  const [y, m, d] = dt.toISOString().slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}
