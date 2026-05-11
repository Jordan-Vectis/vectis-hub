import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const VALID_GROUPS = ["FULL_TIME", "AGENCY"] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    const { name, staffGroup, active, sortOrder } = await req.json()

    if (staffGroup !== undefined && !VALID_GROUPS.includes(staffGroup)) {
      return NextResponse.json({ error: "Invalid staffGroup" }, { status: 400 })
    }

    const packer = await prisma.packer.update({
      where: { id },
      data: {
        ...(name        !== undefined && { name: String(name).trim() }),
        ...(staffGroup  !== undefined && { staffGroup }),
        ...(active      !== undefined && { active: Boolean(active) }),
        ...(sortOrder   !== undefined && { sortOrder: Number(sortOrder) }),
      },
    })
    return NextResponse.json({ packer })
  } catch (e: any) {
    console.error("packers PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    await prisma.packer.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("packers DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
