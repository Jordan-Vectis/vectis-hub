import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const VALID_GROUPS = ["FULL_TIME", "AGENCY", "EX_STAFF"] as const

// GET /api/packers — list all (or filter by staffGroup / active)
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const staffGroup = searchParams.get("staffGroup")
    const where: any = {}
    if (staffGroup) where.staffGroup = staffGroup

    const packers = await prisma.packer.findMany({
      where,
      orderBy: [{ staffGroup: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    })
    return NextResponse.json({ packers })
  } catch (e: any) {
    console.error("packers GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST /api/packers — create new packer
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { name, staffGroup } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 })
    const group = String(staffGroup ?? "FULL_TIME")
    if (!VALID_GROUPS.includes(group as any)) {
      return NextResponse.json({ error: "Invalid staffGroup" }, { status: 400 })
    }

    // Append to the end of the chosen group
    const last = await prisma.packer.findFirst({
      where:  { staffGroup: group },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    })
    const sortOrder = (last?.sortOrder ?? 0) + 10

    const packer = await prisma.packer.create({
      data: { name: name.trim(), staffGroup: group, sortOrder },
    })
    return NextResponse.json({ packer })
  } catch (e: any) {
    console.error("packers POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
