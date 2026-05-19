import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/documents/files?folderId=xxx  (folderId=root → IS NULL)
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const folderId = searchParams.get("folderId")

    const where =
      folderId === "root" || folderId === null
        ? { folderId: null }
        : { folderId }

    const files = await prisma.documentFile.findMany({
      where,
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(files)
  } catch (e: any) {
    console.error("documents/files GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
