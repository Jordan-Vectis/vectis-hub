import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { r2 } from "@/lib/r2"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"

// PATCH — update label / tags
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params
    const { label, tags } = await req.json()

    const image = await prisma.socialImage.update({
      where: { id },
      data: {
        ...(label !== undefined && { label: label || null }),
        ...(tags  !== undefined && { tags:  tags  || null }),
      },
    })

    return NextResponse.json({ image })
  } catch (e: any) {
    console.error("social-images PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// DELETE — remove from R2 + DB
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params

    const image = await prisma.socialImage.findUnique({ where: { id } })
    if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Delete from R2
    await r2.send(
      new DeleteObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
        Key:    image.key,
      })
    )

    await prisma.socialImage.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("social-images DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
