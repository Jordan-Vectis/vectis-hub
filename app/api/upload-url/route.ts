import { NextRequest, NextResponse } from "next/server"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { r2 } from "@/lib/r2"

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

export async function POST(req: NextRequest) {
  const { filename, contentType, size } = await req.json()

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
}
