import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3"
import { runBackup } from "@/app/api/cron/db-backup/route"

const BACKUP_BUCKET = process.env.CLOUDFLARE_R2_BACKUP_BUCKET!

// ── GET — list all backup files ────────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const env = process.env.RAILWAY_ENVIRONMENT_NAME ?? "unknown"
    const listRes = await r2.send(
      new ListObjectsV2Command({ Bucket: BACKUP_BUCKET, Prefix: `${env}/` })
    )

    const files = (listRes.Contents ?? [])
      .filter(o => o.Key?.endsWith(".json"))
      .sort((a, b) => (a.Key! > b.Key! ? -1 : 1)) // descending — newest first
      .map(o => ({
        key: o.Key!,
        sizeBytes: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString() ?? null,
        partial: o.Key!.includes("-partial"),
      }))

    return NextResponse.json({ files })
  } catch (e: any) {
    console.error("[admin/backup] GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// ── DELETE — remove a specific backup file ────────────────────────────────────
// Body: { key: string }
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { key } = await req.json()
    if (!key || typeof key !== "string") {
      return NextResponse.json({ error: "key is required" }, { status: 400 })
    }

    await r2.send(
      new DeleteObjectsCommand({
        Bucket: BACKUP_BUCKET,
        Delete: { Objects: [{ Key: key }], Quiet: true },
      })
    )

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[admin/backup] DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// ── POST — trigger an immediate backup ────────────────────────────────────────
// Body (optional): { sections?: string[] }
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const sections = Array.isArray(body.sections) && body.sections.length > 0
      ? body.sections as string[]
      : undefined

    const result = await runBackup(sections)
    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[admin/backup] POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
