import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    const { category, hashtags } = await req.json()
    const bank = await prisma.marketingHashtag.update({
      where: { id },
      data: {
        ...(category !== undefined && { category: category.trim() }),
        ...(hashtags !== undefined && {
          hashtags: { set: Array.isArray(hashtags) ? hashtags.map((h: string) => h.trim()).filter(Boolean) : [] },
        }),
      },
    })
    return NextResponse.json({ bank })
  } catch (e: any) {
    console.error("marketing/hashtags PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    await prisma.marketingHashtag.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("marketing/hashtags DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
