import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/it-tools/bc-source/files
//   (no params)        → the extension list: name, file count, size, guide?
//   ?extension=X       → that extension's file list (no content)
//   ?fileId=X          → one file, with content
//
// Every read is wrapped so a missing table (code deploys before Run
// Migrations) shows as "nothing uploaded yet", never a 500.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const params    = req.nextUrl.searchParams
    const extension = params.get("extension")?.trim()
    const fileId    = params.get("fileId")?.trim()

    try {
      if (fileId) {
        const file = await prisma.bcSourceFile.findUnique({ where: { id: fileId } })
        if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })
        return NextResponse.json({ file })
      }

      if (extension) {
        const files = await prisma.bcSourceFile.findMany({
          where:   { extension },
          select:  { id: true, path: true, name: true, kind: true, size: true },
          orderBy: [{ kind: "asc" }, { name: "asc" }],
        })
        return NextResponse.json({ files })
      }

      const [byExt, guides, latest] = await Promise.all([
        prisma.bcSourceFile.groupBy({
          by: ["extension"],
          _count: { _all: true },
          _sum: { size: true },
        }),
        prisma.bcSourceGuide.findMany({ select: { extension: true, edited: true, generatedAt: true } }),
        prisma.bcSourceFile.aggregate({ _max: { uploadedAt: true } }),
      ])
      const guideMap = new Map(guides.map(g => [g.extension, g]))
      const extensions = byExt
        .map(e => ({
          name:      e.extension,
          files:     e._count._all,
          bytes:     e._sum.size ?? 0,
          guide:     guideMap.has(e.extension),
          guideEdited: guideMap.get(e.extension)?.edited ?? false,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      return NextResponse.json({
        extensions,
        uploadedAt: latest._max.uploadedAt?.toISOString() ?? null,
        canUpload:  session.user.role === "ADMIN",
      })
    } catch {
      // Table not created yet — present as empty, with upload still offered.
      return NextResponse.json({ extensions: [], uploadedAt: null, canUpload: session.user.role === "ADMIN", notReady: true })
    }
  } catch (e: any) {
    console.error("bc-source files error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
