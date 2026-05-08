import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const { title, content, status, publishedUrl, notes } = await req.json()

    const draft = await prisma.marketingDraft.update({
      where: { id },
      data: {
        ...(title        !== undefined && { title:        title.trim() }),
        ...(content      !== undefined && { content }),
        ...(status       !== undefined && { status }),
        ...(publishedUrl !== undefined && { publishedUrl: publishedUrl?.trim() || null }),
        ...(notes        !== undefined && { notes:        notes?.trim() || null }),
      },
    })
    return NextResponse.json({ draft })
  } catch (e: any) {
    console.error("marketing/drafts PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    await prisma.marketingDraft.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("marketing/drafts DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
