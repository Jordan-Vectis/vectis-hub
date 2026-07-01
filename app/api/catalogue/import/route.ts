import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logLotCreated } from "@/lib/lot-log"
import * as XLSX from "xlsx"

// POST /api/catalogue/import
// Body: multipart form with file field "file" (xlsx)
// Merges — creates auction if missing, upserts lots by id → receiptUniqueId → barcode, creates new if no match
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const form = await req.formData()
    const file = form.get("file")
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file provided" }, { status: 400 })

    const buf  = Buffer.from(await (file as File).arrayBuffer())
    const wb   = XLSX.read(buf, { type: "buffer" })

    // ── Parse Auction sheet ───────────────────────────────────────────────────
    const auctionSheet = wb.Sheets["Auction"]
    if (!auctionSheet) return NextResponse.json({ error: "Missing 'Auction' sheet" }, { status: 422 })

    const [auctionRow] = XLSX.utils.sheet_to_json<any>(auctionSheet)
    if (!auctionRow?.code) return NextResponse.json({ error: "Auction sheet is missing 'code' column" }, { status: 422 })

    const code = String(auctionRow.code).trim().toUpperCase()

    // Upsert the auction (never overwrite id)
    const auction = await prisma.catalogueAuction.upsert({
      where:  { code },
      update: {
        name:        auctionRow.name        ?? undefined,
        auctionDate: auctionRow.auctionDate ? new Date(auctionRow.auctionDate) : undefined,
        auctionType: auctionRow.auctionType ?? undefined,
        eventName:   auctionRow.eventName   || undefined,
        notes:       auctionRow.notes       || undefined,
      },
      create: {
        code,
        name:        auctionRow.name        ?? code,
        auctionDate: auctionRow.auctionDate ? new Date(auctionRow.auctionDate) : null,
        auctionType: auctionRow.auctionType ?? "GENERAL",
        eventName:   auctionRow.eventName   || null,
        notes:       auctionRow.notes       || null,
      },
    })

    // ── Parse Lots sheet ──────────────────────────────────────────────────────
    const lotsSheet = wb.Sheets["Lots"]
    if (!lotsSheet) return NextResponse.json({ ok: true, created: 0, skipped: 0, errors: [] })

    const rows = XLSX.utils.sheet_to_json<any>(lotsSheet)

    // Load existing lots for this auction for merge matching
    const existing = await prisma.catalogueLot.findMany({
      where:  { auctionId: auction.id },
      select: { id: true, receiptUniqueId: true, barcode: true },
    })
    const byId  = new Map(existing.map(l => [l.id,                          l.id]))
    const byUID = new Map(existing.filter(l => l.receiptUniqueId).map(l => [l.receiptUniqueId!, l.id]))
    const byBC  = new Map(existing.filter(l => l.barcode).map(l => [l.barcode!, l.id]))

    let created = 0
    let skipped = 0
    const errors: string[] = []
    const importCtx = { changedBy: session.user.name ?? session.user.email ?? "Unknown", source: "import", batchId: crypto.randomUUID() }

    for (const row of rows) {
      try {
        // Resolve match
        const rowId  = row.id  ? String(row.id).trim()  : ""
        const rowUID = row.receiptUniqueId ? String(row.receiptUniqueId).trim() : ""
        const rowBC  = row.barcode         ? String(row.barcode).trim()         : ""

        const existingId = byId.get(rowId) ?? byUID.get(rowUID) ?? byBC.get(rowBC) ?? null

        const imageUrls = row.imageUrls
          ? String(row.imageUrls).split(",").map((s: string) => s.trim()).filter(Boolean)
          : []

        function num(v: any): number | null {
          if (v === "" || v == null) return null
          const n = Number(v)
          return isNaN(n) ? null : n
        }
        function str(v: any): string | null {
          if (v === "" || v == null) return null
          return String(v).trim() || null
        }
        function bool(v: any): boolean {
          if (typeof v === "boolean") return v
          if (v === "true" || v === "TRUE" || v === 1 || v === "1") return true
          return false
        }

        const data = {
          title:           str(row.title)           ?? "Untitled",
          description:     str(row.description)     ?? "",
          keyPoints:       str(row.keyPoints)        ?? "",
          barcode:         str(row.barcode),
          receiptUniqueId: str(row.receiptUniqueId),
          estimateLow:     num(row.estimateLow),
          estimateHigh:    num(row.estimateHigh),
          aiEstimateLow:   num(row.aiEstimateLow),
          aiEstimateHigh:  num(row.aiEstimateHigh),
          startingBid:     num(row.startingBid),
          reserve:         num(row.reserve),
          currentBid:      num(row.currentBid),
          hammerPrice:     num(row.hammerPrice),
          condition:       str(row.condition),
          vendor:          str(row.vendor),
          tote:            str(row.tote),
          receipt:         str(row.receipt),
          category:        str(row.category),
          subCategory:     str(row.subCategory),
          brand:           str(row.brand),
          notes:           str(row.notes),
          extraDetails:    str(row.extraDetails),
          imageUrls,
          status:          str(row.status)          ?? "ENTERED",
          aiUpgraded:      bool(row.aiUpgraded),
          addedToBC:       bool(row.addedToBC),
          createdByName:   str(row.createdByName),
        }

        if (existingId) {
          // Lot exists — skip (merge = don't overwrite existing work)
          skipped++
        } else {
          // New lot
          const lot = await prisma.catalogueLot.create({
            data: { ...data, auctionId: auction.id },
          })
          await logLotCreated({ ...lot, id: lot.id, auctionId: auction.id }, code, importCtx)
          created++
        }
      } catch (e: any) {
        errors.push(`Row ${rows.indexOf(row) + 2}: ${e?.message ?? "Unknown error"}`)
      }
    }

    return NextResponse.json({ ok: true, auctionId: auction.id, code, created, skipped, errors })
  } catch (e: any) {
    console.error("catalogue/import error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
