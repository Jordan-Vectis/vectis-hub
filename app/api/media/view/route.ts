import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getSignedImageUrl } from "@/lib/r2"
import { needsJpegCopy } from "@/lib/media"
import { ensureJpegCopy } from "@/lib/media-convert"

export const maxDuration = 300

// GET /api/media/view?key=… — an image a browser can't show by itself (iPhone HEIC, scanner TIFF,
// camera RAW) as a JPEG. Makes the copy the first time (lib/media-convert.ts — a few seconds, one at a
// time), then redirects to a signed link to it. Made for <img src>: a page of forty photos simply asks
// forty times, and each picture appears as soon as its own copy is ready.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const key = req.nextUrl.searchParams.get("key")
    if (!key || !needsJpegCopy(key)) return NextResponse.json({ error: "Not an image that needs converting" }, { status: 400 })

    const url = await getSignedImageUrl(await ensureJpegCopy(key))
    // The signed link lasts an hour, so the browser may reuse this answer for most of it.
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=3000" } })
  } catch (e: any) {
    console.error("[media] image conversion failed:", e)
    return NextResponse.json({ error: e?.message ?? "Couldn't convert this image" }, { status: 500 })
  }
}
