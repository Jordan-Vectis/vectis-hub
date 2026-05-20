import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// POST /api/documents/files/save — record a completed upload in the DB
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { name, key, size, mimeType, folderId } = await req.json()
    if (!name || !key || !size || !mimeType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const file = await prisma.documentFile.create({
      data: {
        name,
        key,
        size,
        mimeType,
        folderId: folderId ?? null,
        uploadedBy: session.user?.email ?? "unknown",
      },
    })

    return NextResponse.json(file)
  } catch (e: any) {
    console.error("documents/files/save POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
