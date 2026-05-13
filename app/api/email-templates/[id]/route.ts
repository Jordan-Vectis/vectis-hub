import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

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
    if (typeof body.name      === "string") data.name      = body.name.trim()
    if (typeof body.category  === "string") data.category  = body.category.trim() || "GENERAL"
    if (typeof body.body      === "string") data.body      = body.body.trim()
    if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder

    const template = await prisma.emailTemplate.update({ where: { id }, data })
    return NextResponse.json({ template })
  } catch (e: any) {
    console.error("email-templates PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to update" }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    await prisma.emailTemplate.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("email-templates DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to delete" }, { status: 500 })
  }
}
