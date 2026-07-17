import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// Marks patch notes as seen by the signed-in user, so the popup stops showing them.
// The user id comes from the session, never the body — nobody can mark a note seen
// on someone else's behalf.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((i: unknown) => typeof i === "string") : []
    if (!ids.length) return NextResponse.json({ ok: true })

    // Drop ids whose note has since been deleted. createMany is atomic, so a single
    // stale id would fail the whole batch on the foreign key and leave the user's
    // OTHER notes unmarked — they'd then get the popup again on every load.
    // skipDuplicates only covers the unique index, not the FK.
    const live = await prisma.patchNote.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    })
    if (!live.length) return NextResponse.json({ ok: true })

    // skipDuplicates: two tabs (or a double-tap) can post the same ids at once, and
    // racing the unique [patchNoteId, userId] index shouldn't 500 the popup.
    await prisma.patchNoteSeen.createMany({
      data: live.map((n) => ({ patchNoteId: n.id, userId: session.user.id })),
      skipDuplicates: true,
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("patch-notes seen POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
