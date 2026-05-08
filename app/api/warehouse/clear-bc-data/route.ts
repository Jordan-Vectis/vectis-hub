import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// POST /api/warehouse/clear-bc-data
// Body: { confirm: "DELETE", target: "items" | "totes" | "both" }
// ADMIN ONLY. Wipes the BC-synced cache tables so the next sync re-pulls
// everything from scratch. Use when names/values look stale and a refresh
// hasn't fixed it.
//
// Does NOT touch CatalogueLot, ClaudeMemory, MarketingDraft, or any other
// non-BC data. Only WarehouseItem and/or WarehouseTote.

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const { confirm, target } = await req.json() as {
      confirm: string
      target:  "items" | "totes" | "both"
    }

    if (confirm !== "DELETE") {
      return NextResponse.json({ error: "Confirmation phrase did not match" }, { status: 400 })
    }
    if (!["items", "totes", "both"].includes(target)) {
      return NextResponse.json({ error: "Invalid target" }, { status: 400 })
    }

    let itemsDeleted = 0
    let totesDeleted = 0

    if (target === "items" || target === "both") {
      const r = await prisma.warehouseItem.deleteMany({})
      itemsDeleted = r.count
    }
    if (target === "totes" || target === "both") {
      const r = await prisma.warehouseTote.deleteMany({})
      totesDeleted = r.count
    }

    // Clear the sync log entries for the wiped sources so the next sync
    // does a full pull rather than an incremental one.
    const sourcesToReset: string[] = []
    if (target === "items" || target === "both") sourcesToReset.push("receipt_lines", "auction_lines", "changelog")
    if (target === "totes" || target === "both") sourcesToReset.push("totes", "totes-active")
    if (sourcesToReset.length > 0) {
      await prisma.warehouseSyncLog.deleteMany({ where: { source: { in: sourcesToReset } } })
    }

    return NextResponse.json({
      ok:           true,
      itemsDeleted,
      totesDeleted,
      sourcesReset: sourcesToReset,
    })
  } catch (e: any) {
    console.error("clear-bc-data error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
