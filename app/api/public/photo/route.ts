import { NextRequest, NextResponse } from "next/server"
import { r2 } from "@/lib/r2"
import { GetObjectCommand } from "@aws-sdk/client-s3"

// Public (no auth) proxy for lot photos — only serves lot-photos/ keys
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? ""

  // Prefix allowlist — this route is public, so it must only ever serve buckets meant to be
  // world-readable. first-aid/ holds the first aider and kit photos shown on /first-aid.
  const allowed = ["lot-photos/", "catalogue-photos/", "first-aid/"]
  // ".." can't escape an S3/R2 key (they are literal, not paths), but the prefix check runs on
  // the raw string, so refuse it rather than rely on that staying true.
  if (!key || key.includes("..") || !allowed.some(p => key.startsWith(p))) {
    return new NextResponse("Not found", { status: 404 })
  }

  try {
    const obj = await r2.send(new GetObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: key,
    }))

    const body = obj.Body as ReadableStream | null
    if (!body) return new NextResponse("Not found", { status: 404 })

    // ⚠ The stored ContentType comes from whatever the UPLOADER's browser claimed, and this
    // route is public and same-origin as the Hub — so an SVG or HTML uploaded through a photo
    // field would otherwise execute here with the viewer's session. Serve only known-safe image
    // types, fall back to a non-executing one, and forbid sniffing.
    const claimed = (obj.ContentType ?? "").toLowerCase()
    const safeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/heic", "image/heif"]
    const contentType = safeTypes.includes(claimed) ? claimed : "application/octet-stream"

    return new NextResponse(body, {
      headers: {
        "Content-Type":           contentType,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control":          "public, max-age=86400",
      },
    })
  } catch {
    return new NextResponse("Not found", { status: 404 })
  }
}
