"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCustomersUser } from "@/lib/customers/access"
import { NOTE_KINDS, NOTE_MAX, looksLikeBankDetails, type NoteKind } from "@/lib/customers/filters"

// Customers → Notes & calls. Anyone with the CUSTOMERS app may add; a note is deleted by whoever
// wrote it or an admin. Every action RETURNS its outcome (a thrown error is redacted in production).

export type NoteResult = { ok: boolean; error?: string; notReady?: boolean }

function isMissingTable(e: any) {
  return e?.code === "P2021" || e?.code === "42P01" || /does not exist/i.test(String(e?.message ?? ""))
}
const notReady: NoteResult = { ok: false, notReady: true, error: "Notes need Run Migrations before they can be saved." }

export async function addCustomerNote(customerId: string, input: { kind: string; text: string; followUpAt?: string | null }): Promise<NoteResult> {
  try {
    const me = await getCustomersUser()
    if (!me) return { ok: false, error: "You don't have access to Customers." }
    const kind = NOTE_KINDS.some(k => k.key === input.kind) ? (input.kind as NoteKind) : "note"
    const text = (input.text ?? "").replace(/\r\n/g, "\n").trim()
    if (!text) return { ok: false, error: "Type something first." }
    if (text.length > NOTE_MAX) return { ok: false, error: `Keep a note under ${NOTE_MAX.toLocaleString()} characters.` }
    if (looksLikeBankDetails(text)) return { ok: false, error: "That looks like bank or card details — they are never stored in the Hub." }
    let followUpAt: Date | null = null
    if (input.followUpAt) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.followUpAt)
      if (!m) return { ok: false, error: "The follow-up date isn't a date." }
      followUpAt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) // noon UTC, so it reads as that London day all year
    }
    const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })
    if (!exists) return { ok: false, error: "That customer isn't here any more." }
    await prisma.customerNote.create({ data: { customerId, kind, text, followUpAt, byId: me.id, byName: me.name } })
    revalidatePath(`/tools/customers/${customerId}`)
    revalidatePath("/tools/customers")
    return { ok: true }
  } catch (e: any) {
    if (isMissingTable(e)) return notReady
    console.error("addCustomerNote error:", e)
    return { ok: false, error: e?.message ?? "Unknown error" }
  }
}

export async function setFollowUpDone(noteId: string, done: boolean): Promise<NoteResult> {
  try {
    const me = await getCustomersUser()
    if (!me) return { ok: false, error: "You don't have access to Customers." }
    const n = await prisma.customerNote.update({ where: { id: noteId }, data: { followUpDone: done }, select: { customerId: true } })
    revalidatePath(`/tools/customers/${n.customerId}`)
    revalidatePath("/tools/customers")
    return { ok: true }
  } catch (e: any) {
    if (isMissingTable(e)) return notReady
    console.error("setFollowUpDone error:", e)
    return { ok: false, error: e?.message ?? "Unknown error" }
  }
}

export async function deleteCustomerNote(noteId: string): Promise<NoteResult> {
  try {
    const me = await getCustomersUser()
    if (!me) return { ok: false, error: "You don't have access to Customers." }
    const n = await prisma.customerNote.findUnique({ where: { id: noteId }, select: { customerId: true, byId: true } })
    if (!n) return { ok: true }
    if (!me.isAdmin && n.byId !== me.id) return { ok: false, error: "Only the person who wrote it, or an admin, can delete a note." }
    await prisma.customerNote.delete({ where: { id: noteId } })
    revalidatePath(`/tools/customers/${n.customerId}`)
    revalidatePath("/tools/customers")
    return { ok: true }
  } catch (e: any) {
    if (isMissingTable(e)) return notReady
    console.error("deleteCustomerNote error:", e)
    return { ok: false, error: e?.message ?? "Unknown error" }
  }
}
