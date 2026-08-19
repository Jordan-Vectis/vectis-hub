import { NextRequest, NextResponse } from "next/server"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { r2 } from "@/lib/r2"

export const maxDuration = 60

// /api/jordan/docs/file — the bytes.
//
// POST  → a presigned PUT URL so the browser uploads STRAIGHT to R2. Documents
//         can be large and a serverless request body cannot, which is why the
//         shared Admin → Documents page works this way too.
// PUT   → record the finished upload against a folder.
// GET   → stream one file back.
//
// ⚠ Gated by isJordan() AND locked to the jordan/docs/ prefix, so this can never
// become a reader for the rest of the bucket. Do NOT use /api/catalogue/photo-proxy
// for these — it serves any key to any logged-in session.
const PREFIX = "jordan/docs/"

function safeKey(key: string | null | undefined): string | null {
  const k = String(key ?? "")
  if (!k.startsWith(PREFIX) || k.includes("..")) return null
  return k
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { filename, contentType } = await req.json()
    const name = String(filename ?? "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120)
    // Random segment so two uploads in the same millisecond can't collide and a
    // key can't be guessed from outside.
    const key  = `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${name}`

    const url = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: key,
      ContentType: String(contentType || "application/octet-stream"),
    }), { expiresIn: 900 })

    return NextResponse.json({ url, key })
  } catch (e: any) {
    console.error("jordan/docs/file POST:", e)
    return NextResponse.json({ error: e?.message ?? "Couldn't start the upload" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { key, name, size, mimeType, folderId } = await req.json()
    const safe = safeKey(key)
    if (!safe) return NextResponse.json({ error: "Bad key" }, { status: 400 })

    const file = await prisma.jordanDocFile.create({
      data: {
        key: safe,
        name: String(name ?? "Untitled").slice(0, 200),
        size: Number(size) || 0,
        mimeType: String(mimeType ?? "").slice(0, 120),
        folderId: folderId ? String(folderId) : null,
      },
    })
    return NextResponse.json({ id: file.id })
  } catch (e: any) {
    if (/does not exist|P2021|P2022/i.test(String(e?.message ?? e))) {
      return NextResponse.json({ error: "Run Migrations first — the document tables aren't there yet." }, { status: 503 })
    }
    console.error("jordan/docs/file PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isJordan())) return new NextResponse("Not found", { status: 404 })
    const key = safeKey(req.nextUrl.searchParams.get("key"))
    if (!key) return new NextResponse("Not found", { status: 404 })
    const download = req.nextUrl.searchParams.get("download") === "1"
    const name = (req.nextUrl.searchParams.get("name") ?? "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120)

    // ⚠ A key that is not in the bucket makes r2.send THROW NoSuchKey rather than
    // return an empty body — the catch is what turns that into a 404 instead of
    // an HTML error page.
    const obj  = await r2.send(new GetObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key }))
    const body = obj.Body as ReadableStream | null
    if (!body) return new NextResponse("Not found", { status: 404 })

    return new NextResponse(body, {
      headers: {
        "Content-Type": obj.ContentType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        ...(download ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
      },
    })
  } catch {
    return new NextResponse("Not found", { status: 404 })
  }
}
