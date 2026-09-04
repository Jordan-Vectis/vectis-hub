import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { r2 } from "@/lib/r2"
import { HeadObjectCommand } from "@aws-sdk/client-s3"

// GET /api/it-tools/recordings — every recording, newest first.
// IT Tools is open to everyone signed in, and so is this list.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const rows = await prisma.screenRecording.findMany({ orderBy: { createdAt: "desc" }, take: 500 })
    return NextResponse.json(rows)
  } catch (e: any) {
    console.error("it-tools/recordings GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// Exactly the shape upload-url mints — never a prefix check, so nothing outside
// recordings/ can be registered, and nothing inside it that we didn't sign.
const KEY_RE = /^recordings\/\d{8}-\d{6}-[a-z0-9]{6}\.(mp4|webm)$/

// POST /api/it-tools/recordings — record a finished upload.
// ⚠ Called only AFTER the browser's PUT to R2 has returned 200. It checks the
// object really is there before writing the row, and it is IDEMPOTENT on key:
// a retry after a timed-out-but-committed save returns the existing row rather
// than making a second one for the same file.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const key = typeof body?.key === "string" ? body.key : ""
    const contentType = typeof body?.contentType === "string" ? body.contentType.split(";")[0].trim() : ""
    const sizeBytes = Number(body?.sizeBytes)
    const durationMs = Number(body?.durationMs)
    const title = String(body?.title ?? "").trim().slice(0, 120)

    if (!KEY_RE.test(key)) return NextResponse.json({ error: "Bad key" }, { status: 400 })
    if (contentType !== "video/mp4" && contentType !== "video/webm") return NextResponse.json({ error: "Bad content type" }, { status: 400 })
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 2_147_483_647) return NextResponse.json({ error: "Bad size" }, { status: 400 })
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 2_147_483_647) return NextResponse.json({ error: "Bad duration" }, { status: 400 })

    const existing = await prisma.screenRecording.findFirst({ where: { key } })
    if (existing) return NextResponse.json(existing)

    // Is the file actually there? Only a definite "no" is a definite no. Any
    // other failure (R2 5xx, a network blip) must NOT be reported as "nothing was
    // saved" — the file very likely IS there, and the caller keeps its key to
    // try registering again. R2 is strongly consistent, so a 200 PUT is visible
    // to this HEAD immediately; there is no eventual-consistency window to wait out.
    try {
      await r2.send(new HeadObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key }))
    } catch (e: any) {
      const status = e?.$metadata?.httpStatusCode
      if (e?.name === "NotFound" || e?.name === "NoSuchKey" || status === 404) {
        return NextResponse.json({ error: "The upload didn't reach storage — nothing was saved. Try again." }, { status: 409 })
      }
      console.error("it-tools/recordings POST: couldn't confirm object", key, e)
      return NextResponse.json({ error: "Couldn't confirm the upload reached storage — it may well be there. Try saving again in a moment." }, { status: 503 })
    }

    const row = await prisma.screenRecording.create({
      data: {
        title: title || `Recording ${new Date().toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" })}`,
        key, contentType, sizeBytes: Math.round(sizeBytes), durationMs: Math.round(durationMs),
        recordedBy: session.user?.email ?? "unknown",
        recordedByName: session.user?.name ?? session.user?.email ?? "unknown",
      },
    })
    return NextResponse.json(row)
  } catch (e: any) {
    console.error("it-tools/recordings POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
