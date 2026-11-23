import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { deleteObjectsFromR2 } from "@/lib/r2"
import { requireCollections, missingTable, logEvent, describeChanges, str, day, pence, HOTEL_FIELDS } from "@/lib/collection-bookings"

// /api/collection-bookings/hotels — the hotel stays on a collection booking.
// POST   { bookingId, …fields } → add a stay
// PUT    { id, …fields }        → amend it (only the fields sent; each change is logged on the booking)
// DELETE { id }                 → remove it and its confirmation files
const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })

function hotelData(b: any) {
  const data: Record<string, any> = {}
  const put = (k: string, v: any) => { if (v !== undefined) data[k] = v }
  put("name", str(b.name, 160)); put("address", str(b.address, 1000)); put("phone", str(b.phone, 60))
  put("checkIn", day(b.checkIn)); put("checkOut", day(b.checkOut))
  put("rooms", str(b.rooms, 120)); put("guests", str(b.guests, 300))
  put("confirmationNo", str(b.confirmationNo, 80)); put("bookedVia", str(b.bookedVia, 120))
  put("costPence", pence(b.cost)); put("payment", str(b.payment, 200)); put("notes", str(b.notes, 4000))
  return data
}
const checkDates = (inD: Date | null | undefined, outD: Date | null | undefined) =>
  inD && outD && outD <= inD ? "Check-out has to be after check-in — check the dates." : null
const label = (name: string | null | undefined) => (name ? `the ${name} stay` : "a hotel stay")

export async function POST(req: NextRequest) {
  try {
    const who = await requireCollections()
    const b = await req.json()
    if (!b.bookingId) return NextResponse.json({ error: "Missing bookingId" }, { status: 400 })
    const booking = await prisma.collectionBooking.findUnique({ where: { id: String(b.bookingId) }, select: { id: true } })
    if (!booking) return NextResponse.json({ error: "That booking isn't there — it may have been deleted." }, { status: 404 })
    const data = hotelData(b)
    const bad = checkDates(data.checkIn, data.checkOut)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const hotel = await prisma.collectionHotel.create({ data: { ...data, bookingId: booking.id }, select: { id: true } })
    // Adding a hotel means it's an overnight — tick it so the "still needs a hotel" check reads right.
    await prisma.collectionBooking.update({ where: { id: booking.id }, data: { needsHotel: true }, select: { id: true } })
    await logEvent(booking.id, who, "hotel", `Added ${label(data.name)}${data.confirmationNo ? ` — confirmation ${data.confirmationNo}` : ""}`)
    return NextResponse.json({ id: hotel.id })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "A database update is waiting — press Run Migrations on the Admin page." }, { status: 503 })
    if (!e?.http) console.error("collection-bookings/hotels POST:", e)
    return err(e)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const who = await requireCollections()
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const before = await prisma.collectionHotel.findUnique({ where: { id: String(b.id) } })
    if (!before) return NextResponse.json({ error: "That hotel stay isn't there — it may have been removed." }, { status: 404 })
    const data = hotelData(b)
    if (!Object.keys(data).length) return NextResponse.json({ ok: true })
    const bad = checkDates(data.checkIn !== undefined ? data.checkIn : before.checkIn, data.checkOut !== undefined ? data.checkOut : before.checkOut)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    await prisma.collectionHotel.update({ where: { id: before.id }, data, select: { id: true } })
    const text = describeChanges(before, data, HOTEL_FIELDS)
    const name = data.name ?? before.name
    if (text) await logEvent(before.bookingId, who, "hotel", `${name ? `The ${name} stay` : "A hotel stay"}: ${text}`)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("collection-bookings/hotels PUT:", e)
    return err(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const who = await requireCollections()
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const hotel = await prisma.collectionHotel.findUnique({ where: { id: String(id) } })
    if (!hotel) return NextResponse.json({ ok: true })
    await prisma.collectionHotel.delete({ where: { id: hotel.id } })
    if (hotel.fileKeys.length) await deleteObjectsFromR2(hotel.fileKeys).catch(e => console.warn("collection-bookings/hotels DELETE: files not removed", e?.message))
    await logEvent(hotel.bookingId, who, "hotel", `Removed ${label(hotel.name)}${hotel.confirmationNo ? ` (confirmation ${hotel.confirmationNo})` : ""}`)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("collection-bookings/hotels DELETE:", e)
    return err(e)
  }
}
