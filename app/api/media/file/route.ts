import { NextRequest, NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { auth } from "@/auth"
import { objectExistsInR2, r2 } from "@/lib/r2"
import { isVideoKey, needsJpegCopy, videoCopyKey } from "@/lib/media"
import { ensureJpegCopy } from "@/lib/media-convert"

export const maxDuration = 300

// Where a Submission's files live: customers' uploads through the photo request link, and staff uploads.
const ALLOWED = ["submission-photos/", "submissions/"]

// GET /api/media/file?key=… — one of a Submission's files, streamed THROUGH the Hub for "Download
// all" (2026-09-15). It has to come from the Hub's own address: the page can't read R2's links
// itself, so it couldn't write them into the folder the user picked. A photo a PC can't open (iPhone
// HEIC, TIFF, camera RAW) comes as its JPEG copy — made first if need be — and a video as its playable
// copy when one was made; anything else exactly as it was sent. The name to save under is in
// X-File-Name. &original=1 for the file exactly as the customer sent it.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const key = req.nextUrl.searchParams.get("key") ?? ""
    if (!key || key.includes("..") || !ALLOWED.some(p => key.startsWith(p))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const original = req.nextUrl.searchParams.get("original") === "1"

    // The customer's own file name, without the "<timestamp>-" the upload put in front of it.
    let name = decodeURIComponent(key.split("/").pop() ?? "file").replace(/^\d+-/, "") || "file"
    let served = key
    if (!original && needsJpegCopy(key)) {
      served = await ensureJpegCopy(key)
      name = `${name.replace(/\.[^.]*$/, "")}.jpg`
    } else if (!original && isVideoKey(key) && await objectExistsInR2(videoCopyKey(key))) {
      served = videoCopyKey(key)
      name = `${name.replace(/\.[^.]*$/, "")}.mp4`
    }

    const obj = await r2.send(new GetObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: served }))
    if (!obj.Body) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const headers: Record<string, string> = {
      "Content-Type":           obj.ContentType || "application/octet-stream",
      "Content-Disposition":    `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-File-Name":            encodeURIComponent(name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control":          "private, no-store",
    }
    if (obj.ContentLength) headers["Content-Length"] = String(obj.ContentLength)
    return new NextResponse(obj.Body.transformToWebStream(), { headers })
  } catch (e: any) {
    const missing = e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404
    if (!missing) console.error("[media] file download failed:", e)
    return NextResponse.json({ error: missing ? "Not found" : (e?.message ?? "Couldn't fetch the file") }, { status: missing ? 404 : 500 })
  }
}
