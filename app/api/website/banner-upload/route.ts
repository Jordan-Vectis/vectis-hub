import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2, getSignedImageUrl } from "@/lib/r2"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomBytes } from "node:crypto"

// POST /api/website/banner-upload  { filename, contentType, size }
// A presigned PUT for a hero-banner picture on the test website (Website → Banner Manager), under
// hero-slides/ in R2, plus a signed address to show it straight away.
//
// ⚠ Why this route: the Banner Manager used the generic /api/upload-url, which files everything
// under submissions/ — the Submissions app's storage — and then showed it through
// /api/public/photo, which only serves lot-photos, catalogue-photos, first-aid and site-plans
// keys. So every uploaded banner sat safely in R2 and came back as a broken picture (Jordan,
// 2026-09-24: "the banner manager isn't working when I upload an image"). Banners now live under
// their own prefix and are shown by signed address — old submissions/ keys still show that way.
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
    const key = `hero-slides/${stamp}-${randomBytes(3).toString("hex")}.${ext}`
    const url = await getSignedUrl(
      r2,
      new PutObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key, ContentType: type }),
      { expiresIn: 3600 },
    )
    const viewUrl = await getSignedImageUrl(key, 3600)
    return NextResponse.json({ url, key, viewUrl, contentType: type })
  } catch (e: any) {
    console.error("website/banner-upload error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
