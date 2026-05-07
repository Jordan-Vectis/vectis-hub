import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const defaults = await prisma.roleDefault.findMany()
    return NextResponse.json(defaults)
  } catch (e: any) {
    console.error("role-defaults GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { role, allowedApps, appPermissions } = await req.json()
    if (!role) return NextResponse.json({ error: "role required" }, { status: 400 })

    await prisma.roleDefault.upsert({
      where:  { role },
      create: { role, allowedApps, appPermissions, updatedAt: new Date() },
      update: { allowedApps: { set: allowedApps }, appPermissions, updatedAt: new Date() },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("role-defaults PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
