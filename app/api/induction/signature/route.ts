import { NextRequest, NextResponse } from "next/server"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

// GET /api/induction/signature?id=<signature id>
// The drawn signature for ONE record, fetched when someone opens it.
//
// ⚠ Why this exists at all: the Records tab used to receive every stored signature image with
// the page, on every visit, whichever tab was open. That is megabytes of other people's
// signatures sent to a tablet that is about to be handed to a stranger — and none of it was
// being looked at. The list now carries no images and asks for the one being viewed.
export async function GET(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true } })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "INDUCTION")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const id = req.nextUrl.searchParams.get("id") ?? ""
    if (!id) return NextResponse.json({ error: "No record given" }, { status: 400 })

    const row = await prisma.inductionSignature.findUnique({ where: { id }, select: { signature: true } })
    if (!row) return NextResponse.json({ error: "That record no longer exists" }, { status: 404 })

    return NextResponse.json({ signature: row.signature })
  } catch (e: any) {
    console.error("induction/signature error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
