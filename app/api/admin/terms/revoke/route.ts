import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { TERMS_VERSION } from "@/lib/terms"

// Admin: withdraw one person's signed acceptance so they have to sign the policy again.
//
// ⚠ DELETING THE LIVE ROW IS THE MECHANISM. The gate in app/(app)/layout.tsx re-prompts on the
// ABSENCE of a TermsAcceptance row for the current version, so nothing short of removing it will
// bring the signing popup back. Flagging it in place cannot work either: TermsAcceptance is
// unique on (userId, version), so their next signature would overwrite the same row.
//
// ⚠ Which is why it is COPIED to TermsRevocation first. A deleted signature with no copy destroys
// the only evidence that somebody ever accepted the policy — not something an admin button should
// be able to do by accident. The copy and the delete are one transaction: a copy without the
// delete leaves them signed and puzzled, a delete without the copy loses the record for good.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { userId, reason } = await req.json()
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }

    const existing = await prisma.termsAcceptance.findUnique({
      where: { userId_version: { userId, version: TERMS_VERSION } },
    })
    if (!existing) {
      return NextResponse.json({ error: "They have not signed the current policy" }, { status: 404 })
    }

    await prisma.$transaction([
      prisma.termsRevocation.create({
        data: {
          userId:      existing.userId,
          userName:    existing.userName,
          userEmail:   existing.userEmail,
          version:     existing.version,
          signature:   existing.signature,
          acceptedAt:  existing.acceptedAt,
          revokedById: session.user.id,
          // The admin's name as it is NOW — a renamed or deleted account still reads properly
          // years later, which a bare id does not.
          revokedBy:   session.user.name ?? "",
          reason:      typeof reason === "string" ? reason.trim().slice(0, 500) : "",
        },
      }),
      prisma.termsAcceptance.delete({ where: { id: existing.id } }),
    ])

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    console.error("admin/terms/revoke error:", e)
    // The table only exists once Run Migrations has been pressed on this environment. Say that,
    // rather than handing back a raw Postgres "relation does not exist".
    const missing = /TermsRevocation/i.test(msg)
    return NextResponse.json({
      error: missing
        ? "The withdrawn-signatures table doesn't exist yet — press Run Migrations on the Admin page, then try again."
        : msg,
    }, { status: 500 })
  }
}
