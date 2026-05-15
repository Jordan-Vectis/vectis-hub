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
  // Each table is fetched individually so a missing table doesn't abort the whole backup
  async function safe<T>(fn: () => Promise<T[]>): Promise<T[] | null> {
    try { return await fn() } catch { return null }
  }

  const tables = {
    users:                  await safe(() => prisma.user.findMany()),
    bcTokens:               await safe(() => prisma.bCToken.findMany()),
    departments:            await safe(() => prisma.department.findMany()),
    contacts:               await safe(() => prisma.contact.findMany()),
    customerAccounts:       await safe(() => prisma.customerAccount.findMany()),
    submissions:            await safe(() => prisma.submission.findMany()),
    items:                  await safe(() => prisma.item.findMany()),
    valuations:             await safe(() => prisma.valuation.findMany()),
    contactLogs:            await safe(() => prisma.contactLog.findMany()),
    auctionRuns:            await safe(() => prisma.auctionRun.findMany()),
    auctionLots:            await safe(() => prisma.auctionLot.findMany()),
    aiPresets:              await safe(() => prisma.aiPreset.findMany()),
    logistics:              await safe(() => prisma.logistics.findMany()),
    catalogueAuctions:      await safe(() => prisma.catalogueAuction.findMany()),
    bidderRegistrations:    await safe(() => prisma.bidderRegistration.findMany()),
    liveAuctions:           await safe(() => prisma.liveAuction.findMany()),
    catalogueLots:          await safe(() => prisma.catalogueLot.findMany()),
    commissionBids:         await safe(() => prisma.commissionBid.findMany()),
    idleLogs:               await safe(() => prisma.idleLog.findMany()),
    catalogueTimingLogs:    await safe(() => prisma.catalogueTimingLog.findMany()),
    cataloguePhotoSessions: await safe(() => prisma.cataloguePhotoSession.findMany()),
    appCards:               await safe(() => prisma.appCard.findMany()),
    roleDefaults:           await safe(() => prisma.roleDefault.findMany()),
    marketingDrafts:        await safe(() => prisma.marketingDraft.findMany()),
    marketingHashtags:      await safe(() => prisma.marketingHashtag.findMany()),
    // BC cache tables intentionally excluded — data can be resynced from Business Central
    warehouseReceipts:      await safe(() => prisma.warehouseReceipt.findMany()),
    warehouseContainers:    await safe(() => prisma.warehouseContainer.findMany()),
    warehouseLocations:     await safe(() => prisma.warehouseLocation.findMany()),
    warehouseMovements:     await safe(() => prisma.warehouseMovement.findMany()),
    parcels:                await safe(() => prisma.parcel.findMany()),
    parcelLots:             await safe(() => prisma.parcelLot.findMany()),
    macroFiles:             await safe(() => prisma.macroFile.findMany()),
    heroSlides:             await safe(() => prisma.heroSlide.findMany()),
    researchLogs:           await safe(() => prisma.researchLog.findMany()),
    devices:                await safe(() => prisma.device.findMany()),
    packers:                await safe(() => prisma.packer.findMany()),
    claudeMemory:           await safe(() => prisma.claudeMemory.findMany()),
    emailTemplates:         await safe(() => prisma.emailTemplate.findMany()),
    knowledgeArticles:      await safe(() => prisma.knowledgeArticle.findMany()),
    ticketCategories:       await safe(() => prisma.ticketCategory.findMany()),
    tickets:                await safe(() => prisma.ticket.findMany()),
    ticketComments:         await safe(() => prisma.ticketComment.findMany()),
    warehouseTotes:         await safe(() => prisma.warehouseTote.findMany()),
  }

  const dump = {
    exportedAt: new Date().toISOString(),
    tables,
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
