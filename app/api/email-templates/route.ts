import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET  /api/email-templates — list all (anyone signed in)
// POST /api/email-templates — create (anyone signed in)

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const templates = await prisma.emailTemplate.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    })
    return NextResponse.json({ templates })
  } catch (e: any) {
    console.error("email-templates GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to list" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const name     = String(body.name     ?? "").trim()
    const category = String(body.category ?? "GENERAL").trim() || "GENERAL"
    const text     = String(body.body     ?? "").trim()
    if (!name || !text) return NextResponse.json({ error: "Name and body required" }, { status: 400 })

    const max = await prisma.emailTemplate.aggregate({
      where: { category },
      _max:  { sortOrder: true },
    })
    const template = await prisma.emailTemplate.create({
      data: { name, category, body: text, sortOrder: (max._max.sortOrder ?? 0) + 10 },
    })
    return NextResponse.json({ template })
  } catch (e: any) {
    console.error("email-templates POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to create" }, { status: 500 })
  }
}
