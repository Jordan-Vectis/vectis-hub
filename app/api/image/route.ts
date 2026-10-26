import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getSignedImageUrl } from "@/lib/r2"
import { REFUND_PHOTO_PREFIX } from "@/lib/refunds"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const key = req.nextUrl.searchParams.get("key")
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 })
  // ⚠ Refund photos (customers' damage photos) are admins-only: only /api/refunds/photo signs them.
  if (key.trim().toLowerCase().startsWith(REFUND_PHOTO_PREFIX)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const url = await getSignedImageUrl(key)
  return NextResponse.json({ url })
}
