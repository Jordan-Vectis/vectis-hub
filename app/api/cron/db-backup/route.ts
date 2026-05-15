import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { r2 } from "@/lib/r2"
import {
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3"

export const maxDuration = 300

const BACKUP_BUCKET = process.env.CLOUDFLARE_R2_BACKUP_BUCKET!
const MAX_BACKUPS = 30

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: "Unauthorised" }, { status: 401 })
    }

    const result = await runBackup()
    return Response.json(result)
  } catch (e: any) {
    console.error("[cron/db-backup] error:", e)
    return Response.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function runBackup(): Promise<{
  ok: boolean
  filename: string
  sizeBytes: number
  deleted: number
}> {
  // ── 1. Dump all tables via Prisma ──────────────────────────────────────────
  const [
    users,
    bcTokens,
    departments,
    contacts,
    customerAccounts,
    submissions,
    items,
    valuations,
    contactLogs,
    auctionRuns,
    auctionLots,
    aiPresets,
    logistics,
    catalogueAuctions,
    bidderRegistrations,
    liveAuctions,
    catalogueLots,
    commissionBids,
    idleLogs,
    catalogueTimingLogs,
    cataloguePhotoSessions,
    appCards,
    roleDefaults,
    marketingDrafts,
    marketingHashtags,
    bcCatalogueDays,
    bcCatalogueEntries,
    bcPackingDays,
    bcPackingEntries,
    warehouseReceipts,
    warehouseContainers,
    warehouseLocations,
    warehouseMovements,
    parcels,
    parcelLots,
    macroFiles,
    heroSlides,
    researchLogs,
    warehouseItems,
    warehouseSyncLogs,
    devices,
    packers,
    claudeMemory,
    emailTemplates,
    knowledgeArticles,
    ticketCategories,
    tickets,
    ticketComments,
    warehouseTotes,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.bCToken.findMany(),
    prisma.department.findMany(),
    prisma.contact.findMany(),
    prisma.customerAccount.findMany(),
    prisma.submission.findMany(),
    prisma.item.findMany(),
    prisma.valuation.findMany(),
    prisma.contactLog.findMany(),
    prisma.auctionRun.findMany(),
    prisma.auctionLot.findMany(),
    prisma.aiPreset.findMany(),
    prisma.logistics.findMany(),
    prisma.catalogueAuction.findMany(),
    prisma.bidderRegistration.findMany(),
    prisma.liveAuction.findMany(),
    prisma.catalogueLot.findMany(),
    prisma.commissionBid.findMany(),
    prisma.idleLog.findMany(),
    prisma.catalogueTimingLog.findMany(),
    prisma.cataloguePhotoSession.findMany(),
    prisma.appCard.findMany(),
    prisma.roleDefault.findMany(),
    prisma.marketingDraft.findMany(),
    prisma.marketingHashtag.findMany(),
    prisma.bCCatalogueDay.findMany(),
    prisma.bCCatalogueEntry.findMany(),
    prisma.bCPackingDay.findMany(),
    prisma.bCPackingEntry.findMany(),
    prisma.warehouseReceipt.findMany(),
    prisma.warehouseContainer.findMany(),
    prisma.warehouseLocation.findMany(),
    prisma.warehouseMovement.findMany(),
    prisma.parcel.findMany(),
    prisma.parcelLot.findMany(),
    prisma.macroFile.findMany(),
    prisma.heroSlide.findMany(),
    prisma.researchLog.findMany(),
    prisma.warehouseItem.findMany(),
    prisma.warehouseSyncLog.findMany(),
    prisma.device.findMany(),
    prisma.packer.findMany(),
    prisma.claudeMemory.findMany(),
    prisma.emailTemplate.findMany(),
    prisma.knowledgeArticle.findMany(),
    prisma.ticketCategory.findMany(),
    prisma.ticket.findMany(),
    prisma.ticketComment.findMany(),
    prisma.warehouseTote.findMany(),
  ])

  const dump = {
    exportedAt: new Date().toISOString(),
    tables: {
      users,
      bcTokens,
      departments,
      contacts,
      customerAccounts,
      submissions,
      items,
      valuations,
      contactLogs,
      auctionRuns,
      auctionLots,
      aiPresets,
      logistics,
      catalogueAuctions,
      bidderRegistrations,
      liveAuctions,
      catalogueLots,
      commissionBids,
      idleLogs,
      catalogueTimingLogs,
      cataloguePhotoSessions,
      appCards,
      roleDefaults,
      marketingDrafts,
      marketingHashtags,
      bcCatalogueDays,
      bcCatalogueEntries,
      bcPackingDays,
      bcPackingEntries,
      warehouseReceipts,
      warehouseContainers,
      warehouseLocations,
      warehouseMovements,
      parcels,
      parcelLots,
      macroFiles,
      heroSlides,
      researchLogs,
      warehouseItems,
      warehouseSyncLogs,
      devices,
      packers,
      claudeMemory,
      emailTemplates,
      knowledgeArticles,
      ticketCategories,
      tickets,
      ticketComments,
      warehouseTotes,
    },
  }

  // ── 2. Serialise — handle BigInt and Buffer safely ──────────────────────────
  const json = JSON.stringify(dump, (_key, value) => {
    if (typeof value === "bigint") return value.toString()
    if (value instanceof Buffer) return value.toString("base64")
    return value
  })

  const buffer = Buffer.from(json, "utf-8")

  // ── 3. Build filename and upload to R2 ─────────────────────────────────────
  const env = process.env.RAILWAY_ENVIRONMENT_NAME ?? "unknown"
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const filename = `${env}/backup-${timestamp}.json`

  await r2.send(
    new PutObjectCommand({
      Bucket: BACKUP_BUCKET,
      Key: filename,
      Body: buffer,
      ContentType: "application/json",
    })
  )

  console.log(`[cron/db-backup] Uploaded ${filename} (${buffer.length} bytes)`)

  // ── 4. Prune old backups — keep only the last MAX_BACKUPS per environment ──
  let deleted = 0
  const listRes = await r2.send(
    new ListObjectsV2Command({ Bucket: BACKUP_BUCKET, Prefix: `${env}/` })
  )

  const objects = (listRes.Contents ?? [])
    .filter(o => o.Key?.endsWith(".json"))
    .sort((a, b) => (a.Key! < b.Key! ? -1 : 1)) // ascending by name = ascending by date

  if (objects.length > MAX_BACKUPS) {
    const toDelete = objects.slice(0, objects.length - MAX_BACKUPS)
    await r2.send(
      new DeleteObjectsCommand({
        Bucket: BACKUP_BUCKET,
        Delete: {
          Objects: toDelete.map(o => ({ Key: o.Key! })),
          Quiet: true,
        },
      })
    )
    deleted = toDelete.length
    console.log(`[cron/db-backup] Pruned ${deleted} old backup(s)`)
  }

  return { ok: true, filename, sizeBytes: buffer.length, deleted }
}
