import { prisma } from "@/lib/prisma"

// Server-only reads of the patch notes. Imported by the admin page (server component)
// and the read API — never by client components.

export type AdminPatchNote = {
  id: string
  title: string
  body: string
  published: boolean
  createdAt: Date
  createdByName: string | null
  seenCount: number
}

// Three outcomes, not two: the notes, or WHY they couldn't be read. Telling a
// "run migrations" story for what is actually a dead database sends the admin to
// a button that won't help and hides the real fault.
export type PatchNotesResult =
  | { status: "ok"; notes: AdminPatchNote[] }
  | { status: "no-table" }
  | { status: "error"; message: string }

// Prisma P2021 = table does not exist; 42P01 is the underlying Postgres code, which
// can surface through the pg adapter instead. Same precedent as the message-matching
// in app/api/bc/cataloguing/route.ts.
function isMissingTable(e: any): boolean {
  if (e?.code === "P2021" || e?.code === "42P01") return true
  return /does not exist|relation .* does not exist/i.test(e?.message ?? "")
}

// Every note, newest first, for the admin list.
export async function readAllPatchNotes(): Promise<PatchNotesResult> {
  try {
    const notes = await prisma.patchNote.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { seenBy: true } } },
    })
    return {
      status: "ok",
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        published: n.published,
        createdAt: n.createdAt,
        createdByName: n.createdByName,
        seenCount: n._count.seenBy,
      })),
    }
  } catch (e: any) {
    // Code deploys to Railway before Run Migrations is clicked, so a missing table is
    // an expected state and must render a hint rather than a 500. Anything else is a
    // real fault and says so.
    if (isMissingTable(e)) {
      console.error("readAllPatchNotes: PatchNote table does not exist yet:", e?.message)
      return { status: "no-table" }
    }
    console.error("readAllPatchNotes error:", e)
    return { status: "error", message: e?.message ?? "Could not load patch notes." }
  }
}

// Published notes this user hasn't clicked through, oldest first so they read in the
// order the changes shipped. Empty array on any failure — a broken patch note must
// never block the app for everyone.
export async function readUnseenPatchNotes(userId: string) {
  try {
    return await prisma.patchNote.findMany({
      where: { published: true, seenBy: { none: { userId } } },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, body: true, createdAt: true },
    })
  } catch (e) {
    console.error("readUnseenPatchNotes error (table may not exist yet):", e)
    return []
  }
}
