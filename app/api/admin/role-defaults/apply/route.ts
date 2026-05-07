import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { role, userIds } = await req.json() as { role: string; userIds: string[] | "all" }
    if (!role) return NextResponse.json({ error: "role required" }, { status: 400 })

    const roleDefault = await prisma.roleDefault.findUnique({ where: { role } })
    if (!roleDefault) return NextResponse.json({ error: "No default set for this role" }, { status: 404 })

    const where = userIds === "all"
      ? { role: role as any }
      : { id: { in: userIds }, role: role as any }

    const { count } = await prisma.user.updateMany({
      where,
      data: {
        allowedApps:    roleDefault.allowedApps,
        appPermissions: roleDefault.appPermissions ?? undefined,
      },
    })

    return NextResponse.json({ ok: true, count })
  } catch (e: any) {
    console.error("role-defaults apply error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
