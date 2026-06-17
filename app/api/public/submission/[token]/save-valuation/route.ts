import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { items, overallNotes } = await req.json()

    const submission = await prisma.submission.findUnique({
      where:   { valuationToken: token },
      include: { items: { select: { id: true } } },
    })
    if (!submission) return NextResponse.json({ error: "Invalid link" }, { status: 404 })

    const validItemIds = new Set(submission.items.map(i => i.id))

    for (const item of (items ?? []) as { id: string; estimate?: number | null; notes?: string | null }[]) {
      if (!validItemIds.has(item.id)) continue
      await prisma.item.update({
        where: { id: item.id },
        data: {
          externalEstimate: item.estimate ?? null,
          externalNotes:    item.notes    ?? null,
        },
      })
    }

    await prisma.submission.update({
      where: { valuationToken: token },
      data: {
        valuationNotes:       overallNotes ?? null,
        valuationSubmittedAt: new Date(),
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
