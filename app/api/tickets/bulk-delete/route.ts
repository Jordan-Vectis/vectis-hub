import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// POST /api/tickets/bulk-delete
// Body: { ids: string[] }
// Admin only.

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 401 })
    }

    const { ids } = await req.json() as { ids?: string[] }
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids array required" }, { status: 400 })
    }

    const res = await prisma.ticket.deleteMany({ where: { id: { in: ids } } })
    return NextResponse.json({ ok: true, count: res.count })
  } catch (e: any) {
    console.error("tickets/bulk-delete error:", e)
    return NextResponse.json({ error: e?.message ?? "Bulk delete failed" }, { status: 500 })
  }
}
