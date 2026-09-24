import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomBytes } from "node:crypto"

// POST /api/website/page-upload  { filename, contentType, size }
// A presigned PUT for a picture in a test-website page built in the page editor (Website → Pages),
// under site-pages/ in R2. The page keeps the KEY, never an address: it is shown through
// /api/website/picture, which signs a fresh one each time, so a saved page never goes stale.
// Straight from the browser to R2, the same way the Banner Manager uploads.
const MAX_SIZE = 25 * 1024 * 1024
const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const { contentType, size } = await req.json()
    const type = String(contentType ?? "").split(";")[0].trim().toLowerCase()
    const ext = ALLOWED[type]
    if (!ext) return NextResponse.json({ error: `Only JPEG, PNG, WebP or GIF pictures can be used (this one is ${type || "of no known type"})` }, { status: 400 })
    if (typeof size !== "number" || !(size > 0)) return NextResponse.json({ error: "Missing size" }, { status: 400 })
    if (size > MAX_SIZE) return NextResponse.json({ error: "Picture too large (max 25 MB)" }, { status: 400 })

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-")
    const key = `site-pages/${stamp}-${randomBytes(4).toString("hex")}.${ext}`
    const url = await getSignedUrl(
      r2,
      new PutObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key, ContentType: type }),
      { expiresIn: 3600 },
    )
    return NextResponse.json({ url, key, contentType: type })
  } catch (e: any) {
    console.error("website/page-upload error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
