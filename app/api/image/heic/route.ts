import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getSignedImageUrl } from "@/lib/r2"
import { ensureJpegCopy, isHeicKey } from "@/lib/heic"

export const maxDuration = 300

// GET /api/image/heic?key=… — an iPhone HEIC photo as a JPEG the browser can show. Converts it the
// first time (lib/heic.ts, a few seconds, one at a time) and then redirects to a signed link to the
// kept JPEG copy. Made for <img src>: a page of forty photos simply asks forty times, and each
// picture appears as soon as its own conversion is done.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const key = req.nextUrl.searchParams.get("key")
    if (!key || !isHeicKey(key)) return NextResponse.json({ error: "Not a HEIC photo" }, { status: 400 })

    const url = await getSignedImageUrl(await ensureJpegCopy(key))
    // The signed link lasts an hour, so the browser may reuse this answer for most of it.
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=3000" } })
  } catch (e: any) {
    console.error("[heic] conversion failed:", e)
    return NextResponse.json({ error: e?.message ?? "Couldn't convert this photo" }, { status: 500 })
  }
}
