import { NextRequest, NextResponse } from "next/server"
import { getObjectBuffer } from "@/lib/r2"
import { photoPrepUser, ownChat, keyPrefix } from "@/lib/image-chat"

// GET /api/photo-prep/chats/[id]/image?k=<key>[&download=1] — one picture from YOUR chat, streamed
// through the Hub (same-origin, so Download can fetch() it with no CORS rule on the bucket).
// ⚠ The key must sit under THIS chat's folder, and the chat must be yours — a key from someone
// else's chat, or anywhere else in the bucket, is refused.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await photoPrepUser()
    if ("error" in me) return NextResponse.json({ error: me.error }, { status: me.status })
    const { id } = await params
    const key = new URL(req.url).searchParams.get("k") ?? ""
    if (!key.startsWith(keyPrefix(id)) || key.includes("..")) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const chat = await ownChat(id, me.id)
    if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const buf = await getObjectBuffer(key)
    const type = key.endsWith(".jpg") ? "image/jpeg" : "image/png"
    const download = new URL(req.url).searchParams.get("download")
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": type,
        "Content-Length": String(buf.length),
        "Content-Disposition": download ? `attachment; filename="vectis-image.${type === "image/jpeg" ? "jpg" : "png"}"` : "inline",
        "Cache-Control": "private, max-age=86400",
      },
    })
  } catch (e: any) {
    console.error("photo-prep/chats/[id]/image error:", e)
    return NextResponse.json({ error: e?.message ?? "Couldn't load the picture" }, { status: 500 })
  }
}
