import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

const BACKUP_BUCKET = process.env.CLOUDFLARE_R2_BACKUP_BUCKET!

// ── Helper: stream R2 object to string ────────────────────────────────────────
async function downloadJson(key: string): Promise<any> {
  const res = await r2.send(
    new GetObjectCommand({ Bucket: BACKUP_BUCKET, Key: key })
  )
  const chunks: Uint8Array[] = []
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"))
}

// ── Helper: upsert a single row into the correct Prisma model ─────────────────
// tableName must match the key names used in the backup JSON (same as runBackup).
async function upsertRow(tableName: string, r: any): Promise<void> {
  switch (tableName) {
    case "departments":            await prisma.department.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "users":                  await prisma.user.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "bcTokens":               await prisma.bCToken.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "contacts":               await prisma.contact.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "customerAccounts":       await prisma.customerAccount.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "submissions":            await prisma.submission.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "items":                  await prisma.item.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "valuations":             await prisma.valuation.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "contactLogs":            await prisma.contactLog.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "logistics":              await prisma.logistics.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "auctionRuns":            await prisma.auctionRun.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "auctionLots":            await prisma.auctionLot.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "aiPresets":              await prisma.aiPreset.upsert({ where: { key: r.key }, update: r, create: r }); break
    case "catalogueAuctions":      await prisma.catalogueAuction.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "liveAuctions":           await prisma.liveAuction.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "catalogueLots":          await prisma.catalogueLot.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "bidderRegistrations":    await prisma.bidderRegistration.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "commissionBids":         await prisma.commissionBid.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "idleLogs":               await prisma.idleLog.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "catalogueTimingLogs":    await prisma.catalogueTimingLog.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "cataloguePhotoSessions": await prisma.cataloguePhotoSession.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "appCards":               await prisma.appCard.upsert({ where: { key: r.key }, update: r, create: r }); break
    case "roleDefaults":           await prisma.roleDefault.upsert({ where: { role: r.role }, update: r, create: r }); break
    case "marketingDrafts":        await prisma.marketingDraft.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "marketingHashtags":      await prisma.marketingHashtag.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "bcCatalogueDays":        await prisma.bCCatalogueDay.upsert({ where: { date_mode: { date: r.date, mode: r.mode } }, update: r, create: r }); break
    case "bcCatalogueEntries":     await prisma.bCCatalogueEntry.upsert({ where: { date_userId_mode: { date: r.date, userId: r.userId, mode: r.mode } }, update: r, create: r }); break
    case "bcPackingDays":          await prisma.bCPackingDay.upsert({ where: { date: r.date }, update: r, create: r }); break
    case "bcPackingEntries":       await prisma.bCPackingEntry.upsert({ where: { date_staff_docNo: { date: r.date, staff: r.staff, docNo: r.docNo } }, update: r, create: r }); break
    case "warehouseReceipts":      await prisma.warehouseReceipt.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "warehouseContainers":    await prisma.warehouseContainer.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "warehouseLocations":     await prisma.warehouseLocation.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "warehouseMovements":     await prisma.warehouseMovement.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "parcels":                await prisma.parcel.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "parcelLots":             await prisma.parcelLot.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "macroFiles": {
      const rec = { ...r, content: Buffer.from(r.content, "base64") }
      await prisma.macroFile.upsert({ where: { id: rec.id }, update: rec, create: rec })
      break
    }
    case "heroSlides":             await prisma.heroSlide.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "researchLogs":           await prisma.researchLog.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "warehouseItems":         await prisma.warehouseItem.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "warehouseSyncLogs":      await prisma.warehouseSyncLog.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "devices":                await prisma.device.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "packers":                await prisma.packer.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "claudeMemory":           await prisma.claudeMemory.upsert({ where: { filename: r.filename }, update: r, create: r }); break
    case "emailTemplates":         await prisma.emailTemplate.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "knowledgeArticles":      await prisma.knowledgeArticle.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "ticketCategories":       await prisma.ticketCategory.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "tickets":                await prisma.ticket.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "ticketComments":         await prisma.ticketComment.upsert({ where: { id: r.id }, update: r, create: r }); break
    case "warehouseTotes":         await prisma.warehouseTote.upsert({ where: { id: r.id }, update: r, create: r }); break
    default:
      throw new Error(`Unknown table: ${tableName}`)
  }
}

