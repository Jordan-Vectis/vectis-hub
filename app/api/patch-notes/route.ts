import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { readUnseenPatchNotes } from "@/lib/patch-notes-db"

export const dynamic = "force-dynamic"

// Published patch notes the signed-in user hasn't clicked through yet, oldest first.
// Read by the popup in the app layout. Always 200 with a list — the popup is a nicety,
// so any failure returns an empty list rather than an error the client has to handle.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ notes: [] })

    const notes = await readUnseenPatchNotes(session.user.id)
    return NextResponse.json({
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
      })),
    })
  } catch (e: any) {
    console.error("patch-notes GET error:", e)
    return NextResponse.json({ notes: [] })
  }
}
