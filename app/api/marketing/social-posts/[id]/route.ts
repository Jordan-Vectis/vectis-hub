import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const body = await req.json()

    const post = await prisma.socialPost.update({
      where: { id },
      data: {
        ...(body.platform       !== undefined && { platform: body.platform }),
        ...(body.status         !== undefined && { status: body.status }),
        ...(body.copy           !== undefined && { copy: body.copy }),
        ...(body.imageUrl       !== undefined && { imageUrl: body.imageUrl || null }),
        ...(body.hashtags       !== undefined && { hashtags: body.hashtags || null }),
        ...(body.scheduledAt    !== undefined && { scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null }),
        ...(body.specialDateTag !== undefined && { specialDateTag: body.specialDateTag || null }),
        ...(body.auctionCode    !== undefined && { auctionCode: body.auctionCode || null }),
      },
    })

    return NextResponse.json({ post })
  } catch (e: any) {
    console.error("social-posts PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    await prisma.socialPost.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("social-posts DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
