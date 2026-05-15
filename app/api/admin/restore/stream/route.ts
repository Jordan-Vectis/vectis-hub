import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

const BACKUP_BUCKET = process.env.CLOUDFLARE_R2_BACKUP_BUCKET!

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
  "bcCatalogueDays", "bcCatalogueEntries", "bcPackingDays", "bcPackingEntries",
  "warehouseReceipts", "warehouseContainers", "warehouseLocations", "warehouseMovements",
  "parcels", "parcelLots",
  "macroFiles", "heroSlides", "researchLogs",
  "warehouseItems", "warehouseSyncLogs", "warehouseTotes",
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

        // Work out which tables actually have data
        const tablesToProcess = TABLE_ORDER.filter(name => tables[name] && (tables[name]?.length ?? 0) > 0)
        const total = tablesToProcess.length
        const counts: Record<string, number> = {}

        send({ stage: "starting", message: `Restoring ${total} tables…`, pct: 2 })

        for (let i = 0; i < tablesToProcess.length; i++) {
          const name = tablesToProcess[i]
          const rows = tables[name]!
          const pct = Math.round(2 + ((i / total) * 96))

          send({
            stage: "restoring",
            table: name,
            tableIndex: i + 1,
            tableTotal: total,
            rowCount: rows.length,
            message: `Restoring ${name} (${rows.length} rows)…`,
            pct,
          })

          try {
            for (const row of rows) {
              await upsertRow(name, row)
            }
            counts[name] = rows.length
          } catch (e: any) {
            send({
              stage: "error",
              message: `Failed on table "${name}": ${e?.message ?? "unknown error"}`,
              pct,
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
    },
  })
}
