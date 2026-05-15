import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

const BACKUP_BUCKET = process.env.CLOUDFLARE_R2_BACKUP_BUCKET!

// How many rows to upsert per Prisma transaction.
// Batching is ~10–20× faster than sequential individual upserts.
const UPSERT_BATCH_SIZE = 50

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

// Returns a Prisma promise (does NOT await) so it can be passed to $transaction.
function buildUpsert(tableName: string, r: any) {
  switch (tableName) {
    case "departments":            return prisma.department.upsert({ where: { id: r.id }, update: r, create: r })
    case "users":                  return prisma.user.upsert({ where: { id: r.id }, update: r, create: r })
    case "bcTokens":               return prisma.bCToken.upsert({ where: { id: r.id }, update: r, create: r })
    case "contacts":               return prisma.contact.upsert({ where: { id: r.id }, update: r, create: r })
    case "customerAccounts":       return prisma.customerAccount.upsert({ where: { id: r.id }, update: r, create: r })
    case "submissions":            return prisma.submission.upsert({ where: { id: r.id }, update: r, create: r })
    case "items":                  return prisma.item.upsert({ where: { id: r.id }, update: r, create: r })
    case "valuations":             return prisma.valuation.upsert({ where: { id: r.id }, update: r, create: r })
    case "contactLogs":            return prisma.contactLog.upsert({ where: { id: r.id }, update: r, create: r })
    case "logistics":              return prisma.logistics.upsert({ where: { id: r.id }, update: r, create: r })
    case "auctionRuns":            return prisma.auctionRun.upsert({ where: { id: r.id }, update: r, create: r })
    case "auctionLots":            return prisma.auctionLot.upsert({ where: { id: r.id }, update: r, create: r })
    case "aiPresets":              return prisma.aiPreset.upsert({ where: { key: r.key }, update: r, create: r })
    case "catalogueAuctions":      return prisma.catalogueAuction.upsert({ where: { id: r.id }, update: r, create: r })
    case "liveAuctions":           return prisma.liveAuction.upsert({ where: { id: r.id }, update: r, create: r })
    case "catalogueLots":          return prisma.catalogueLot.upsert({ where: { id: r.id }, update: r, create: r })
    case "bidderRegistrations":    return prisma.bidderRegistration.upsert({ where: { id: r.id }, update: r, create: r })
    case "commissionBids":         return prisma.commissionBid.upsert({ where: { id: r.id }, update: r, create: r })
    case "idleLogs":               return prisma.idleLog.upsert({ where: { id: r.id }, update: r, create: r })
    case "catalogueTimingLogs":    return prisma.catalogueTimingLog.upsert({ where: { id: r.id }, update: r, create: r })
    case "cataloguePhotoSessions": return prisma.cataloguePhotoSession.upsert({ where: { id: r.id }, update: r, create: r })
    case "appCards":               return prisma.appCard.upsert({ where: { key: r.key }, update: r, create: r })
    case "roleDefaults":           return prisma.roleDefault.upsert({ where: { role: r.role }, update: r, create: r })
    case "marketingDrafts":        return prisma.marketingDraft.upsert({ where: { id: r.id }, update: r, create: r })
    case "marketingHashtags":      return prisma.marketingHashtag.upsert({ where: { id: r.id }, update: r, create: r })
    case "bcCatalogueDays":        return prisma.bCCatalogueDay.upsert({ where: { date_mode: { date: r.date, mode: r.mode } }, update: r, create: r })
    case "bcCatalogueEntries":     return prisma.bCCatalogueEntry.upsert({ where: { date_userId_mode: { date: r.date, userId: r.userId, mode: r.mode } }, update: r, create: r })
    case "bcPackingDays":          return prisma.bCPackingDay.upsert({ where: { date: r.date }, update: r, create: r })
    case "bcPackingEntries":       return prisma.bCPackingEntry.upsert({ where: { date_staff_docNo: { date: r.date, staff: r.staff, docNo: r.docNo } }, update: r, create: r })
    case "warehouseReceipts":      return prisma.warehouseReceipt.upsert({ where: { id: r.id }, update: r, create: r })
    case "warehouseContainers":    return prisma.warehouseContainer.upsert({ where: { id: r.id }, update: r, create: r })
    case "warehouseLocations":     return prisma.warehouseLocation.upsert({ where: { id: r.id }, update: r, create: r })
    case "warehouseMovements":     return prisma.warehouseMovement.upsert({ where: { id: r.id }, update: r, create: r })
    case "parcels":                return prisma.parcel.upsert({ where: { id: r.id }, update: r, create: r })
    case "parcelLots":             return prisma.parcelLot.upsert({ where: { id: r.id }, update: r, create: r })
    case "macroFiles": {
      const rec = { ...r, content: Buffer.from(r.content, "base64") }
      return prisma.macroFile.upsert({ where: { id: rec.id }, update: rec, create: rec })
    }
    case "heroSlides":             return prisma.heroSlide.upsert({ where: { id: r.id }, update: r, create: r })
    case "researchLogs":           return prisma.researchLog.upsert({ where: { id: r.id }, update: r, create: r })
    case "warehouseItems":         return prisma.warehouseItem.upsert({ where: { id: r.id }, update: r, create: r })
    case "warehouseSyncLogs":      return prisma.warehouseSyncLog.upsert({ where: { id: r.id }, update: r, create: r })
    case "devices":                return prisma.device.upsert({ where: { id: r.id }, update: r, create: r })
    case "packers":                return prisma.packer.upsert({ where: { id: r.id }, update: r, create: r })
    case "claudeMemory":           return prisma.claudeMemory.upsert({ where: { filename: r.filename }, update: r, create: r })
    case "emailTemplates":         return prisma.emailTemplate.upsert({ where: { id: r.id }, update: r, create: r })
    case "knowledgeArticles":      return prisma.knowledgeArticle.upsert({ where: { id: r.id }, update: r, create: r })
    case "ticketCategories":       return prisma.ticketCategory.upsert({ where: { id: r.id }, update: r, create: r })
    case "tickets":                return prisma.ticket.upsert({ where: { id: r.id }, update: r, create: r })
    case "ticketComments":         return prisma.ticketComment.upsert({ where: { id: r.id }, update: r, create: r })
    case "warehouseTotes":         return prisma.warehouseTote.upsert({ where: { id: r.id }, update: r, create: r })
    default:
      throw new Error(`Unknown table: ${tableName}`)
  }
}

