import { NextRequest, NextResponse } from "next/server"
import bwipjs from "bwip-js"
import { auth } from "@/auth"

// QR code for the Saleroom Trainer bidder link, so a trainee can point a phone
// at the clerking screen instead of typing a URL.
//
// Not a general-purpose QR encoder: the only thing it will encode is this app's
// own bidder URL for a given room code, built here rather than taken from the
// caller. Logged-in only, like the trainer page that renders it.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CODE_RE = /^[A-Z0-9]{3,8}$/

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase()
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: "Invalid room code" }, { status: 400 })
    }

    // Railway terminates TLS in front of the app, so nextUrl on its own can come
    // through as http://localhost:3000 — a QR built from that would send phones
    // nowhere. Take the forwarded host/proto when the proxy supplies them.
    const first = (v: string | null) => (v ? v.split(",")[0]!.trim() : "")
    const host =
      first(req.headers.get("x-forwarded-host")) ||
      first(req.headers.get("host")) ||
      req.nextUrl.host
    const proto =
      first(req.headers.get("x-forwarded-proto")) ||
      req.nextUrl.protocol.replace(":", "")

    const target = `${proto}://${host}/saleroom-trainer-bid.html?room=${code}`

    const png = await bwipjs.toBuffer({
      bcid:            "qrcode",
      text:            target,
      scale:           5,
      eclevel:         "M",
      backgroundcolor: "FFFFFF",
      padding:         2,
    })

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        // Codes are short-lived and single-use; don't let a proxy hand back a
        // previous session's QR.
        "Cache-Control": "no-store",
      },
    })
  } catch (e: unknown) {
    console.error("trainer/qr error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    )
  }
}
