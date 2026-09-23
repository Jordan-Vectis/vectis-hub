import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { objectExistsInR2 } from "@/lib/r2"

// POST /api/databases/news/picture  { id, key }
// Registers one of an article's pictures once the browser's presigned PUT has landed in R2 (the
// key comes from /api/databases/news/picture-url): the cover ("news-photos/<id>.<ext>") goes on
// imageKey, a picture from inside the article ("news-photos/<id>-<n>.<ext>") joins bodyImageKeys.
// Idempotent: registering the same key twice is fine, and a retry never re-uploads.
const KEY = /^news-photos\/(\d+)(-\d+)?\.(jpe?g|png|webp|gif)$/

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const { id, key } = await req.json()
    const articleId = Math.round(Number(id))
    const m = typeof key === "string" ? key.match(KEY) : null
    if (!Number.isFinite(articleId) || articleId <= 0 || !m || Number(m[1]) !== articleId) {
      return NextResponse.json({ error: "That key doesn't belong to this article" }, { status: 400 })
    }
    // ⚠ Only a definite "not there" means the upload was lost; R2 is strongly consistent, so no waiting.
    if (!(await objectExistsInR2(key))) return NextResponse.json({ error: "The picture didn't land in storage — try that one again" }, { status: 404 })

    if (m[2]) {
      // Inside the article: append once, never twice.
      await prisma.$executeRaw`UPDATE "SiteNewsArticle" SET "bodyImageKeys" = array_append("bodyImageKeys", ${key}) WHERE "id" = ${articleId} AND NOT (${key} = ANY("bodyImageKeys"))`
    } else {
      await prisma.siteNewsArticle.update({ where: { id: articleId }, data: { imageKey: key, imageAt: new Date() }, select: { id: true } })
    }
    return NextResponse.json({ ok: true, id: articleId, key })
  } catch (e: any) {
    console.error("databases/news/picture error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
