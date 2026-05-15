import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { ListObjectsV2Command } from "@aws-sdk/client-s3"
import { runBackup } from "@/app/api/cron/db-backup/route"

const BACKUP_BUCKET = process.env.CLOUDFLARE_R2_BACKUP_BUCKET!

// ── GET — list all backup files ────────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const listRes = await r2.send(
      new ListObjectsV2Command({ Bucket: BACKUP_BUCKET })
    )

    const files = (listRes.Contents ?? [])
      .filter(o => o.Key?.startsWith("backup-") && o.Key.endsWith(".json"))
      .sort((a, b) => (a.Key! > b.Key! ? -1 : 1)) // descending — newest first
      .map(o => ({
        key: o.Key!,
        sizeBytes: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString() ?? null,
      }))

    return NextResponse.json({ files })
  } catch (e: any) {
    console.error("[admin/backup] GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// ── POST — trigger an immediate backup ────────────────────────────────────────
export async function POST(_req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const result = await runBackup()
    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[admin/backup] POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
