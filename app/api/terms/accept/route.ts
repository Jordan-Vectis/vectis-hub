import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { TERMS_VERSION } from "@/lib/terms"

// Save a user's signed acceptance of the current policy version. One row per
// (user, version) — re-submitting just updates it.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { signature } = await req.json()
    if (typeof signature !== "string" || !signature.startsWith("data:image/png;base64,")) {
      return NextResponse.json({ error: "A signature is required" }, { status: 400 })
    }
    // Reject an empty/degenerate image (defence-in-depth — the client already requires
    // a drawn stroke). A real signature PNG is several KB; a 1x1/empty one is tiny.
    if (signature.length < 800) {
      return NextResponse.json({ error: "Please draw your signature before submitting" }, { status: 400 })
    }
    if (signature.length > 2_000_000) {
      return NextResponse.json({ error: "Signature too large" }, { status: 400 })
    }

    const userId = session.user.id
    const userName = session.user.name ?? ""
    const userEmail = session.user.email ?? ""

    await prisma.termsAcceptance.upsert({
      where:  { userId_version: { userId, version: TERMS_VERSION } },
      update: { signature, userName, userEmail, acceptedAt: new Date() },
      create: { userId, version: TERMS_VERSION, signature, userName, userEmail },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("terms/accept error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
