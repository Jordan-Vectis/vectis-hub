import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/app-reload — the current force-refresh token. Polled by every signed-in
// tab; a change means an admin has pushed a reload.
//
// ⚠ `ok` distinguishes "no refresh pending" (ok:true, token:null) from "couldn't
// tell" (ok:false). They MUST NOT be conflated: the client reloads when the token
// CHANGES, so reporting a failure as token:null would look like a change to every
// tab holding a real token and reload the whole company's iPads on one database
// blip. A missing table (code deploys before Run Migrations) is also ok:false —
// nothing pending, nobody reloads.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ ok: false })

    const row = await prisma.appReload.findUnique({
      where: { id: "current" },
      select: { token: true },
    })
    return NextResponse.json({ ok: true, token: row?.token || null })
  } catch (e: any) {
    console.error("app-reload GET error:", e)
    return NextResponse.json({ ok: false })
  }
}
