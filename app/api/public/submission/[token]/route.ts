import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const CLOSED_STATUSES = ["COMPLETED", "DECLINED"]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const submission = await prisma.submission.findUnique({
      where:   { photoUploadToken: token },
      include: { items: { select: { id: true, name: true } } },
    })
    if (!submission) return NextResponse.json({ error: "Link not found" }, { status: 404 })
    if (CLOSED_STATUSES.includes(submission.status)) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 })
    }
    return NextResponse.json({ items: submission.items.map(i => ({ id: i.id, name: i.name })) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
