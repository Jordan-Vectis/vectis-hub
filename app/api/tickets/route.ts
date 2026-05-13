import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/tickets?status=OPEN&mine=1
//
// Lists tickets. Anyone signed in can list — they see everything (it's an
// internal IT log, not customer-facing). Filters are optional.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const status   = searchParams.get("status")?.trim()
    const priority = searchParams.get("priority")?.trim()
    const mine     = searchParams.get("mine") === "1"

    const where: any = {}
    if (status   && status   !== "ALL") where.status   = status
    if (priority && priority !== "ALL") where.priority = priority
    if (mine && session.user?.id)       where.createdById = session.user.id

    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: [
        { status:    "asc" },   // OPEN sorts before RESOLVED alphabetically — good enough
        { createdAt: "desc" },
      ],
    })

    return NextResponse.json({ tickets })
  } catch (e: any) {
    console.error("tickets GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to list tickets" }, { status: 500 })
  }
}

// POST /api/tickets — create a new ticket

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const title       = String(body.title       ?? "").trim()
    const description = String(body.description ?? "").trim()
    const priority    = String(body.priority    ?? "MEDIUM")
    const category    = String(body.category    ?? "OTHER")

    if (!title || !description) {
      return NextResponse.json({ error: "Title and description required" }, { status: 400 })
    }

    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        priority,
        category,
        createdById:   session.user?.id ?? null,
        createdByName: session.user?.name ?? session.user?.email ?? "Unknown",
      },
    })

    return NextResponse.json({ ticket })
  } catch (e: any) {
    console.error("tickets POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to create ticket" }, { status: 500 })
  }
}
