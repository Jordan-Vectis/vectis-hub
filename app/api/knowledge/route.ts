import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/knowledge — list all articles (anyone signed in)
// POST /api/knowledge — create an article (anyone signed in for now;
//   restrict later via app permissions if needed)

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const articles = await prisma.knowledgeArticle.findMany({
      orderBy: { updatedAt: "desc" },
    })
    return NextResponse.json({ articles })
  } catch (e: any) {
    console.error("knowledge GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to list articles" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const title    = String(body.title    ?? "").trim()
    const text     = String(body.body     ?? "").trim()
    const category = String(body.category ?? "GENERAL")
    const tags: string[] = Array.isArray(body.tags)
      ? body.tags.map((t: any) => String(t).trim()).filter(Boolean)
      : []

    if (!title || !text) {
      return NextResponse.json({ error: "Title and body required" }, { status: 400 })
    }

    const article = await prisma.knowledgeArticle.create({
      data: {
        title,
        body:          text,
        category,
        tags,
        createdById:   session.user?.id ?? null,
        createdByName: session.user?.name ?? session.user?.email ?? "Unknown",
      },
    })
    return NextResponse.json({ article })
  } catch (e: any) {
    console.error("knowledge POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to create article" }, { status: 500 })
  }
}
