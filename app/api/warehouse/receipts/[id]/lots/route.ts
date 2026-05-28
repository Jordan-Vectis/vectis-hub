import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWarehouseAccess("warehouse")
    const { id } = await params

    const lots = await prisma.catalogueLot.findMany({
      where: { receipt: { startsWith: id + "-" } },
      select: {
        id:              true,
        barcode:         true,
        receiptUniqueId: true,
        title:           true,
        receipt:     true,
        status:      true,
        estimateLow: true,
        estimateHigh:true,
        auction: { select: { id: true, code: true, name: true } },
      },
      orderBy: { receipt: "asc" },
    })

    return NextResponse.json(lots)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
