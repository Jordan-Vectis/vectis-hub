import { NextRequest, NextResponse } from "next/server"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { prisma } from "@/lib/prisma"
import { computeIdleReport, resolveRange, RANGES } from "@/lib/idle-report"
import { buildIdleReportPdf } from "@/lib/idle-report-pdf"

export const maxDuration = 60
export const runtime = "nodejs"

// GET /api/reports/idle/pdf?range=30d
// Exportable PDF of the Cataloguer Activity Report. Same figures as the on-screen
// page (both call computeIdleReport). Server-side pdf-lib — serverless-safe.
export async function GET(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true } })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "REPORTS")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const isAdmin = dbUser?.role === "ADMIN"

    const activeRange = resolveRange(req.nextUrl.searchParams.get("range") ?? undefined)
    // Same lens as the page — a PDF that silently disagreed with the screen it was
    // exported from would be worse than no PDF.
    const excludeLunch = req.nextUrl.searchParams.get("lunch") === "off"
    const data = await computeIdleReport(activeRange, isAdmin, excludeLunch)
    const rangeLabel = RANGES.find(r => r.key === activeRange)?.label ?? "All time"

    // ⚠ Say it on the PDF. A report with lunch quietly removed could be read as the full
    // picture in a conversation about someone's day — the scope must travel with the file.
    const pdfBytes = await buildIdleReportPdf(
      data,
      excludeLunch ? `${rangeLabel} (excluding lunch breaks)` : rangeLabel,
      isAdmin,
    )
    const filename = `cataloguer-activity-${activeRange}-${new Date().toISOString().slice(0, 10)}.pdf`
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: any) {
    console.error("reports/idle/pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}
