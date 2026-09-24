import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/website/departments — the departments collected from vectis.co.uk, for the page
// editor's department picker (the blocks that show a department's lots, news or past auctions).
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const rows = await prisma.$queryRaw<{ slug: string; name: string }[]>`SELECT "slug", "name" FROM "SiteDepartment" ORDER BY "order", "name"`
    return NextResponse.json({ departments: rows })
  } catch (e: any) {
    const msg = String(e?.message ?? "")
    // No departments table yet on this environment: an empty list, which the picker explains.
    if (/does not exist|relation/i.test(msg)) return NextResponse.json({ departments: [] })
    console.error("website/departments error:", e)
    return NextResponse.json({ error: msg || "Unknown error" }, { status: 500 })
  }
}
