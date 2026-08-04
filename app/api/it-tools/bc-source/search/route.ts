import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/it-tools/bc-source/search?q=…
//
// Case-insensitive substring search across every stored source file, returning
// the matching lines with a little context. ILIKE over ~2,600 rows (~2.7 MB
// total) is a trivial scan — no index gymnastics needed at this size.

const MAX_FILES = 60
const MAX_LINES_PER_FILE = 8

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    if (q.length < 2) return NextResponse.json({ error: "Type at least 2 characters" }, { status: 400 })

    let files: { id: string; extension: string; path: string; name: string; kind: string; content: string }[] = []
    try {
      files = await prisma.bcSourceFile.findMany({
        where: {
          OR: [
            { content: { contains: q, mode: "insensitive" } },
            { path:    { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, extension: true, path: true, name: true, kind: true, content: true },
        take: MAX_FILES + 1,
      })
    } catch {
      return NextResponse.json({ results: [], truncated: false, notReady: true })
    }

    const truncated = files.length > MAX_FILES
    const lower = q.toLowerCase()

    const results = files.slice(0, MAX_FILES).map(f => {
      const lines = f.content.split("\n")
      const hits: { line: number; text: string }[] = []
      for (let i = 0; i < lines.length && hits.length < MAX_LINES_PER_FILE; i++) {
        if (lines[i].toLowerCase().includes(lower)) {
          hits.push({ line: i + 1, text: lines[i].trim().slice(0, 240) })
        }
      }
      return {
        id: f.id, extension: f.extension, path: f.path, name: f.name, kind: f.kind,
        hits,
        more: lines.filter(l => l.toLowerCase().includes(lower)).length - hits.length,
      }
    })

    // Path-only matches (no content hits) still return, with an empty hits list.
    return NextResponse.json({ results, truncated })
  } catch (e: any) {
    console.error("bc-source search error:", e)
    return NextResponse.json({ error: e?.message ?? "Search failed" }, { status: 500 })
  }
}
