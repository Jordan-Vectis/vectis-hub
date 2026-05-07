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
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("user apps PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
