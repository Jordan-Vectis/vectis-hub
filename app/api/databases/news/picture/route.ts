import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { objectExistsInR2 } from "@/lib/r2"

// POST /api/databases/news/picture  { id, key }
// Registers a picture once the browser's presigned PUT has landed in R2 (the key comes from
// /api/databases/news/picture-url):
//   news-photos/<id>.<ext>             → the article's cover (imageKey)
//   news-photos/<id>-<n>.<ext>         → joins the article's bodyImageKeys
//   news-photos/dept-<slug>-hero.<ext> → the department's heroKey;  -tile → tileKey;  -<n> → joins highlightKeys
// Idempotent: registering the same key twice is fine, and a retry never re-uploads.
const ARTICLE_KEY = /^news-photos\/(\d+)(-\d+)?\.(jpe?g|png|webp|gif)$/
const DEPT_KEY = /^news-photos\/dept-([a-z0-9-]+)-(hero|tile|\d+)\.(jpe?g|png|webp|gif)$/

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const { id, key } = await req.json()
    const k = typeof key === "string" ? key : ""
    const article = k.match(ARTICLE_KEY), dept = k.match(DEPT_KEY)
    if (!article && !dept) return NextResponse.json({ error: "That isn't a key this page hands out" }, { status: 400 })
    // ⚠ Only a definite "not there" means the upload was lost; R2 is strongly consistent, so no waiting.
    if (!(await objectExistsInR2(k))) return NextResponse.json({ error: "The picture didn't land in storage — try that one again" }, { status: 404 })

    if (article) {
      const articleId = Number(article[1])
      if (Math.round(Number(id)) !== articleId) return NextResponse.json({ error: "That key doesn't belong to this article" }, { status: 400 })
      if (article[2]) {
        // Inside the article: append once, never twice.
        await prisma.$executeRaw`UPDATE "SiteNewsArticle" SET "bodyImageKeys" = array_append("bodyImageKeys", ${k}) WHERE "id" = ${articleId} AND NOT (${k} = ANY("bodyImageKeys"))`
      } else {
        await prisma.siteNewsArticle.update({ where: { id: articleId }, data: { imageKey: k, imageAt: new Date() }, select: { id: true } })
      }
      return NextResponse.json({ ok: true, id: articleId, key: k })
    }

    const slug = dept![1], which = dept![2]
    if (which === "hero") await prisma.$executeRaw`UPDATE "SiteDepartment" SET "heroKey" = ${k} WHERE "slug" = ${slug}`
    else if (which === "tile") await prisma.$executeRaw`UPDATE "SiteDepartment" SET "tileKey" = ${k} WHERE "slug" = ${slug}`
    else await prisma.$executeRaw`UPDATE "SiteDepartment" SET "highlightKeys" = array_append("highlightKeys", ${k}) WHERE "slug" = ${slug} AND NOT (${k} = ANY("highlightKeys"))`
    return NextResponse.json({ ok: true, slug, key: k })
  } catch (e: any) {
    console.error("databases/news/picture error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
