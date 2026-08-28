import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { buildSaleStatsPdf } from "@/lib/stats-pdf"
import { parseReportPayload, reportFilename } from "@/lib/sale-stats-report"

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
// It does NOT trust the shape — parseReportPayload rejects a malformed or enormous payload before
// pdf-lib sees it, and the xlsx route beside this one shares exactly the same parsing.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const report = parseReportPayload(await req.json())
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
