import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { prisma } from "@/lib/prisma"

// POST /api/databases/news/picture-url  { id, file, contentType, size }
// A presigned PUT for one picture from the office collectors' folder, named as they saved it:
//   <id>.<ext>            an article's cover              <id>-<n>.<ext>         a picture inside the article
//   dept-<slug>-hero.<ext> a department's banner           dept-<slug>-tile.<ext>  its tile on the index
//   dept-<slug>-<n>.<ext>  one of its highlighted lots
// The pictures go STRAIGHT from the browser to R2 (the website refuses the Hub's server, and
// thousands of files at a few hundred KB is far more than a request body may carry), exactly as
// screen recordings and Documents do. Nothing is written to the database here; POST
// /api/databases/news/picture registers the file once the upload has landed.
const MAX_SIZE = 25 * 1024 * 1024
const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }
const ARTICLE_FILE = /^(\d+)(?:-\d+)?\.(jpe?g|png|webp|gif)$/
const DEPT_FILE = /^dept-([a-z0-9-]+)-(?:hero|tile|\d+|x\d+)\.(jpe?g|png|webp|gif)$/   // x<n>: a picture inside the copy or the side box
// (Not exported — a route file may only export its handlers; the register route spells it out too.)
const NEWS_PHOTO_PREFIX = "news-photos"

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const { id, file, contentType, size } = await req.json()
    const name = String(file ?? "").toLowerCase()
    const article = name.match(ARTICLE_FILE), dept = name.match(DEPT_FILE)
    if (!article && !dept) return NextResponse.json({ error: `"${file}" isn't a picture file name the collectors would give` }, { status: 400 })
    const type = String(contentType ?? "").split(";")[0].trim().toLowerCase()
    const ext = ALLOWED[type]
    if (!ext) return NextResponse.json({ error: `Only JPEG, PNG, WebP or GIF pictures can be saved (this one is ${type || "of no known type"})` }, { status: 400 })
    // The file's own extension must agree with what the browser says it is (jpeg and jpg are the same thing).
    const fileExt = (article ? article[2] : dept![2]).replace("jpeg", "jpg")
    if (fileExt !== ext) return NextResponse.json({ error: `"${file}" is ${type}, which doesn't match its name` }, { status: 400 })
    if (typeof size !== "number" || !(size > 0)) return NextResponse.json({ error: "Missing size" }, { status: 400 })
    if (size > MAX_SIZE) return NextResponse.json({ error: "Picture too large (max 25 MB)" }, { status: 400 })

    // ⚠ The article or department must exist BEFORE signing — fail at the free step, not after the upload.
    if (article) {
      const articleId = Number(article[1])
      if (Math.round(Number(id)) !== articleId) return NextResponse.json({ error: `"${file}" isn't article ${id}'s picture` }, { status: 400 })
      const row = await prisma.siteNewsArticle.findUnique({ where: { id: articleId }, select: { id: true } })
      if (!row) return NextResponse.json({ error: `No article ${articleId} is held — load the news files first.` }, { status: 404 })
    } else {
      const row = await prisma.siteDepartment.findUnique({ where: { slug: dept![1] }, select: { slug: true } })
      if (!row) return NextResponse.json({ error: `No department "${dept![1]}" is held — load vectis-departments.json first.` }, { status: 404 })
    }

    const key = `${NEWS_PHOTO_PREFIX}/${name}`
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
