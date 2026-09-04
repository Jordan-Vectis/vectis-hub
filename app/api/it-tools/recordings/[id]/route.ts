import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { r2, getSignedImageUrl } from "@/lib/r2"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"

// GET /api/it-tools/recordings/[id] — a signed URL to play the file. The bucket
// is private; nothing is ever linked to directly.
// ⚠ Eight hours, not the Documents route's one: a <video> fetches lazily in Range
// requests, and every request is checked against the signature's expiry. With
// an hour, seeking or pausing-then-resuming an hour after pressing Play got a
// 403 from R2 and the player died — and the cap budgets for 1¾-hour files.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const rec = await prisma.screenRecording.findUnique({ where: { id } })
    if (!rec) return NextResponse.json({ error: "Recording not found" }, { status: 404 })

    return NextResponse.json({ url: await getSignedImageUrl(rec.key, 8 * 3600) })
  } catch (e: any) {
    console.error("it-tools/recordings/[id] GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// DELETE /api/it-tools/recordings/[id] — the file first, then the row, so a
// failed R2 delete leaves the row (and the file) rather than an orphaned file
// nobody can see to clean up.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const rec = await prisma.screenRecording.findUnique({ where: { id } })
    if (!rec) return NextResponse.json({ error: "Recording not found" }, { status: 404 })

    await r2.send(new DeleteObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: rec.key }))
    await prisma.screenRecording.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("it-tools/recordings/[id] DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
