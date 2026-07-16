import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// DELETE /api/admin/access-log — empties the access denial log.
export async function DELETE() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    const { count } = await prisma.accessDenialLog.deleteMany({})
    return NextResponse.json({ ok: true, deleted: count })
  } catch (e: any) {
    console.error("access-log delete error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
