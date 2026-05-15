import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { r2 } from "@/lib/r2"
import {
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3"
import { ALL_SECTION_KEYS, getTablesForSections } from "@/lib/backup-sections"

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

// ── Fetch a single table by name ──────────────────────────────────────────────
// Returns null if the table doesn't exist or the query fails.
async function fetchTable(tableName: string): Promise<any[] | null> {
  try {
    switch (tableName) {
      case "departments":            return await prisma.department.findMany()
      case "users":                  return await prisma.user.findMany()
      case "bcTokens":               return await prisma.bCToken.findMany()
      case "contacts":               return await prisma.contact.findMany()
      case "customerAccounts":       return await prisma.customerAccount.findMany()
      case "submissions":            return await prisma.submission.findMany()
      case "items":                  return await prisma.item.findMany()
      case "valuations":             return await prisma.valuation.findMany()
      case "contactLogs":            return await prisma.contactLog.findMany()
      case "logistics":              return await prisma.logistics.findMany()
      case "auctionRuns":            return await prisma.auctionRun.findMany()
      case "auctionLots":            return await prisma.auctionLot.findMany()
      case "aiPresets":              return await prisma.aiPreset.findMany()
      case "catalogueAuctions":      return await prisma.catalogueAuction.findMany()
      case "liveAuctions":           return await prisma.liveAuction.findMany()
      case "catalogueLots":          return await prisma.catalogueLot.findMany()
      case "bidderRegistrations":    return await prisma.bidderRegistration.findMany()
      case "commissionBids":         return await prisma.commissionBid.findMany()
      case "idleLogs":               return await prisma.idleLog.findMany()
      case "catalogueTimingLogs":    return await prisma.catalogueTimingLog.findMany()
      case "cataloguePhotoSessions": return await prisma.cataloguePhotoSession.findMany()
      case "appCards":               return await prisma.appCard.findMany()
      case "roleDefaults":           return await prisma.roleDefault.findMany()
      case "marketingDrafts":        return await prisma.marketingDraft.findMany()
      case "marketingHashtags":      return await prisma.marketingHashtag.findMany()
      case "parcels":                return await prisma.parcel.findMany()
      case "parcelLots":             return await prisma.parcelLot.findMany()
      case "macroFiles":             return await prisma.macroFile.findMany()
      case "heroSlides":             return await prisma.heroSlide.findMany()
      case "researchLogs":           return await prisma.researchLog.findMany()
      case "devices":                return await prisma.device.findMany()
      case "packers":                return await prisma.packer.findMany()
      case "claudeMemory":           return await prisma.claudeMemory.findMany()
      case "emailTemplates":         return await prisma.emailTemplate.findMany()
      case "knowledgeArticles":      return await prisma.knowledgeArticle.findMany()
      case "ticketCategories":       return await prisma.ticketCategory.findMany()
      case "tickets":                return await prisma.ticket.findMany()
      case "ticketComments":         return await prisma.ticketComment.findMany()
      default:
        console.warn(`[db-backup] Unknown table requested: ${tableName}`)
        return null
    }
  } catch {
    return null
  }
}

// ── Main backup function ──────────────────────────────────────────────────────
// sectionKeys: which sections to include. Defaults to all sections (full backup).
export async function runBackup(sectionKeys?: string[]): Promise<{
  ok: boolean
  filename: string
  sizeBytes: number
  deleted: number
  sections: string[]
}> {
  const selectedSections = sectionKeys ?? ALL_SECTION_KEYS
  const isFullBackup = selectedSections.length === ALL_SECTION_KEYS.length
  const tablesToFetch = getTablesForSections(selectedSections)

  // Fetch each table individually so a missing table doesn't abort the whole backup
  const tables: Record<string, any[] | null> = {}
  for (const name of tablesToFetch) {
    tables[name] = await fetchTable(name)
  }

  const dump = {
    exportedAt: new Date().toISOString(),
    sections: selectedSections,
    tables,
  }

  // ── Serialise — handle BigInt and Buffer safely ──────────────────────────────
  const json = JSON.stringify(dump, (_key, value) => {
    if (typeof value === "bigint") return value.toString()
    if (value instanceof Buffer) return value.toString("base64")
    return value
  })

  const buffer = Buffer.from(json, "utf-8")

  // ── Build filename and upload to R2 ─────────────────────────────────────────
  const env = process.env.RAILWAY_ENVIRONMENT_NAME ?? "unknown"
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const suffix = isFullBackup ? "" : "-partial"
  const filename = `${env}/backup-${timestamp}${suffix}.json`

  await r2.send(
    new PutObjectCommand({
      Bucket: BACKUP_BUCKET,
      Key: filename,
      Body: buffer,
      ContentType: "application/json",
    })
  )

  console.log(`[cron/db-backup] Uploaded ${filename} (${buffer.length} bytes) — sections: ${selectedSections.join(", ")}`)

  // ── Prune old backups — keep only the last MAX_BACKUPS per environment ───────
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

  return { ok: true, filename, sizeBytes: buffer.length, deleted, sections: selectedSections }
}
