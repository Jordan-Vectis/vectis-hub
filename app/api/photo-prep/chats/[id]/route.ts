import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { deleteObjectsFromR2 } from "@/lib/r2"
import { photoPrepUser, ownChat, showTurns, type StoredTurn } from "@/lib/image-chat"

// GET /api/photo-prep/chats/[id] — one of YOUR saved chats, pictures as Hub URLs.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await photoPrepUser()
    if ("error" in me) return NextResponse.json({ error: me.error }, { status: me.status })
    const { id } = await params
    const chat = await ownChat(id, me.id)
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    return NextResponse.json({ id: chat.id, title: chat.title, turns: showTurns(chat.id, (chat.turns as unknown as StoredTurn[]) ?? []) })
  } catch (e: any) {
    console.error("photo-prep/chats/[id] GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Couldn't open the chat" }, { status: 500 })
  }
}

// DELETE — the pictures first, then the row, so a failed R2 delete leaves the chat (and its
// pictures) listed rather than orphaned files nobody can see to clean up.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await photoPrepUser()
    if ("error" in me) return NextResponse.json({ error: me.error }, { status: me.status })
    const { id } = await params
    const chat = await ownChat(id, me.id)
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    const keys: string[] = []
    for (const t of (chat.turns as unknown as StoredTurn[]) ?? []) {
      if (t.who === "you") keys.push(...(t.attach ?? []))
      else if (t.image) keys.push(t.image)
    }
    if (keys.length) await deleteObjectsFromR2(keys)
    await prisma.imageChat.delete({ where: { id: chat.id } })
    return NextResponse.json({ ok: true, removedPictures: keys.length })
  } catch (e: any) {
    console.error("photo-prep/chats/[id] DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Couldn't delete the chat" }, { status: 500 })
  }
}
