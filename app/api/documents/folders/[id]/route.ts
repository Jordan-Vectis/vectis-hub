import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// DELETE /api/documents/folders/[id] — unlink files then delete folder
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { id } = await params

    // Detach files from this folder so they become root-level
    await prisma.documentFile.updateMany({
      where: { folderId: id },
      data: { folderId: null },
    })

    await prisma.documentFolder.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("documents/folders/[id] DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
