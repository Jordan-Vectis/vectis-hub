import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { deleteObjectsFromR2 } from "@/lib/r2"
import {
  requireCollections, missingTable, logEvent, describeChanges, ref, str, day, names, geoFor,
  BOOKING_FIELDS, COLLECTION_STATUSES, COLLECTION_STATUS_LABEL, type CollectionStatus,
} from "@/lib/collection-bookings"

// /api/collection-bookings — Admin & Operations → Collection bookings. COLLECTION_BOOKINGS app,
// checked fresh on every call.
// GET                    → every booking (with its hotels), the vans, and names to suggest as drivers
// GET ?id=…              → one booking with its hotels and full history
// POST { vendorName, … } → a new booking (status NEW, nobody has it yet)
// PUT  { id, …fields }   → amend: only the fields sent are touched, and each change is logged
// PUT  { id, action: "pickup" | "release" }   → take it on / put it back for someone else
// PUT  { id, action: "status", status }       → move it on (Booked, Collected, Cancelled, or back)
// DELETE { id }          → admins only: the booking, its hotels, history and files

const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })
const WAITING = "A database update is waiting — the collection bookings tables aren't there yet. An admin presses Run Migrations on the Admin page."
const CLOSED: CollectionStatus[] = ["COLLECTED", "CANCELLED"]

/** The booking fields the page can amend, read off the request. undefined = not sent. */
function bookingData(b: any) {
  const data: Record<string, any> = {}
  const put = (k: string, v: any) => { if (v !== undefined) data[k] = v }
  put("vendorName", str(b.vendorName, 120)); put("vendorNo", str(b.vendorNo, 30))
  put("phone", str(b.phone, 60)); put("email", str(b.email, 160))
  put("address", str(b.address, 1000)); put("postcode", str(b.postcode, 12)?.toUpperCase())
  put("collectFrom", day(b.collectFrom)); put("collectTo", day(b.collectTo))
  put("timeWindow", str(b.timeWindow, 120))
  put("description", str(b.description, 6000)); put("size", str(b.size, 200))
  put("requirements", str(b.requirements, 6000))
  put("drivers", names(b.drivers))
  if (b.vanId !== undefined) data.vanId = String(b.vanId ?? "").trim() || null
  if (b.needsHotel !== undefined) data.needsHotel = !!b.needsHotel
  return data
}

async function vanNames(): Promise<Map<string, string>> {
  try {
    const vans = await prisma.van.findMany({ select: { id: true, name: true, reg: true } })
    return new Map(vans.map(v => [v.id, v.reg ? `${v.name} (${v.reg})` : v.name]))
  } catch { return new Map() }
}

