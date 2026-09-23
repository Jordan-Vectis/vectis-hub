import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { prisma } from "@/lib/prisma"

// POST /api/databases/news/picture-url  { id, contentType, size }
// A presigned PUT for one article's cover picture. The pictures come from the office collector's
// folder (the website refuses the Hub's server, so the server can't fetch them itself) and go
// STRAIGHT from the browser to R2 — 1,300 files at ~150 KB is far more than a request body may
// carry — exactly as screen recordings and Documents do. Nothing is written to the database here;
// POST /api/databases/news/picture registers the file once the upload has landed.
const MAX_SIZE = 25 * 1024 * 1024
const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }
// (Not exported — a route file may only export its handlers; the register route spells it out too.)
const NEWS_PHOTO_PREFIX = "news-photos"

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const { id, contentType, size } = await req.json()
    const articleId = Math.round(Number(id))
    if (!Number.isFinite(articleId) || articleId <= 0) return NextResponse.json({ error: "Which article?" }, { status: 400 })
    const type = String(contentType ?? "").split(";")[0].trim().toLowerCase()
    const ext = ALLOWED[type]
    if (!ext) return NextResponse.json({ error: `Only JPEG, PNG, WebP or GIF pictures can be saved (this one is ${type || "of no known type"})` }, { status: 400 })
    if (typeof size !== "number" || !(size > 0)) return NextResponse.json({ error: "Missing size" }, { status: 400 })
    if (size > MAX_SIZE) return NextResponse.json({ error: "Picture too large (max 25 MB)" }, { status: 400 })

    // ⚠ The article must exist BEFORE signing — fail at the free step, not after the upload.
    const article = await prisma.siteNewsArticle.findUnique({ where: { id: articleId }, select: { id: true } })
    if (!article) return NextResponse.json({ error: `No article ${articleId} is held — load vectis-news.json first.` }, { status: 404 })

    const key = `${NEWS_PHOTO_PREFIX}/${articleId}.${ext}`
    const url = await getSignedUrl(
      r2,
      new PutObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key, ContentType: type }),
      { expiresIn: 3600 },
    )
    return NextResponse.json({ url, key, contentType: type })
  } catch (e: any) {
    console.error("databases/news/picture-url error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
