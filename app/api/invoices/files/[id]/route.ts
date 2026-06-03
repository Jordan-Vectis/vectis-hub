import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { r2 } from "@/lib/r2"
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

// GET /api/invoices/files/[id] — return a 1-hour signed download URL
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params

    const file = await prisma.invoiceFile.findUnique({ where: { id } })
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })

    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
        Key: file.key,
      }),
      { expiresIn: 3600 }
    )

    return NextResponse.json({ url })
  } catch (e: any) {
    console.error("invoices/files/[id] GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// DELETE /api/invoices/files/[id] — delete from R2 and DB
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params

    const file = await prisma.invoiceFile.findUnique({ where: { id } })
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })

    await r2.send(
      new DeleteObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
        Key: file.key,
      })
    )

    await prisma.invoiceFile.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("invoices/files/[id] DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
