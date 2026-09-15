import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getSignedImageUrl } from "@/lib/r2"
import { isVideoKey, videoCopyKey } from "@/lib/media"
import { ensureVideoCopy, isVideoBusy, videoState } from "@/lib/video-convert"

// GET /api/media/video?key=… → { url, state } — the version of a customer's video a browser can play
// (lib/video-convert.ts):
//   ready      — a converted copy exists, and url points at it
//   original   — the file plays as it is
//   converting — being checked or converted in the background right now; url is the original meanwhile
//   failed     — it couldn't be converted; url is the original, to download
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const key = req.nextUrl.searchParams.get("key")
    if (!key || !isVideoKey(key)) return NextResponse.json({ error: "Not a video" }, { status: 400 })

    const state = await videoState(key)
    if (state === "ready") return NextResponse.json({ url: await getSignedImageUrl(videoCopyKey(key)), state })
    // Never checked — a video sent before this existed, or one whose background check was cut off by a
    // restart. Start it now; nothing waits on it.
    if (state === "pending" && !isVideoBusy(key)) {
      void ensureVideoCopy(key).catch(err => console.error("[media] video check failed:", key, err))
    }
    return NextResponse.json({ url: await getSignedImageUrl(key), state: state === "pending" ? "converting" : state })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
