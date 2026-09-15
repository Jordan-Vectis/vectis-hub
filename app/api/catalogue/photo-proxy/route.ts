import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isCronRequest } from "@/lib/cron-auth"
import { r2 } from "@/lib/r2"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { needsJpegCopy } from "@/lib/media"
import { ensureJpegCopy } from "@/lib/media-convert"

// Streams a lot photo out of R2 behind the login.
//
// ⚠ Wrapped in try/catch per RULES.md. A key that is not in the bucket makes r2.send THROW
// NoSuchKey — it does not return an empty body — so without this an archived lot whose photo has
// since been deleted produced an HTML error page instead of a 404. That also made the `if (!body)`
// check below unreachable, which is why it looked handled and was not.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session && !isCronRequest(req)) return new NextResponse("Unauthorized", { status: 401 })

    const key = req.nextUrl.searchParams.get("key")
    if (!key) return new NextResponse("Missing key", { status: 400 })

    // iPhone HEIC, scanner TIFF and camera RAW (an Induction slide image, say): a person's browser gets
    // the JPEG copy, as most browsers can't show the original (lib/media-convert.ts). ⚠ Background jobs
    // (no session) still get the ORIGINAL — the AI reads HEIC itself, and an overnight run must never
    // queue behind conversions.
    let servedKey = key
    if (session && needsJpegCopy(key)) {
      try { servedKey = await ensureJpegCopy(key) } catch { /* can't convert — send the original, as before */ }
    }
    const obj = await r2.send(new GetObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: servedKey,
    }))

    const body = obj.Body as ReadableStream | null
    if (!body) return new NextResponse("Not found", { status: 404 })

    return new NextResponse(body, {
      headers: {
        "Content-Type":  obj.ContentType ?? "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (e: any) {
    const missing = e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404
    if (!missing) console.error("catalogue/photo-proxy error:", e)
    return new NextResponse(missing ? "Not found" : "Could not load the photo", {
      status: missing ? 404 : 500,
    })
  }
}
