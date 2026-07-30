import { NextRequest, NextResponse } from "next/server"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { prisma } from "@/lib/prisma"
import { getBCToken } from "@/lib/bc"
import { computeBcToteDates } from "@/lib/bc-tote-dates"
import { buildBcToteDatesPdf } from "@/lib/bc-tote-dates-pdf"

export const maxDuration = 120
export const runtime = "nodejs"

// GET /api/manager-portal/bc-tote-dates/pdf[?totes=1]
//
// PDF of the Manager Portal → Departments "Using totes from — Business Central
// categories" table. Same figures as the screen: both call computeBcToteDates.
// `?totes=1` appends the 10 totes behind each category's month.
//
// ⚠ Categories an admin has hidden are excluded here too — the hidden set is
// passed into computeBcToteDates exactly as the on-screen route does it, so the
// export never leaks a category that was hidden from the table.
export async function GET(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "MANAGER_PORTAL")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const token = await getBCToken()
    if (!token) {
      return NextResponse.json({ error: "Business Central isn't connected — connect it from the top bar, then export again." }, { status: 503 })
    }

    // Hidden categories must be left out of the export as well. ⚠ The table
    // arrives with Run Migrations while code deploys instantly, so treat a
    // missing table as "nothing hidden" rather than failing the export.
    let hidden: { category: string }[] = []
    try {
      hidden = await prisma.managerPortalHiddenCategory.findMany({ select: { category: true } })
    } catch { hidden = [] }

    const data = await computeBcToteDates(token, new Set(hidden.map(h => h.category)))
    const includeTotes = req.nextUrl.searchParams.get("totes") === "1"
    const pdfBytes = await buildBcToteDatesPdf(data, Date.now(), { includeTotes })

    const filename = `using-totes-from-${new Date().toISOString().slice(0, 10)}.pdf`
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: unknown) {
    console.error("manager-portal/bc-tote-dates/pdf error:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "PDF generation failed" }, { status: 500 })
  }
}
