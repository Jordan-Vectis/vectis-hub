import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// PATCH /api/tickets/[id] — update ticket fields (status, priority, assignee,
// resolution note). Anyone signed in can update — IT team is small and
// audit history isn't critical. Restrict to admins later if needed.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const body = await req.json()

    const data: any = {}
    if (typeof body.title          === "string") data.title          = body.title.trim()
    if (typeof body.description    === "string") data.description    = body.description.trim()
    if (typeof body.status         === "string") data.status         = body.status
    if (typeof body.priority       === "string") data.priority       = body.priority
    if (typeof body.category       === "string") data.category       = body.category
    if (typeof body.assignedToName === "string") data.assignedToName = body.assignedToName.trim() || null
    if (typeof body.resolutionNote === "string") data.resolutionNote = body.resolutionNote.trim() || null

    // Stamp resolvedAt automatically when moving to RESOLVED / CLOSED.
    if (data.status === "RESOLVED" || data.status === "CLOSED") {
      const existing = await prisma.ticket.findUnique({ where: { id }, select: { resolvedAt: true } })
      if (existing && !existing.resolvedAt) data.resolvedAt = new Date()
    } else if (data.status === "OPEN" || data.status === "IN_PROGRESS") {
      data.resolvedAt = null
    }

    const ticket = await prisma.ticket.update({ where: { id }, data })
    return NextResponse.json({ ticket })
  } catch (e: any) {
    console.error("tickets PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to update ticket" }, { status: 500 })
  }
}

// DELETE — admins only

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    const { id } = await params
    await prisma.ticket.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("tickets DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to delete ticket" }, { status: 500 })
  }
}
