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

    const data: any = {
      updatedById:   session.user?.id ?? null,
      updatedByName: session.user?.name ?? session.user?.email ?? "Unknown",
    }
    if (typeof body.title    === "string") data.title    = body.title.trim()
    if (typeof body.body     === "string") data.body     = body.body.trim()
    if (typeof body.category === "string") data.category = body.category
    if (Array.isArray(body.tags))          data.tags     = body.tags.map((t: any) => String(t).trim()).filter(Boolean)

    const article = await prisma.knowledgeArticle.update({ where: { id }, data })
    return NextResponse.json({ article })
  } catch (e: any) {
    console.error("knowledge PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to update article" }, { status: 500 })
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
    await prisma.knowledgeArticle.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("knowledge DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to delete article" }, { status: 500 })
  }
}
