import { NextRequest, NextResponse } from "next/server"
import { isJordan } from "@/lib/jordan-auth"
import { normaliseCv } from "@/lib/jordan-cv"
import { buildCvPdf, buildLetterPdf } from "@/lib/jordan-cv-pdf"

export const maxDuration = 60

// POST /api/jordan/cv/pdf — { kind: "cv" | "letter", cv, letter?, company?, jobTitle?, filename? }
// Returns the finished PDF. Built server-side with pdf-lib, per RULES.md.
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { kind = "cv", cv, letter = "", company = "", jobTitle = "", filename } = await req.json()
    const doc = normaliseCv(cv)

    if (kind === "letter" && !String(letter).trim()) {
      return NextResponse.json({ error: "There's no covering letter to save yet." }, { status: 400 })
    }

    const bytes = kind === "letter"
      ? await buildLetterPdf(doc, String(letter), { company, jobTitle })
      : await buildCvPdf(doc)

    const safe = String(filename || (kind === "letter" ? "Covering letter" : doc.name || "CV"))
      .replace(/[^\w\s.-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "document"

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safe}.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (e: any) {
    console.error("jordan/cv/pdf:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
