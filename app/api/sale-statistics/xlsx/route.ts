import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { buildSaleStatsXlsx } from "@/lib/stats-xlsx"
import { parseReportPayload, reportFilename } from "@/lib/sale-stats-report"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

// POST /api/sale-statistics/xlsx — the report object the Sale Statistics screen built, as a
// formatted workbook. Same payload and the same rules as the PDF route beside it: the screen has
// already aggregated the figures, so this renders them rather than re-running the streamed
// Business Central query, which would double the load and let an export disagree with the screen
// it came from. The SHAPE is validated (parseReportPayload); the arithmetic is the user's own.
//
// Server-side because ExcelJS writes real cell formatting and is far too heavy to ship to a
// browser that mostly never presses the button.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const report = parseReportPayload(await req.json())
    if (!report.tables.length && !report.stats.length) {
      return NextResponse.json({ error: "Nothing to export — load some figures first" }, { status: 400 })
    }

    const bytes = await buildSaleStatsXlsx(report)
    const name  = reportFilename(report, "xlsx")
    const ascii = name.replace(/[^\x20-\x7E]/g, "_")

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control":       "no-store",
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Spreadsheet generation failed"
    console.error("sale-statistics/xlsx error:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
