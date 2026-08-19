import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { normaliseCv, EMPTY_CV } from "@/lib/jordan-cv"

// /api/jordan/cv/profiles — the CV profiles (one per person: "Me", "Kate").
// Locked to jordan.orange; everyone else gets a 404, as if it didn't exist.
//
// ⚠ The tables arrive with Run Migrations while the code deploys instantly, so
// every read tolerates them being absent rather than 500ing the page.
function missingTable(e: any): boolean {
  const m = String(e?.message ?? e)
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(m)
}

export async function GET() {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const rows = await prisma.jordanCvProfile.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, data: true, sourceName: true, updatedAt: true,
        _count: { select: { applications: true } },
      },
    })
    return NextResponse.json({
      profiles: rows.map(r => ({
        id: r.id, name: r.name, sourceName: r.sourceName,
        updatedAt: r.updatedAt, applications: r._count.applications,
        cv: normaliseCv(r.data),
      })),
    })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ profiles: [], needsMigration: true })
    console.error("jordan/cv/profiles GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { name, cv, rawText, sourceName } = await req.json()
    if (!String(name ?? "").trim()) return NextResponse.json({ error: "Give the profile a name" }, { status: 400 })
    const row = await prisma.jordanCvProfile.create({
      data: {
        name: String(name).trim().slice(0, 80),
        data: (cv ? normaliseCv(cv) : EMPTY_CV) as any,
        rawText: String(rawText ?? "").slice(0, 200_000),
        sourceName: String(sourceName ?? "").slice(0, 200),
      },
    })
    return NextResponse.json({ id: row.id })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the CV tables aren't there yet." }, { status: 503 })
    console.error("jordan/cv/profiles POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id, name, cv, rawText, sourceName } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.jordanCvProfile.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim().slice(0, 80) } : {}),
        ...(cv !== undefined ? { data: normaliseCv(cv) as any } : {}),
        ...(rawText !== undefined ? { rawText: String(rawText).slice(0, 200_000) } : {}),
        ...(sourceName !== undefined ? { sourceName: String(sourceName).slice(0, 200) } : {}),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cv/profiles PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    // Applications cascade with the profile (schema onDelete: Cascade).
    await prisma.jordanCvProfile.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cv/profiles DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
