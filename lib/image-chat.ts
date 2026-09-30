// Photo Prep → 💬 Image chat — saved conversations (2026-09-29, Jordan: "Can we save chats?",
// and chose "only the person" over one shared list).
//
// ⚠ PRIVATE. Every read, write and picture fetch checks ImageChat.userId against the signed-in
// person — never just "has Photo Prep". A chat id in a URL must not open someone else's chat.
// ⚠ Pictures live in R2 under image-chat/<chatId>/ and are served THROUGH the Hub
// (/api/photo-prep/chats/<id>/image?k=…), same-origin like IT Tools → Screenshots, so Download can
// fetch() the bytes without the bucket needing a CORS rule.
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"

/** One step of a conversation as stored. Pictures are R2 KEYS here, never URLs or base64. */
export type StoredTurn =
  | { who: "you"; text: string; attach: string[]; at: string }
  | { who: "ai"; image?: string; text?: string; error?: string; at: string }

/** The same step as the browser gets it — keys turned into Hub URLs. */
export type ShownTurn =
  | { who: "you"; text: string; thumbs: string[] }
  | { who: "ai"; image?: string; text?: string; error?: string }

export const keyPrefix = (chatId: string) => `image-chat/${chatId}/`

export function showTurns(chatId: string, turns: StoredTurn[]): ShownTurn[] {
  const url = (k: string) => `/api/photo-prep/chats/${chatId}/image?k=${encodeURIComponent(k)}`
  return turns.map(t => t.who === "you"
    ? { who: "you", text: t.text, thumbs: (t.attach ?? []).map(url) }
    : { who: "ai", image: t.image ? url(t.image) : undefined, text: t.text, error: t.error })
}

/** The signed-in person, if they may use Photo Prep. `null` = send 401/403. */
export async function photoPrepUser(): Promise<{ id: string } | { error: string; status: number }> {
  const session = await auth()
  if (!session) return { error: "Unauthorised", status: 401 }
  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { id: true, role: true, allowedApps: true },
  })
  if (!dbUser || !hasAppAccess(dbUser.role ?? "", dbUser.allowedApps ?? [], "PHOTO_PREP")) {
    return { error: "Forbidden", status: 403 }
  }
  return { id: dbUser.id }
}

/** The chat, only if it belongs to this person. */
export async function ownChat(chatId: string, userId: string) {
  const chat = await prisma.imageChat.findUnique({ where: { id: chatId } })
  return chat && chat.userId === userId ? chat : null
}
