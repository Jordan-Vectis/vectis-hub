import { NextRequest, NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { isJordan } from "@/lib/jordan-auth"
import { r2, uploadBufferToR2, deleteObjectsFromR2 } from "@/lib/r2"

export const maxDuration = 60

// /api/jordan/cars/file — the garage's photos and scans.
//
// ⚠ WHY THIS EXISTS RATHER THAN REUSING /api/catalogue/photo-proxy: that route
// serves ANY key in the bucket to ANY logged-in session. These are personal
// files in a menu that is supposed to be invisible to everyone else, so reads go
// through isJordan() here — and the key is required to sit under jordan/cars/,
// so even this route cannot be turned into a reader for the rest of the bucket.
const PREFIX = "jordan/cars/"
const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]

function safeKey(key: string | null): string | null {
  if (!key || !key.startsWith(PREFIX)) return null
  if (key.includes("..")) return null
  return key
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isJordan())) return new NextResponse("Not found", { status: 404 })
    const key = safeKey(req.nextUrl.searchParams.get("key"))
    if (!key) return new NextResponse("Not found", { status: 404 })

    // ⚠ A missing key makes r2.send THROW NoSuchKey rather than return an empty
    // body — same trap the catalogue proxy documents. The catch turns it into a
    // 404 instead of an HTML error page.
    const obj = await r2.send(new GetObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key }))
    const body = obj.Body as ReadableStream | null
    if (!body) return new NextResponse("Not found", { status: 404 })

    return new NextResponse(body, {
      headers: {
        "Content-Type": obj.ContentType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch {
    return new NextResponse("Not found", { status: 404 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await req.formData()
    const file = form.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

    const type = (file.type || "").toLowerCase()
    if (!ALLOWED.includes(type)) {
      return NextResponse.json({ error: "Upload a photo or a PDF." }, { status: 415 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is over 20MB." }, { status: 413 })
    }

    const ext  = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase()
    // Random suffix so two uploads in the same millisecond can't collide, and so
    // a key can't be guessed from the outside.
    const key  = `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`
    await uploadBufferToR2(Buffer.from(await file.arrayBuffer()), key, type)

    return NextResponse.json({ key, name: file.name, type })
  } catch (e: any) {
    console.error("jordan/cars/file POST:", e)
    return NextResponse.json({ error: e?.message ?? "Upload failed" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { key } = await req.json()
    const safe = safeKey(String(key ?? ""))
    if (!safe) return NextResponse.json({ error: "Not found" }, { status: 404 })
    // ⚠ The sandbox environment shares this bucket with production, so a delete
    // here removes the real file. That is fine for these — they belong to one
    // person and nothing else references them — but do not copy this pattern
    // anywhere that shares objects with the catalogue.
    await deleteObjectsFromR2([safe])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cars/file DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
