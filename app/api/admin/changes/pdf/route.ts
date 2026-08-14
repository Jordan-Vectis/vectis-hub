import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { buildChangesReportPdf } from "@/lib/changes-pdf"

export const maxDuration = 120

// POST /api/admin/changes/pdf
// Body: { title, body, periodFrom, periodTo, changeCount, createdBy? }
//
// The client posts the report it is showing, rather than passing an id, so the
// same button works for a draft that hasn't been saved yet and for a saved one —
// and what prints is exactly what is on screen, including any edits. Same
// approach as the BC Warehouse table PDFs.

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const b = await req.json().catch(() => ({}))
    const title = String(b?.title ?? "").trim() || "Vectis Hub progress report"
    const body  = String(b?.body ?? "").trim()
    if (!body) return NextResponse.json({ error: "There's no report to print yet." }, { status: 400 })

    const periodFrom = new Date(b?.periodFrom)
    const periodTo   = new Date(b?.periodTo)
    if (isNaN(periodFrom.getTime()) || isNaN(periodTo.getTime())) {
      return NextResponse.json({ error: "That period isn't valid." }, { status: 400 })
    }

    const pdfBytes = await buildChangesReportPdf({
      title,
      body,
      periodFrom,
      periodTo,
      changeCount: Number.isFinite(Number(b?.changeCount)) ? Number(b.changeCount) : 0,
      createdBy: typeof b?.createdBy === "string" ? b.createdBy : (session.user.name ?? null),
    })

    const niceName = `${title}.pdf`
    // Content-Disposition must be Latin-1 — plain ASCII filename, plus a UTF-8
    // filename* for modern browsers.
    const asciiName = niceName
      .replace(/[^\x20-\x7E]/g, "-")
      .replace(/[\/\\?%*:|"<>]/g, "-")
      .replace(/-+/g, "-")
      .replace(/\s+/g, " ")
      .trim()

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(niceName)}`,
        "Content-Length":      String(pdfBytes.length),
        "Cache-Control":       "no-store",
      },
    })
  } catch (e: any) {
    console.error("changes pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}
