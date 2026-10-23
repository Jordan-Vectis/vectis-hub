import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { personName } from "@/lib/goods-in/customer-row"
import { CONTAINER_STATUS, type ContainerStatus } from "@/lib/goods-in/model"
import { TOTE_EXPORT_MAX, TOTE_SELECT, parseToteFilter, toteOrderBy, toteWhere } from "@/lib/goods-in/tote-list"

// Goods In → Totes & pallets → Export CSV: exactly the rows the list's filters match (the same URL
// parameters, read by the same module), newest first, up to 50,000. Streamed 2,000 rows at a time so
// a big export never holds the whole table in memory. Goods In access only; nothing from BC.

export const dynamic = "force-dynamic"
export const maxDuration = 120

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-CA", { timeZone: "Europe/London" }) : "")
const when = (d: Date | null | undefined) => (d ? d.toLocaleString("en-GB", { timeZone: "Europe/London", hour12: false }) : "")

export async function GET(req: NextRequest) {
  try {
    const me = await getGoodsInUser()
    if (!me) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const sp = Object.fromEntries(new URL(req.url).searchParams.entries())
    const f = parseToteFilter(sp)
    const where = toteWhere(f)
    const orderBy = toteOrderBy(f)

    const header = ["Number", "Kind", "Status", "Category", "Description", "Location", "Location kind", "Last moved", "Receipt", "Receipt status", "Vendor no.", "Customer", "Booked", "Label printed", "Booked in", "Booked by"]
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode("﻿" + header.join(",") + "\r\n"))
          let skip = 0
          let sent = 0
          while (sent < TOTE_EXPORT_MAX) {
            const batch = await prisma.goodsInContainer.findMany({ where, orderBy, skip, take: Math.min(2000, TOTE_EXPORT_MAX - sent), select: TOTE_SELECT })
            if (batch.length === 0) break
            const lines = batch.map(c => [
              c.id, c.kind, CONTAINER_STATUS[(c.status ?? "booked") as ContainerStatus]?.label ?? c.status ?? "", c.category, c.description,
              c.locationCode, c.locationKind, when(c.movedAt), c.receiptId, c.receipt.status ?? "open", c.receipt.vendorNo,
              personName(c.receipt.person, c.receipt.customer), day(c.createdAt), day(c.labelPrintedAt), c.source === "bc" ? "Business Central" : "The Hub", c.createdByName,
            ].map(cell).join(",")).join("\r\n") + "\r\n"
            controller.enqueue(encoder.encode(lines))
            sent += batch.length
            skip += batch.length
            if (batch.length < 2000) break
          }
          controller.close()
        } catch (e) {
          console.error("goods-in totes export error:", e)
          controller.error(e)
        }
      },
    })
    const name = `goods-in-totes-${new Date().toISOString().slice(0, 10)}.csv`
    return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } })
  } catch (e: any) {
    console.error("goods-in totes export error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
