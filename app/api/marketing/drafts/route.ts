import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/marketing/drafts — list all drafts
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const drafts = await prisma.marketingDraft.findMany({
      orderBy: { updatedAt: "desc" },
    })
    return NextResponse.json({ drafts })
  } catch (e: any) {
    console.error("marketing/drafts GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST /api/marketing/drafts — create
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { title, contentType, content, lotsSnapshot, notes } = await req.json()
    if (!title?.trim() || !contentType || !content?.trim()) {
      return NextResponse.json({ error: "title, contentType, and content are required" }, { status: 400 })
    }

    const draft = await prisma.marketingDraft.create({
      data: {
        title:         title.trim(),
        contentType,
        content,
        status:        "DRAFT",
        createdById:   session.user.id,
        createdByName: session.user.name,
        lotsSnapshot:  lotsSnapshot ?? undefined,
        notes:         notes ?? null,
      },
    })
    return NextResponse.json({ draft })
  } catch (e: any) {
    console.error("marketing/drafts POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
