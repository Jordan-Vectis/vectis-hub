import { NextRequest, NextResponse } from "next/server"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { r2 } from "@/lib/r2"
import { auth } from "@/auth"

const MAX_TOTAL_SIZE = 5 * 1024 * 1024 * 1024 // 5GB
// Photos AND documents — submissions often arrive with valuation letters,
// provenance docs, spreadsheets, etc. alongside item photos.
const ALLOWED_TYPES = [
  // Images
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif", "image/tiff", "image/bmp",
  // Documents
  "application/pdf",
  "application/msword",                                                        // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",   // .docx
  "application/vnd.ms-excel",                                                  // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",         // .xlsx
  "application/vnd.ms-powerpoint",                                             // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/plain",                                                                // .txt
  "text/csv",                                                                  // .csv
  "application/rtf", "text/rtf",                                               // .rtf
]

// ⚠ Signed-in only (security review, 2026-10-22). The login gate skips every /api address, and this
// route had no check of its own — anyone on the internet could get a link to put a 5 GB file into
// our storage. Its only callers are the staff New Submission page and the (login-gated) web form.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { filename, contentType, size } = await req.json()
    if (typeof filename !== "string" || !filename) return NextResponse.json({ error: "No file name" }, { status: 400 })

    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json({ error: "File type not allowed" }, { status: 400 })
    }

    if (size > MAX_TOTAL_SIZE) {
      return NextResponse.json({ error: "File too large" }, { status: 400 })
    }

    const key = `submissions/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`

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
    console.error("upload-url error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