const TABLE_ORDER = [
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

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") {
    return Response.json({ error: "Unauthorised" }, { status: 401 })
  }

  const { key } = await req.json() as { key: string }
  if (!key) return Response.json({ error: "key is required" }, { status: 400 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        send({ stage: "downloading", message: "Downloading backup from R2…", pct: 0 })

        const dump = await downloadJson(key)
        const tables = dump.tables as Record<string, any[] | null>

        const tablesToProcess = TABLE_ORDER.filter(name => tables[name] && (tables[name]?.length ?? 0) > 0)
        const total = tablesToProcess.length
        const counts: Record<string, number> = {}

        send({ stage: "starting", message: `Restoring ${total} tables…`, pct: 2 })

        for (let i = 0; i < tablesToProcess.length; i++) {
          const name = tablesToProcess[i]
          const rows = tables[name]!
          const basePct = Math.round(2 + ((i / total) * 96))

          send({
            stage: "restoring",
            table: name,
            tableIndex: i + 1,
            tableTotal: total,
            rowCount: rows.length,
            message: `Restoring ${name} (${rows.length.toLocaleString()} rows)…`,
            pct: basePct,
          })

          try {
            // Process in batches — much faster than sequential upserts, and
            // sending a heartbeat per batch keeps the SSE connection alive.
            for (let j = 0; j < rows.length; j += UPSERT_BATCH_SIZE) {
              const batch = rows.slice(j, j + UPSERT_BATCH_SIZE)
              await prisma.$transaction(batch.map(r => buildUpsert(name, r)))

              // Heartbeat: update message so the connection stays alive on Railway's proxy
              const processed = Math.min(j + UPSERT_BATCH_SIZE, rows.length)
              send({
                stage: "restoring",
                table: name,
                tableIndex: i + 1,
                tableTotal: total,
                rowCount: rows.length,
                rowsProcessed: processed,
                message: `Restoring ${name} (${processed.toLocaleString()} / ${rows.length.toLocaleString()} rows)…`,
                pct: Math.round(basePct + ((j / rows.length) * (96 / total))),
              })
            }
            counts[name] = rows.length
          } catch (e: any) {
            send({
              stage: "error",
              message: `Failed on table "${name}": ${e?.message ?? "unknown error"}`,
              pct: basePct,
            })
            controller.close()
            return
          }
        }

        const totalRows = Object.values(counts).reduce((a, b) => a + b, 0)
        send({
          stage: "complete",
          message: `Restore complete — ${totalRows.toLocaleString()} records across ${total} tables.`,
          pct: 100,
          counts,
          totalRows,
        })
      } catch (e: any) {
        send({ stage: "error", message: e?.message ?? "Unknown error", pct: 0 })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Prevent Railway's nginx from buffering the stream
    },
  })
}
