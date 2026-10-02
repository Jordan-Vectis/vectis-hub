import { NextRequest, NextResponse } from "next/server"
import { uploadBufferToR2, deleteObjectsFromR2 } from "@/lib/r2"
import { requireVans, VAN_FILE_PREFIX } from "@/lib/vans"

export const maxDuration = 60

// /api/vans/file — upload a van photo or a scanned invoice / MOT certificate; delete one.
// Reads go through /api/catalogue/photo-proxy?key=… — these are shared staff records, so
// the login-gated proxy is the right reader (unlike the /jordan garage, which is private).
const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]
const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })

export async function POST(req: NextRequest) {
  try {
    await requireVans()
    const form = await req.formData()
    const file = form.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })
    const type = (file.type || "").toLowerCase()
    if (!ALLOWED.includes(type)) return NextResponse.json({ error: "Upload a photo or a PDF." }, { status: 415 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is over 20MB." }, { status: 413 })

    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase()
    const key = `${VAN_FILE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`
    await uploadBufferToR2(Buffer.from(await file.arrayBuffer()), key, type)
    return NextResponse.json({ key, name: file.name, type })
  } catch (e: any) {
    if (!e?.http) console.error("vans/file POST:", e)
    return err(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireVans()
    const { key } = await req.json()
    if (!key || !String(key).startsWith(VAN_FILE_PREFIX) || String(key).includes("..")) {
      return NextResponse.json({ error: "Not a van file" }, { status: 400 })
    }
    await deleteObjectsFromR2([String(key)])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("vans/file DELETE:", e)
    return err(e)
  }
}
