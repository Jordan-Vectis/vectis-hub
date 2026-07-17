"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

// Admin CRUD for patch notes. Every action RETURNS its error rather than throwing —
// a thrown server action is redacted to a generic message in a production build, so
// the admin would see gibberish instead of the reason (see RULES.md).
type Result = { ok: boolean; error?: string }

const MAX_TITLE = 120
const MAX_BODY = 5000

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") return null
  return session
}

// Saving NEVER sends anything to anyone — it deliberately doesn't touch `published`.
// Writing and pushing are separate steps: you save a draft, reread it, then press Push
// when you're ready. Editing a note that's already live also stays quiet, so fixing a
// typo can't re-interrupt the whole company.
export async function savePatchNote(input: {
  id?: string
  title: string
  body: string
}): Promise<Result> {
  try {
    const session = await requireAdmin()
    if (!session) return { ok: false, error: "Unauthorised" }

    const title = (input.title ?? "").trim().slice(0, MAX_TITLE)
    const body = (input.body ?? "").trim().slice(0, MAX_BODY)
    if (!title && !body) return { ok: false, error: "Give the note a title or some content first." }

    if (input.id) {
      await prisma.patchNote.update({
        where: { id: input.id },
        data: { title, body },
      })
    } else {
      await prisma.patchNote.create({
        data: {
          title,
          body,
          published: false, // new notes always start as a draft — you push them explicitly
          createdByName: session.user.name ?? session.user.email ?? "Admin",
        },
      })
    }

    revalidatePath("/admin/announcements")
    return { ok: true }
  } catch (e: any) {
    console.error("savePatchNote error:", e)
    return { ok: false, error: e?.message ?? "Could not save the patch note." }
  }
}

// The Push button: send this note out to everyone, now.
//
// Publishing and clearing the seen rows are ONE action on purpose — "push" means the
// same thing whether it's a first send (nobody has seen it, so the clear is a no-op)
// or a re-send after a correction (people who read the old version get the new one).
// Two subtly different buttons would only invite pushing the wrong one.
export async function pushPatchNote(id: string): Promise<Result> {
  try {
    const session = await requireAdmin()
    if (!session) return { ok: false, error: "Unauthorised" }

    const note = await prisma.patchNote.findUnique({ where: { id }, select: { title: true, body: true } })
    if (!note) return { ok: false, error: "That patch note no longer exists — reload the page." }
    // An empty note would pop a blank box up in front of every member of staff.
    if (!note.title.trim() && !note.body.trim()) {
      return { ok: false, error: "There's nothing in this note to show. Add a title or some content first." }
    }

    await prisma.$transaction([
      prisma.patchNote.update({ where: { id }, data: { published: true } }),
      prisma.patchNoteSeen.deleteMany({ where: { patchNoteId: id } }),
    ])

    revalidatePath("/admin/announcements")
    return { ok: true }
  } catch (e: any) {
    console.error("pushPatchNote error:", e)
    return { ok: false, error: e?.message ?? "Could not push the patch note." }
  }
}

// Pull a note back — stops it appearing for anyone who hasn't already read it.
// Leaves the seen rows alone, so re-pushing later won't re-show it to people who
// already read it unless you press Push (which clears them).
export async function unpublishPatchNote(id: string): Promise<Result> {
  try {
    const session = await requireAdmin()
    if (!session) return { ok: false, error: "Unauthorised" }

    await prisma.patchNote.update({ where: { id }, data: { published: false } })
    revalidatePath("/admin/announcements")
    return { ok: true }
  } catch (e: any) {
    console.error("unpublishPatchNote error:", e)
    return { ok: false, error: e?.message ?? "Could not stop showing the patch note." }
  }
}

export async function deletePatchNote(id: string): Promise<Result> {
  try {
    const session = await requireAdmin()
    if (!session) return { ok: false, error: "Unauthorised" }

    // PatchNoteSeen rows cascade with the note.
    await prisma.patchNote.delete({ where: { id } })
    revalidatePath("/admin/announcements")
    return { ok: true }
  } catch (e: any) {
    console.error("deletePatchNote error:", e)
    return { ok: false, error: e?.message ?? "Could not delete the patch note." }
  }
}

