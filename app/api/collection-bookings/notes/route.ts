import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCollections, logEvent } from "@/lib/collection-bookings"

// /api/collection-bookings/notes — POST { bookingId, text } → a note on the booking's history, with
// who and when. Notes are a record, so they aren't edited or deleted afterwards; add another instead.
const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })

export async function POST(req: NextRequest) {
  try {
    const who = await requireCollections()
    const b = await req.json()
    const text = String(b.text ?? "").trim()
    if (!b.bookingId) return NextResponse.json({ error: "Missing bookingId" }, { status: 400 })
    if (!text) return NextResponse.json({ error: "Write the note first." }, { status: 400 })
    if (text.length > 4000) return NextResponse.json({ error: "That note is over 4,000 characters — split it in two." }, { status: 400 })
    const booking = await prisma.collectionBooking.findUnique({ where: { id: String(b.bookingId) }, select: { id: true } })
    if (!booking) return NextResponse.json({ error: "That booking isn't there — it may have been deleted." }, { status: 404 })
    await logEvent(booking.id, who, "note", text)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("collection-bookings/notes POST:", e)
    return err(e)
  }
}
