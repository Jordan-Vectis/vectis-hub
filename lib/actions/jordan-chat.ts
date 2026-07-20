"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"

// Saved chats for the secret /jordan chat panel. All jordan-only. `mode` keeps
// Ask AI and the Cooking chef in separate lists. Jordan saves explicitly — the
// live conversation still lives in localStorage as before, so nothing here is
// automatic.

async function ownerId(): Promise<string> {
  const session = await auth()
  if (!session || !(await isJordan())) throw new Error("Unauthorised")
  return session.user.id
}

// Only what's worth keeping: image data URLs are stripped (a count survives), so
// a long photo chat can't bloat the row.
export type SavedMsg = { role: "user" | "model"; text: string; queries?: string[]; imgs?: number }

const cleanMode = (m: unknown) => (String(m ?? "") === "cooking" ? "cooking" : "chat")

function cleanMessages(messages: unknown): SavedMsg[] {
  if (!Array.isArray(messages)) return []
  return messages.slice(-200).map((m) => {
    const o = (m ?? {}) as { role?: unknown; text?: unknown; queries?: unknown; images?: unknown; imgs?: unknown }
    const imgs = Array.isArray(o.images) ? o.images.length : (Number(o.imgs) || undefined)
    return {
      role: o.role === "model" ? "model" as const : "user" as const,
      text: typeof o.text === "string" ? o.text.slice(0, 20000) : "",
      ...(Array.isArray(o.queries) ? { queries: o.queries.filter((q): q is string => typeof q === "string").slice(0, 10) } : {}),
      ...(imgs ? { imgs } : {}),
    }
  })
}

// Title defaults to the first thing Jordan asked — the most recognisable label.
function autoTitle(messages: SavedMsg[]): string {
  const first = messages.find((m) => m.role === "user" && m.text.trim())?.text.trim() ?? ""
  const line = first.split("\n")[0].slice(0, 70)
  return line || "Untitled chat"
}

export async function saveChat(mode: string, messages: unknown, title?: string) {
  const owner = await ownerId()
  const msgs = cleanMessages(messages)
  if (!msgs.length) return { ok: false as const, error: "Nothing to save yet." }
  const row = await prisma.jordanSavedChat.create({
    data: {
      ownerId: owner,
      mode: cleanMode(mode),
      title: (title ?? "").trim().slice(0, 120) || autoTitle(msgs),
      messages: msgs,
    },
    select: { id: true, title: true },
  })
  return { ok: true as const, id: row.id, title: row.title }
}

export async function listSavedChats(mode: string) {
  const owner = await ownerId()
  const rows = await prisma.jordanSavedChat.findMany({
    where: { ownerId: owner, mode: cleanMode(mode) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
    take: 100,
  })
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }))
}

export async function getSavedChat(id: string) {
  const owner = await ownerId()
  const row = await prisma.jordanSavedChat.findFirst({ where: { id, ownerId: owner }, select: { messages: true, title: true } })
  if (!row) return { ok: false as const, error: "Not found" }
  return { ok: true as const, title: row.title, messages: cleanMessages(row.messages) }
}

export async function renameSavedChat(id: string, title: string) {
  const owner = await ownerId()
  const name = title.trim().slice(0, 120)
  if (!name) return { ok: false as const, error: "Name required" }
  await prisma.jordanSavedChat.updateMany({ where: { id, ownerId: owner }, data: { title: name } })
  return { ok: true as const }
}

export async function deleteSavedChat(id: string) {
  const owner = await ownerId()
  await prisma.jordanSavedChat.deleteMany({ where: { id, ownerId: owner } })
  return { ok: true as const }
}
