import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/documents/folders — list all folders
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const folders = await prisma.documentFolder.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, parentId: true, createdAt: true },
    })

    return NextResponse.json(folders)
  } catch (e: any) {
    console.error("documents/folders GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST /api/documents/folders — create a folder
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { name, parentId } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 })

    const folder = await prisma.documentFolder.create({
      data: { name: name.trim(), parentId: parentId ?? null },
      select: { id: true, name: true, parentId: true, createdAt: true },
    })

    return NextResponse.json(folder)
  } catch (e: any) {
    console.error("documents/folders POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
