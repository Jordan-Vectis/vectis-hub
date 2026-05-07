import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params
    const { allowedApps, appPermissions } = await req.json()
    await prisma.user.update({
      where: { id },
      data: {
        allowedApps: { set: allowedApps },
        ...(appPermissions !== undefined ? { appPermissions } : {}),
      },
    })
    // Re-read to confirm persistence
    const verify = await prisma.user.findUnique({
      where: { id },
      select: { allowedApps: true, appPermissions: true },
    })
    console.log("user apps PUT:", { id, sent: { allowedApps, appPermissions }, persisted: verify })
    return NextResponse.json({ ok: true, persisted: verify })
  } catch (e: any) {
    console.error("user apps PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
