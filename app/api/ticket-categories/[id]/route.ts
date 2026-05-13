import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 401 })
    }

    const { id } = await params
    const body   = await req.json()
    const data: any = {}
    if (typeof body.label     === "string")  data.label     = body.label.trim()
    if (typeof body.sortOrder === "number")  data.sortOrder = body.sortOrder
    if (typeof body.active    === "boolean") data.active    = body.active
    // `key` is deliberately not editable — existing tickets reference it.

    const category = await prisma.ticketCategory.update({ where: { id }, data })
    return NextResponse.json({ category })
  } catch (e: any) {
    console.error("ticket-categories PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to update" }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 401 })
    }
    const { id } = await params

    // Block deletion if any tickets still reference this category — avoids
    // orphaning historical data. Caller can deactivate instead.
    const cat = await prisma.ticketCategory.findUnique({ where: { id } })
    if (!cat) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const inUse = await prisma.ticket.count({ where: { category: cat.key } })
    if (inUse > 0) {
      return NextResponse.json({
        error: `Can't delete — ${inUse} ticket${inUse === 1 ? "" : "s"} still use this category. Deactivate it instead.`,
      }, { status: 409 })
    }

    await prisma.ticketCategory.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("ticket-categories DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to delete" }, { status: 500 })
  }
}
