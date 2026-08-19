import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { normaliseCv } from "@/lib/jordan-cv"

// /api/jordan/cv/applications — the jobs a profile has been tailored for.
// GET ?profileId=…  ·  PUT (edit the letter/CV after the AI's pass)  ·  DELETE
function missingTable(e: any): boolean {
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(String(e?.message ?? e))
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const profileId = req.nextUrl.searchParams.get("profileId") ?? ""
    if (!profileId) return NextResponse.json({ applications: [] })

    const rows = await prisma.jordanCvApplication.findMany({
      where: { profileId },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    return NextResponse.json({
      applications: rows.map(r => ({
        id: r.id, jobTitle: r.jobTitle, company: r.company, jobText: r.jobText,
        coverLetter: r.coverLetter, notes: r.notes, createdAt: r.createdAt,
        cv: normaliseCv(r.tailoredCv),
      })),
    })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ applications: [], needsMigration: true })
    console.error("jordan/cv/applications GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id, jobTitle, company, coverLetter, cv } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.jordanCvApplication.update({
      where: { id },
      data: {
        ...(jobTitle    !== undefined ? { jobTitle: String(jobTitle).trim().slice(0, 200) } : {}),
        ...(company     !== undefined ? { company:  String(company).trim().slice(0, 200) } : {}),
        ...(coverLetter !== undefined ? { coverLetter: String(coverLetter).slice(0, 50_000) } : {}),
        ...(cv          !== undefined ? { tailoredCv: normaliseCv(cv) as any } : {}),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cv/applications PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.jordanCvApplication.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cv/applications DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
