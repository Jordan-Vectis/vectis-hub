import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { gapRelayKey } from "@/lib/gap-relay-key"

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const key = gapRelayKey()
    if (!key) return NextResponse.json({ error: "AUTH_SECRET isn't set on the server" }, { status: 500 })
    return NextResponse.json({ key })
  } catch (e: any) {
    console.error("gap-relay key error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
