import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { photoPrepUser } from "@/lib/image-chat"

// GET /api/photo-prep/chats — the signed-in person's OWN saved Image chats, newest first.
export async function GET() {
  try {
    const me = await photoPrepUser()
    if ("error" in me) return NextResponse.json({ error: me.error }, { status: me.status })
    const chats = await prisma.imageChat.findMany({
      where:   { userId: me.id },
      orderBy: { updatedAt: "desc" },
      select:  { id: true, title: true, updatedAt: true },
      take:    200,
    })
    return NextResponse.json({ chats })
  } catch (e: any) {
    console.error("photo-prep/chats GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Couldn't load your chats" }, { status: 500 })
  }
}
