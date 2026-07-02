import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getGuideSection, GUIDE_SECTIONS } from "@/lib/bc-warehouse-guide"
import { buildGuidePdf } from "@/lib/bc-warehouse-guide-pdf"

export const maxDuration = 60
export const runtime = "nodejs"

// GET /api/bc/warehouse-guide-pdf?section=heatmap
//
// Downloads ONE section of the BC Warehouse guide as a branded, printable A4
// PDF. Content lives in lib/bc-warehouse-guide.ts (shared with the 📖 Guide
// tab); rendering in lib/bc-warehouse-guide-pdf.ts (pdf-lib, shared logo).
// Access mirrors the BC Warehouse layout gate: admins or the BC_WAREHOUSE app.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "BC_WAREHOUSE")) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const id = req.nextUrl.searchParams.get("section")?.trim() ?? ""
    const section = getGuideSection(id)
    if (!section) {
      return NextResponse.json(
        { error: `Unknown section — use one of: ${GUIDE_SECTIONS.map((s) => s.id).join(", ")}` },
        { status: 404 },
      )
    }

    const pdfBytes = await buildGuidePdf(section)
    const filename = `bc-warehouse-guide-${section.id}.pdf`
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: any) {
    console.error("warehouse-guide-pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}
