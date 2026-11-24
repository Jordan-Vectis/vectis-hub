import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { prisma } from "@/lib/prisma"
import { getObjectBuffer } from "@/lib/r2"
import { buildCollectionBookingPdf } from "@/lib/collection-booking-pdf"
import {
  requireCollections, ref, milesBetween, NEARBY_MILES, OPEN_COLLECTION_STATUSES, COLLECTION_STATUS_LABEL, type CollectionStatus,
} from "@/lib/collection-bookings"

export const maxDuration = 60

// GET /api/collection-bookings/pdf?id=… — the booking as a printable A4 sheet with the Vectis header:
// everything on it, every hotel stay, the open collections nearby, the notes, and the photos of the
// collection (up to MAX_PHOTOS, made small enough to print). COLLECTION_BOOKINGS app, checked fresh.
// Opens in the browser's own PDF viewer to print or save.
const MAX_PHOTOS = 12
const label = (s: string) => COLLECTION_STATUS_LABEL[s as CollectionStatus] ?? s

export async function GET(req: NextRequest) {
  try {
    const who = await requireCollections()
    const id = req.nextUrl.searchParams.get("id") ?? ""
    const b = await prisma.collectionBooking.findUnique({
      where: { id },
      include: {
        hotels: { orderBy: [{ checkIn: "asc" }, { createdAt: "asc" }] },
        events: { where: { kind: "note" }, orderBy: { at: "desc" }, take: 30 },
      },
    })
    if (!b) return NextResponse.json({ error: "That booking isn't there — it may have been deleted." }, { status: 404 })

    let van = ""
    if (b.vanId) {
      const v = await prisma.van.findUnique({ where: { id: b.vanId }, select: { name: true, reg: true } }).catch(() => null)
      van = v ? (v.reg ? `${v.name} (${v.reg})` : v.name) : "A van no longer on Facilities > Vans"
    }

    // The open collections nearby, nearest first — same rule as the page.
    let nearby: { miles: number; ref: string; vendorName: string; place: string; date: Date | null; status: string }[] = []
    if (b.lat != null && b.lng != null) {
      const others = await prisma.collectionBooking.findMany({
        where: { id: { not: b.id }, status: { in: OPEN_COLLECTION_STATUSES }, lat: { not: null }, lng: { not: null } },
        select: { ref: true, vendorName: true, postcode: true, area: true, collectFrom: true, status: true, lat: true, lng: true },
      })
      nearby = others
        .map(o => ({ o, miles: milesBetween({ lat: b.lat!, lng: b.lng! }, { lat: o.lat!, lng: o.lng! }) }))
        .filter(x => x.miles <= NEARBY_MILES)
        .sort((x, y) => x.miles - y.miles)
        .map(({ o, miles }) => ({ miles, ref: ref(o.ref), vendorName: o.vendorName, place: [o.area, o.postcode].filter(Boolean).join(", "), date: o.collectFrom, status: label(o.status) }))
    }

    // Photos, made print-sized JPEGs. One that can't be read is counted, never fatal.
    const imageKeys = b.photoKeys.filter(k => !k.toLowerCase().endsWith(".pdf"))
    const photos: Buffer[] = []
    let photosMissing = Math.max(0, imageKeys.length - MAX_PHOTOS)
    const made = await Promise.all(imageKeys.slice(0, MAX_PHOTOS).map(async k => {
      try {
        return await sharp(await getObjectBuffer(k)).rotate().resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
      } catch (e: any) { console.warn("collection-bookings/pdf: photo not added", k, e?.message); return null }
    }))
    for (const m of made) { if (m) photos.push(m); else photosMissing++ }

    const bytes = await buildCollectionBookingPdf({
      ref: ref(b.ref),
      statusLabel: label(b.status),
      ownerName: b.ownerName,
      vendorName: b.vendorName, vendorNo: b.vendorNo, phone: b.phone, email: b.email,
      address: b.address, postcode: b.postcode, area: b.area,
      collectFrom: b.collectFrom, collectTo: b.collectTo, timeWindow: b.timeWindow,
      description: b.description, size: b.size, requirements: b.requirements,
      drivers: b.drivers, van, needsHotel: b.needsHotel,
      hotels: b.hotels.map(h => ({
        name: h.name, address: h.address, phone: h.phone, checkIn: h.checkIn, checkOut: h.checkOut, rooms: h.rooms,
        guests: h.guests, confirmationNo: h.confirmationNo, bookedVia: h.bookedVia, costPence: h.costPence,
        payment: h.payment, notes: h.notes, files: h.fileKeys.length,
      })),
      nearby, nearbyMiles: NEARBY_MILES,
      notes: b.events.reverse().map(e => ({ at: e.at, byName: e.byName, text: e.text })),
      photos, photosMissing, pdfs: b.photoKeys.length - imageKeys.length,
      printedBy: who.name,
    })

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Collection ${ref(b.ref)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e: any) {
    if (!e?.http) console.error("collection-bookings/pdf:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })
  }
}
