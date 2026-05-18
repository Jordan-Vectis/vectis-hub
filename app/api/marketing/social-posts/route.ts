import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const posts = await prisma.socialPost.findMany({
      orderBy: { scheduledAt: "asc" },
    })

    return NextResponse.json({ posts })
  } catch (e: any) {
    console.error("social-posts GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const { platform, copy, imageUrl, hashtags, scheduledAt, specialDateTag, auctionCode, status } = body

    if (!copy) return NextResponse.json({ error: "Post copy is required" }, { status: 400 })

    const post = await prisma.socialPost.create({
      data: {
        platform:       platform ?? "FACEBOOK",
        status:         status   ?? "DRAFT",
        copy,
        imageUrl:       imageUrl       || null,
        hashtags:       hashtags       || null,
        scheduledAt:    scheduledAt    ? new Date(scheduledAt) : null,
        specialDateTag: specialDateTag || null,
        auctionCode:    auctionCode    || null,
        createdByName:  session.user.name ?? session.user.email ?? "Unknown",
      },
    })

    return NextResponse.json({ post })
  } catch (e: any) {
    console.error("social-posts POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
