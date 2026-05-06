import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/marketing/categories
// Returns distinct non-null category values from WarehouseItem, sorted A-Z.

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const rows = await prisma.warehouseItem.findMany({
      where:   { category: { not: null } },
      select:  { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    })

    const categories = rows.map(r => r.category!).filter(Boolean)
    return NextResponse.json({ categories })
  } catch (e: any) {
    console.error("marketing/categories error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
