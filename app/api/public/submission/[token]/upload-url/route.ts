import { NextRequest, NextResponse } from "next/server"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { r2 } from "@/lib/r2"
import { prisma } from "@/lib/prisma"

const CLOSED_STATUSES = ["COMPLETED", "DECLINED"]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { itemId, filename, contentType: rawContentType } = await req.json()

    // Accept any image type — some older devices send blank or non-standard content types
    const contentType = (rawContentType && rawContentType.startsWith("image/"))
      ? rawContentType
      : "image/jpeg"

    const submission = await prisma.submission.findUnique({
      where:   { photoUploadToken: token },
      include: { items: { select: { id: true } } },
    })
    if (!submission) return NextResponse.json({ error: "Invalid link" }, { status: 404 })
    if (CLOSED_STATUSES.includes(submission.status)) {
      return NextResponse.json({ error: "Link has expired" }, { status: 410 })
    }
    if (!submission.items.some(i => i.id === itemId)) {
      return NextResponse.json({ error: "Invalid item" }, { status: 400 })
    }

    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key  = `submission-photos/${token}/${Date.now()}-${safe}`

    const url = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket:      process.env.CLOUDFLARE_R2_BUCKET!,
        Key:         key,
        ContentType: contentType,
      }),
      { expiresIn: 3600 }
    )

    return NextResponse.json({ url, key })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
