import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// DELETE /api/admin/role-defaults/[role]
// Deletes a role's default permissions row. Refuses if any users are still
// assigned to the role — the admin must reassign those users first.
// ADMIN is a hardcoded system role and can't be deleted via this endpoint.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { role } = await params
    const decoded = decodeURIComponent(role)

    if (decoded === "ADMIN") {
      return NextResponse.json({ error: "ADMIN is a system role and cannot be deleted" }, { status: 400 })
    }

    const usersOnRole = await prisma.user.count({ where: { role: decoded } })
    if (usersOnRole > 0) {
      return NextResponse.json(
        { error: `${usersOnRole} user${usersOnRole === 1 ? "" : "s"} still assigned to this role — reassign them first` },
        { status: 409 },
      )
    }

    await prisma.roleDefault.delete({ where: { role: decoded } }).catch(() => null)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("role-defaults DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
