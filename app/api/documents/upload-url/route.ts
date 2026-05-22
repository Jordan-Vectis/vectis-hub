import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const MAX_SIZE = 100 * 1024 * 1024 // 100 MB

// POST /api/documents/upload-url — generate a presigned PUT URL
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { filename, contentType, size } = await req.json()

    if (size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 100 MB)" }, { status: 400 })
    }

    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key = `documents/${Date.now()}-${safeFilename}`

    const url = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 3600 }
    )

    return NextResponse.json({ url, key })
  } catch (e: any) {
    console.error("documents/upload-url POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