export async function GET(req: NextRequest) {
  try {
    const who = await requireCollections()
    const id = req.nextUrl.searchParams.get("id")
    if (id) {
      const booking = await prisma.collectionBooking.findUnique({
        where: { id },
        include: { hotels: { orderBy: [{ checkIn: "asc" }, { createdAt: "asc" }] }, events: { orderBy: { at: "desc" }, take: 500 } },
      })
      if (!booking) return NextResponse.json({ error: "That booking isn't there — it may have been deleted." }, { status: 404 })
      return NextResponse.json({ booking })
    }

    const bookings = await prisma.collectionBooking.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
      include: { hotels: { orderBy: [{ checkIn: "asc" }, { createdAt: "asc" }] }, _count: { select: { events: true } } },
    })

    // Postcodes whose location couldn't be looked up when they were saved (postcodes.io down, say):
    // a few more tries per load. Written straight to the row so "last changed" isn't touched.
    const pending = bookings.filter(b => b.postcode && b.geoPostcode !== b.postcode.trim().toUpperCase()).slice(0, 10)
    await Promise.all(pending.map(async b => {
      const g = await geoFor(b.postcode)
      if (!g.geoPostcode) return // still can't reach postcodes.io — next time
      await prisma.$executeRaw`UPDATE "CollectionBooking" SET "lat" = ${g.lat}, "lng" = ${g.lng}, "area" = ${g.area}, "geoPostcode" = ${g.geoPostcode} WHERE "id" = ${b.id}`
      Object.assign(b, g)
    }))

    // The vans (Facilities → Vans) and names to suggest for drivers: the Hub's staff, anyone who has
    // signed a van out, and anyone who has driven a collection before. Typing any other name is fine.
    let vans: { id: string; name: string; reg: string; active: boolean }[] = []
    let vanDrivers: string[] = []
    try {
      vans = await prisma.van.findMany({ orderBy: [{ active: "desc" }, { position: "asc" }], select: { id: true, name: true, reg: true, active: true } })
      vanDrivers = (await prisma.vanTrip.findMany({ distinct: ["driverName"], select: { driverName: true }, take: 300 })).map(t => t.driverName)
    } catch { /* the vans tables aren't there yet — no suggestions from them */ }
    const staff = (await prisma.user.findMany({ select: { name: true } })).map(u => u.name)
    const seen = new Map<string, string>()
    for (const n of [...bookings.flatMap(b => b.drivers), ...vanDrivers, ...staff]) {
      const t = (n ?? "").trim()
      if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
    }
    const driverNames = [...seen.values()].sort((a, b) => a.localeCompare(b))

    return NextResponse.json({ bookings, vans, driverNames, me: { userId: who.userId, name: who.name, isAdmin: who.isAdmin } })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ bookings: [], vans: [], driverNames: [], needsMigration: true })
    if (!e?.http) console.error("collection-bookings GET:", e)
    return err(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const who = await requireCollections()
    const b = await req.json()
    const data = bookingData(b)
    if (!data.vendorName && !data.address && !data.postcode) {
      return NextResponse.json({ error: "Give it at least the vendor's name or where the collection is." }, { status: 400 })
    }
    if (data.collectFrom && data.collectTo && data.collectTo < data.collectFrom) {
      return NextResponse.json({ error: "The last day is before the collection date — check the dates." }, { status: 400 })
    }
    if (data.postcode) Object.assign(data, await geoFor(data.postcode))
    const booking = await prisma.collectionBooking.create({
      data: { ...data, status: "NEW", createdById: who.userId, createdByName: who.name },
      select: { id: true, ref: true },
    })
    await logEvent(booking.id, who, "created", `Booking ${ref(booking.ref)} made`)
    return NextResponse.json({ id: booking.id, ref: booking.ref })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: WAITING }, { status: 503 })
    if (!e?.http) console.error("collection-bookings POST:", e)
    return err(e)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const who = await requireCollections()
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const before = await prisma.collectionBooking.findUnique({ where: { id: String(b.id) } })
    if (!before) return NextResponse.json({ error: "That booking isn't there — it may have been deleted." }, { status: 404 })

    // ── Pick it up / put it back ──
    if (b.action === "pickup") {
      if (before.ownerId === who.userId) return NextResponse.json({ ok: true })
      await prisma.collectionBooking.update({
        where: { id: before.id },
        data: { ownerId: who.userId, ownerName: who.name, pickedUpAt: new Date(), ...(before.status === "NEW" ? { status: "IN_HAND" } : {}) },
        select: { id: true },
      })
      await logEvent(before.id, who, "pickup", before.ownerName ? `Took it over from ${before.ownerName}` : "Picked it up")
      return NextResponse.json({ ok: true })
    }
    if (b.action === "release") {
      if (!before.ownerId) return NextResponse.json({ ok: true })
      await prisma.collectionBooking.update({
        where: { id: before.id },
        data: { ownerId: null, ownerName: null, pickedUpAt: null, ...(before.status === "IN_HAND" ? { status: "NEW" } : {}) },
        select: { id: true },
      })
      await logEvent(before.id, who, "pickup", before.ownerId === who.userId
        ? "Put it back — nobody has it now"
        : `Put it back from ${before.ownerName ?? "someone"} — nobody has it now`)
      return NextResponse.json({ ok: true })
    }

    // ── Move it on ──
    if (b.action === "status") {
      const status = String(b.status ?? "") as CollectionStatus
      if (!COLLECTION_STATUSES.includes(status)) return NextResponse.json({ error: "Not a booking status" }, { status: 400 })
      if (status === before.status) return NextResponse.json({ ok: true })
      const data: Record<string, any> = { status, closedAt: CLOSED.includes(status) ? new Date() : null }
      // Booking it or working on it with nobody's name on it puts yours on it, so it's never anonymous.
      if (!before.ownerId && (status === "IN_HAND" || status === "BOOKED")) {
        Object.assign(data, { ownerId: who.userId, ownerName: who.name, pickedUpAt: new Date() })
      }
      // Back to New means nobody has it.
      if (status === "NEW") Object.assign(data, { ownerId: null, ownerName: null, pickedUpAt: null })
      await prisma.collectionBooking.update({ where: { id: before.id }, data, select: { id: true } })
      const from = COLLECTION_STATUS_LABEL[before.status as CollectionStatus] ?? before.status
      await logEvent(before.id, who, "status", `${from} → ${COLLECTION_STATUS_LABEL[status]}${b.reason ? ` — ${str(b.reason, 500)}` : ""}`)
      return NextResponse.json({ ok: true })
    }

    // ── Amend ──
    const data = bookingData(b)
    if (!Object.keys(data).length) return NextResponse.json({ ok: true })
    const from = data.collectFrom !== undefined ? data.collectFrom : before.collectFrom
    const to   = data.collectTo   !== undefined ? data.collectTo   : before.collectTo
    if (from && to && to < from) return NextResponse.json({ error: "The last day is before the collection date — check the dates." }, { status: 400 })
    if (data.vanId) {
      const van = await prisma.van.findUnique({ where: { id: data.vanId }, select: { id: true } }).catch(() => null)
      if (!van) return NextResponse.json({ error: "That van isn't on Facilities → Vans any more — pick another." }, { status: 400 })
    }

    // A new postcode → where it is (only the postcode goes to postcodes.io). Not part of the change log.
    const geo = data.postcode !== undefined && data.postcode !== before.postcode ? await geoFor(data.postcode) : {}
    await prisma.collectionBooking.update({ where: { id: before.id }, data: { ...data, ...geo }, select: { id: true } })
    const vans = "vanId" in data ? await vanNames() : new Map<string, string>()
    const text = describeChanges(before, data, BOOKING_FIELDS, { vanId: (v: any) => (v ? vans.get(v) ?? "a van no longer listed" : "") })
    if (text) await logEvent(before.id, who, "change", text)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: WAITING }, { status: 503 })
    if (!e?.http) console.error("collection-bookings PUT:", e)
    return err(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const who = await requireCollections()
    if (!who.isAdmin) return NextResponse.json({ error: "Only an admin can delete a booking — mark it Cancelled instead, which keeps its history." }, { status: 403 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const booking = await prisma.collectionBooking.findUnique({
      where: { id: String(id) }, select: { id: true, photoKeys: true, hotels: { select: { fileKeys: true } } },
    })
    if (!booking) return NextResponse.json({ ok: true })
    // Files go with it, or they sit in the bucket for ever with nothing pointing at them.
    const keys = [...booking.photoKeys, ...booking.hotels.flatMap(h => h.fileKeys)].filter(Boolean)
    await prisma.collectionBooking.delete({ where: { id: booking.id } })
    if (keys.length) await deleteObjectsFromR2(keys).catch(e => console.warn("collection-bookings DELETE: files not removed", e?.message))
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("collection-bookings DELETE:", e)
    return err(e)
  }
}
