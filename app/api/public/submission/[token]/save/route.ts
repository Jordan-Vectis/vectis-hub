import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const CLOSED_STATUSES = ["COMPLETED", "DECLINED"]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { itemId, keys } = await req.json() as { itemId: string; keys: string[] }

    const submission = await prisma.submission.findUnique({
      where:   { photoUploadToken: token },
      include: { items: { select: { id: true, imageUrls: true } } },
    })
    if (!submission) return NextResponse.json({ error: "Invalid link" }, { status: 404 })
    if (CLOSED_STATUSES.includes(submission.status)) {
      return NextResponse.json({ error: "Link has expired" }, { status: 410 })
    }

    const item = submission.items.find(i => i.id === itemId)
    if (!item) return NextResponse.json({ error: "Invalid item" }, { status: 400 })

    // Only accept keys that belong to this token's upload prefix
    const validKeys = keys.filter(k => k.startsWith(`submission-photos/${token}/`))
    if (validKeys.length === 0) return NextResponse.json({ ok: true })

    await prisma.item.update({
      where: { id: itemId },
      data:  { imageUrls: [...item.imageUrls, ...validKeys] },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
