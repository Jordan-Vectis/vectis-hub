import { NextRequest, NextResponse } from "next/server"
import { ListObjectsV2Command, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"

// Admin → Claude Memory → Setup backups. A small file shelf for the zip of Claude Code's
// settings, memory and chats (Jordan, 2026-10-12: "put it in the claude memory section")
// so a new PC can pull it from the Hub. Admins only.
//
// GET                → the files under claude-memory/ (listed straight from R2 — no table)
// GET ?key=…         → 302 to a signed download link (the zip is hundreds of MB; never proxied)
// POST {filename,size,contentType} → a presigned PUT so the browser sends the bytes to R2 itself
// DELETE {key}       → remove one file
//
// ⚠ Whatever is uploaded here is readable by EVERY admin. The zip must never contain
// .credentials.json (a login token) — the upload notes say so and the zip is made without it.

const PREFIX = "claude-memory/"
const MAX_BYTES = 2_000_000_000
const bucket = () => process.env.CLOUDFLARE_R2_BUCKET!

async function requireAdmin() {
  const session = await auth()
  if (!session) throw Object.assign(new Error("Unauthorised"), { http: 401 })
  if (session.user.role !== "ADMIN") throw Object.assign(new Error("Admins only"), { http: 403 })
  return session
}
const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })
const safeKey = (k: any) => {
  const key = String(k ?? "")
  return key.startsWith(PREFIX) && !key.includes("..") && key.length > PREFIX.length ? key : null
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const key = req.nextUrl.searchParams.get("key")
    if (key) {
      const k = safeKey(key)
      if (!k) return NextResponse.json({ error: "Not a backup file" }, { status: 400 })
      const name = k.slice(PREFIX.length).replace(/^\d+-/, "")
      const url = await getSignedUrl(r2, new GetObjectCommand({
        Bucket: bucket(), Key: k,
        ResponseContentDisposition: `attachment; filename="${name.replace(/"/g, "")}"`,
      }), { expiresIn: 3600 })
      return NextResponse.redirect(url, 302)
    }
    const files: { key: string; name: string; size: number; uploadedAt: string }[] = []
    let token: string | undefined
    do {
      const res = await r2.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: PREFIX, ContinuationToken: token }))
      for (const o of res.Contents ?? []) {
        if (!o.Key || o.Key === PREFIX) continue
        files.push({ key: o.Key, name: o.Key.slice(PREFIX.length).replace(/^\d+-/, ""), size: o.Size ?? 0, uploadedAt: o.LastModified?.toISOString() ?? "" })
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (token)
    files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    return NextResponse.json({ files })
  } catch (e: any) {
    if (!e?.http) console.error("admin/memory-backups GET:", e)
    return err(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const { filename, contentType, size } = await req.json()
    const name = String(filename ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)
    if (!name) return NextResponse.json({ error: "No filename" }, { status: 400 })
    if (Number(size) > MAX_BYTES) return NextResponse.json({ error: "Over 2 GB — split it." }, { status: 413 })
    const key = `${PREFIX}${Date.now()}-${name}`
    const url = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: bucket(), Key: key, ContentType: String(contentType || "application/octet-stream"),
    }), { expiresIn: 3600 })
    return NextResponse.json({ url, key })
  } catch (e: any) {
    if (!e?.http) console.error("admin/memory-backups POST:", e)
    return err(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin()
    const { key } = await req.json()
    const k = safeKey(key)
    if (!k) return NextResponse.json({ error: "Not a backup file" }, { status: 400 })
    await r2.send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: [{ Key: k }] } }))
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("admin/memory-backups DELETE:", e)
    return err(e)
  }
}
