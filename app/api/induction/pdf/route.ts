import { NextRequest, NextResponse } from "next/server"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { prisma } from "@/lib/prisma"
import { buildInductionSignaturePdf } from "@/lib/induction-pdf"

export const maxDuration = 60
export const runtime = "nodejs"

// GET /api/induction/pdf?id=<signature id>
// One signed induction form as a PDF — the copy that goes in the personnel file.
// Behind the login and the INDUCTION permission: these rows hold someone's name and their
// actual signature, so they are never served to anyone without it.
export async function GET(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true } })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "INDUCTION")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const id = req.nextUrl.searchParams.get("id") ?? ""
    if (!id) return NextResponse.json({ error: "No record given" }, { status: 400 })

    const rec = await prisma.inductionSignature.findUnique({ where: { id } })
    if (!rec) return NextResponse.json({ error: "That record no longer exists" }, { status: 404 })

    const pdfBytes = await buildInductionSignaturePdf({
      id: rec.id,
      formTitle: rec.formTitle,
      bodySnapshot: rec.bodySnapshot,
      declarationSnapshot: rec.declarationSnapshot,
      items: rec.items,
      personName: rec.personName,
      company: rec.company,
      jobTitle: rec.jobTitle,
      startDate: rec.startDate,
      notes: rec.notes,
      signature: rec.signature,
      takenByName: rec.takenByName,
      signedAt: rec.signedAt,
    })

    const safeName = rec.personName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "record"
    const filename = `induction-${safeName}-${rec.signedAt.toISOString().slice(0, 10)}.pdf`
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: any) {
    console.error("induction/pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}
