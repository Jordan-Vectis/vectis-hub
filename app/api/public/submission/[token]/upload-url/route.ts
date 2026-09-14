import { NextRequest, NextResponse } from "next/server"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { r2 } from "@/lib/r2"
import { prisma } from "@/lib/prisma"
import { mediaContentType, mediaFileName } from "@/lib/media"

const CLOSED_STATUSES = ["COMPLETED", "DECLINED"]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { itemId, filename: rawFilename, contentType: rawContentType } = await req.json()
    const filename = String(rawFilename ?? "")

    // Photos AND videos (2026-09-14). Any image or video type is kept; a blank or non-standard type
    // (some older devices) is worked out from the file name, falling back to JPEG as it always did.
    const contentType = mediaContentType(rawContentType, filename)

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

    // ⚠ The name always ends in an extension — it is the only way the Hub can later tell a video
    // from a photo (lib/media.ts).
    const key = `submission-photos/${token}/${Date.now()}-${mediaFileName(filename, contentType)}`

    const url = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket:      process.env.CLOUDFLARE_R2_BUCKET!,
        Key:         key,
        ContentType: contentType,
      }),
      { expiresIn: 3600 }
    )

    // ⚠ The upload must send exactly this type — it is part of the signed URL.
    return NextResponse.json({ url, key, contentType })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
