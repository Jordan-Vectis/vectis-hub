import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/tickets/[id]/comments
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const comments = await prisma.ticketComment.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: "asc" },
    })
    return NextResponse.json({ comments })
  } catch (e: any) {
    console.error("ticket comments GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to fetch comments" }, { status: 500 })
  }
}

// POST /api/tickets/[id]/comments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const { body } = await req.json()
    if (!body?.trim()) return NextResponse.json({ error: "Comment body is required" }, { status: 400 })

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId:   id,
        body:       body.trim(),
        authorName: session.user.name ?? session.user.email ?? "Unknown",
        authorId:   session.user.id ?? null,
      },
    })
    return NextResponse.json({ comment })
  } catch (e: any) {
    console.error("ticket comments POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to add comment" }, { status: 500 })
  }
}