// ── POST ───────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const body = await req.json()
    const { key, mode, search, tableName: singleTable, record: singleRecord } = body as {
      key: string
      mode: "full" | "search" | "single"
      search?: string
      tableName?: string
      record?: any
    }

    if (!key || !mode) {
      return NextResponse.json({ error: "key and mode are required" }, { status: 400 })
    }

    // ── Single-record restore mode ───────────────────────────────────────────
    if (mode === "single") {
      if (!singleTable || !singleRecord) {
        return NextResponse.json({ error: "tableName and record are required for single mode" }, { status: 400 })
      }
      await upsertRow(singleTable, singleRecord)
      return NextResponse.json({ ok: true })
    }

    // ── Batch restore by field values ────────────────────────────────────────
    // Downloads the backup, filters a table by a field value list, upserts matches.
    // Body: { key, mode: "batch-by-field", tableName, fieldName, values: string[] }
    if (mode === "batch-by-field") {
      const { tableName: batchTable, fieldName, values } = body as {
        tableName: string
        fieldName: string
        values: string[]
      }
      if (!batchTable || !fieldName || !Array.isArray(values) || values.length === 0) {
        return NextResponse.json({ error: "tableName, fieldName and values are required" }, { status: 400 })
      }
      const dump = await downloadJson(key)
      const rows: any[] = dump.tables?.[batchTable] ?? []
      const valueSet = new Set(values.map(v => String(v).toLowerCase()))
      const matching = rows.filter(r => valueSet.has(String(r[fieldName] ?? "").toLowerCase()))
      if (matching.length === 0) {
        return NextResponse.json({ ok: true, restored: 0, message: "No matching records found in this backup" })
      }
      let restored = 0
      const errors: string[] = []
      for (const row of matching) {
        try {
          await upsertRow(batchTable, row)
          restored++
        } catch (e: any) {
          errors.push(`${row[fieldName]}: ${e?.message ?? "unknown error"}`)
        }
      }
      return NextResponse.json({ ok: true, restored, total: matching.length, errors })
    }

    const dump = await downloadJson(key)
    const tables = dump.tables as Record<string, any[] | null>

    // ── Record search mode ───────────────────────────────────────────────────
    if (mode === "search") {
      if (!search || search.trim() === "") {
        return NextResponse.json({ error: "search term is required for search mode" }, { status: 400 })
      }

      const term = search.trim().toLowerCase()
      const results: Array<{
        table: string
        record: any
        matchedField: string
        matchedValue: string
      }> = []

      for (const [tableName, rows] of Object.entries(tables)) {
        if (!rows) continue
        for (const row of rows) {
          for (const [field, value] of Object.entries(row)) {
            if (typeof value === "string" && value.toLowerCase().includes(term)) {
              results.push({
                table: tableName,
                record: row,
                matchedField: field,
                matchedValue: value,
              })
              break // only report each row once — on first matching field
            }
          }
        }
      }

      return NextResponse.json({ results })
    }

    // ── Full restore mode (upsert only — does not delete new records) ────────
    if (mode === "full") {
      const counts: Record<string, number> = {}

      // Table names in FK-safe order (parents before children)
      const tableOrder = [
        "departments", "users", "bcTokens", "contacts", "customerAccounts",
        "submissions", "items", "valuations", "contactLogs", "logistics",
        "auctionRuns", "auctionLots", "aiPresets",
        "catalogueAuctions", "liveAuctions", "catalogueLots",
        "bidderRegistrations", "commissionBids",
        "idleLogs", "catalogueTimingLogs", "cataloguePhotoSessions",
        "appCards", "roleDefaults",
        "marketingDrafts", "marketingHashtags",
        // Warehouse tables excluded — data can be resynced or is non-critical operational data
        "parcels", "parcelLots",
        "macroFiles", "heroSlides", "researchLogs",
        "devices", "packers", "claudeMemory",
        "emailTemplates", "knowledgeArticles",
        "ticketCategories", "tickets", "ticketComments",
      ]

      for (const name of tableOrder) {
        const rows = tables[name]
        if (!rows || rows.length === 0) continue
        try {
          for (const row of rows) {
            await upsertRow(name, row)
          }
          counts[name] = rows.length
        } catch (e: any) {
          console.error(`[admin/restore] Error restoring table "${name}":`, e)
          throw new Error(`Failed to restore table "${name}": ${e?.message ?? "unknown error"}`)
        }
      }

      const totalRows = Object.values(counts).reduce((a, b) => a + b, 0)
      return NextResponse.json({ ok: true, counts, totalRows })
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
  } catch (e: any) {
    console.error("[admin/restore] POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
