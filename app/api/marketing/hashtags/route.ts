import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const banks = await prisma.marketingHashtag.findMany({ orderBy: { category: "asc" } })
    return NextResponse.json({ banks })
  } catch (e: any) {
    console.error("marketing/hashtags GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { category, hashtags } = await req.json()
    if (!category?.trim()) return NextResponse.json({ error: "category required" }, { status: 400 })

    const bank = await prisma.marketingHashtag.create({
      data: {
        category: category.trim(),
        hashtags: Array.isArray(hashtags) ? hashtags.map((h: string) => h.trim()).filter(Boolean) : [],
      },
    })
    return NextResponse.json({ bank })
  } catch (e: any) {
    console.error("marketing/hashtags POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
