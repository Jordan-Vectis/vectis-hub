import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Returns distinct vendors that have at least one sold lot.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const rows = await prisma.warehouseItem.findMany({
      where: { vendorNo: { not: null }, hammerPrice: { gt: 0 } },
      select: { vendorNo: true, vendorName: true },
      distinct: ["vendorNo"],
      take: 1000,
    })

    const vendors = rows
      .filter(r => r.vendorNo)
      .map(r => ({ vendorNo: r.vendorNo!, vendorName: r.vendorName ?? "" }))
      .sort((a, b) => (a.vendorName || a.vendorNo).localeCompare(b.vendorName || b.vendorNo))

    return NextResponse.json({ vendors })
  } catch (e: any) {
    console.error("marketing/vendors error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
