import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { prisma } from "@/lib/prisma"
import { randomBytes } from "node:crypto"

// A screen recording is far too big for a server request body (20 MB limit,
// and the proxy silently truncates past it — see next.config.ts), so the
// browser uploads STRAIGHT to R2 on a presigned PUT, exactly as Documents do.
// Nothing is written to the database here; the row is created by
// POST /api/it-tools/recordings only once the upload has succeeded.
// ⚠ 2,000,000,000 and not 2 GiB: sizeBytes is a Postgres INTEGER (max 2,147,483,647) and
// 2 * 1024³ is 2,147,483,648 — one byte over. A file that passed the cap would then fail
// the row insert AFTER a successful upload. At the 2.5 Mbit/s we record at that is about
// 1¾ hours of screen — plenty for a test, and the whole thing has to sit in browser memory.
const MAX_SIZE = 2_000_000_000

// Only the two containers a browser's MediaRecorder can actually produce.
const ALLOWED: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm" }

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { contentType, size } = await req.json()
    // MediaRecorder reports its type with codecs appended ("video/webm;codecs=vp9");
    // the container is the part before the semicolon.
    const container = String(contentType ?? "").split(";")[0].trim().toLowerCase()
    const ext = ALLOWED[container]
    if (!ext) return NextResponse.json({ error: "Only MP4 or WebM recordings can be saved" }, { status: 400 })
    if (typeof size !== "number" || !(size > 0)) return NextResponse.json({ error: "Missing size" }, { status: 400 })
    if (size > MAX_SIZE) return NextResponse.json({ error: "Recording too large (max 2 GB)" }, { status: 400 })

    // ⚠ Touch the table BEFORE signing. If Run Migrations hasn't been clicked yet, or the
    // database is down, this is where it should fail — at the free step, before the
    // browser spends minutes pushing a file that the save step could never register.
    await prisma.screenRecording.findFirst({ select: { id: true } })

    // Keyed by time so the bucket lists in order; random tail so two people
    // stopping in the same second can't collide. ⚠ Fixed width: the save route
    // checks the EXACT shape, and Math.random().toString(36) can come up short
    // (0.5 → "i"), which would reject a key only after the whole file had uploaded.
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-")
    const key = `recordings/${stamp}-${randomBytes(3).toString("hex")}.${ext}`

    const url = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
        Key: key,
        ContentType: contentType,   // the browser must PUT with this exact header
      }),
      { expiresIn: 3600 },
    )

    return NextResponse.json({ url, key })
  } catch (e: any) {
    console.error("it-tools/recordings/upload-url POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
