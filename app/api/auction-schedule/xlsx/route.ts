import { NextRequest, NextResponse } from "next/server"
import ExcelJS from "exceljs"
import { mondayOf, scheduleRows, ukYmd, weekEnding } from "@/lib/auction-schedule"
import { requireSchedule, weekForPrint } from "@/lib/auction-schedule-server"

// GET /api/auction-schedule/xlsx?week=YYYY-MM-DD — the week as an Excel file laid out like the old
// spreadsheet (title across the top, labels in A, two columns per sale — Saleroom | Vectis — merged
// on the sale-wide rows, pale blue on alternate rows).
// Same rows as the PDF (scheduleRows), so the two never disagree.

const SHADE = "FFD9E1F2"
const thin = { style: "thin" as const, color: { argb: "FF000000" } }
const border = { top: thin, left: thin, bottom: thin, right: thin }

export async function GET(req: NextRequest) {
  try {
    const who = await requireSchedule()
    const raw = req.nextUrl.searchParams.get("week") ?? ""
    const monday = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ukYmd(new Date()))
    const { sales, days } = await weekForPrint(monday, who)
    const rows = scheduleRows(sales, days)
    const title = `Auctioneering Schedule W/E ${weekEnding(monday)}`

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet("Schedule", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 } })
    // Two columns per sale (Saleroom | Vectis); the sale-wide rows merge each pair.
    const cols = Math.max(1, sales.length) * 2 + 1
    ws.columns = [{ width: 22 }, ...Array.from({ length: cols - 1 }, () => ({ width: 14 }))]

    ws.mergeCells(1, 1, 1, cols)
    const t = ws.getCell(1, 1)
    t.value = title
    t.font = { name: "Calibri", size: 16, bold: true }
    t.alignment = { horizontal: "center", vertical: "middle" }
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SHADE } }
    t.border = border
    ws.getRow(1).height = 24

    if (!sales.length) {
      ws.getCell(3, 1).value = "No sales are dated in this week."
    } else {
      rows.forEach((r, i) => {
        const row = ws.getRow(i + 3)
        row.values = r.split ? [r.label, ...r.cells] : [r.label, ...r.cells.flatMap(c => [c, ""])]
        if (!r.split) for (let s = 0; s < sales.length; s++) ws.mergeCells(i + 3, 2 + s * 2, i + 3, 3 + s * 2)
        row.eachCell({ includeEmpty: true }, (c, n) => {
          if (n > cols) return
          c.font = { name: "Calibri", size: r.small ? 10 : 12, bold: r.label === "Sale" || r.label === "Sale No." }
          c.alignment = { vertical: "middle", wrapText: true }
          c.border = border
          if (r.shaded) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SHADE } }
        })
      })
    }

    const buf = await wb.xlsx.writeBuffer()
    return new NextResponse(Buffer.from(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Auctioneering Schedule ${monday}.xlsx"`,
      },
    })
  } catch (e: any) {
    if (!e?.http) console.error("auction-schedule xlsx:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })
  }
}
