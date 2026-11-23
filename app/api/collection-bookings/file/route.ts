import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { uploadBufferToR2, deleteObjectsFromR2, getSignedImageUrl } from "@/lib/r2"
import { normaliseImageUpload } from "@/lib/media-convert"
import { requireCollections, logEvent, COLLECTION_FILE_PREFIX, COLLECTION_FILE_RE } from "@/lib/collection-bookings"

export const maxDuration = 60

// /api/collection-bookings/file — photos of a collection, and hotel booking confirmations.
// POST   form { file, bookingId, hotelId? } → stored in R2 and put straight on the booking (or that hotel stay)
// GET    ?key=…                             → a 15-minute signed link to it (redirect)
// DELETE { key }                            → taken off the booking and removed from R2
//
// ⚠ The ONLY way these files are served. They hold vendors' items at their home addresses and staff
// hotel bookings, so they need the COLLECTION_BOOKINGS app, not just a login: the general photo routes
// (/api/catalogue/photo-proxy, /api/catalogue/signed-url, /api/image) refuse this prefix.
const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }
const MAX_PHOTOS = 60
const MAX_HOTEL_FILES = 10
const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })

export async function GET(req: NextRequest) {
  try {
    await requireCollections()
    const key = req.nextUrl.searchParams.get("key") ?? ""
    if (!COLLECTION_FILE_RE.test(key)) return NextResponse.json({ error: "That isn't a collection booking file." }, { status: 400 })
    const res = NextResponse.redirect(await getSignedImageUrl(key, 900), 302)
    // The signed link is personal to this moment — never cached or passed on.
    res.headers.set("Cache-Control", "private, no-store")
    res.headers.set("Referrer-Policy", "no-referrer")
    return res
  } catch (e: any) {
    if (!e?.http) console.error("collection-bookings/file GET:", e)
    return err(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const who = await requireCollections()
    const form = await req.formData()
    const file = form.get("file") as File | null
    const bookingId = String(form.get("bookingId") ?? "")
    const hotelId = String(form.get("hotelId") ?? "")
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })
    if (!bookingId) return NextResponse.json({ error: "Missing bookingId" }, { status: 400 })
    const rawType = (file.type || "").toLowerCase()
    if (!ALLOWED.includes(rawType)) return NextResponse.json({ error: "Upload a photo (JPEG, PNG, WebP or iPhone HEIC) or a PDF." }, { status: 415 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is over 20MB." }, { status: 413 })

    const booking = await prisma.collectionBooking.findUnique({
      where: { id: bookingId }, select: { id: true, photoKeys: true, hotels: { select: { id: true, name: true, fileKeys: true } } },
    })
    if (!booking) return NextResponse.json({ error: "That booking isn't there — it may have been deleted." }, { status: 404 })
    const hotel = hotelId ? booking.hotels.find(h => h.id === hotelId) : null
    if (hotelId && !hotel) return NextResponse.json({ error: "That hotel stay isn't on this booking any more." }, { status: 404 })
    if (!hotel && booking.photoKeys.length >= MAX_PHOTOS) return NextResponse.json({ error: `This booking already has ${MAX_PHOTOS} photos — remove some first.` }, { status: 400 })
    if (hotel && hotel.fileKeys.length >= MAX_HOTEL_FILES) return NextResponse.json({ error: `That stay already has ${MAX_HOTEL_FILES} files — remove one first.` }, { status: 400 })

    // An iPhone photo (HEIC) is stored as a JPEG, so every browser can show it.
    const { buf, type } = await normaliseImageUpload(Buffer.from(await file.arrayBuffer()), file.name || "photo", rawType)
    const ext = EXT[type]
    if (!ext) return NextResponse.json({ error: "That photo couldn't be read — try saving it as a JPEG." }, { status: 415 })
    const key = `${COLLECTION_FILE_PREFIX}${booking.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}.${ext}`
    await uploadBufferToR2(buf, key, type)

    if (hotel) {
      await prisma.collectionHotel.update({ where: { id: hotel.id }, data: { fileKeys: { push: key } }, select: { id: true } })
      await logEvent(booking.id, who, "file", `Added a confirmation file to ${hotel.name ? `the ${hotel.name} stay` : "a hotel stay"}`)
    } else {
      await prisma.collectionBooking.update({ where: { id: booking.id }, data: { photoKeys: { push: key } }, select: { id: true } })
      await logEvent(booking.id, who, "photo", type === "application/pdf" ? "Added a PDF" : "Added a photo")
    }
    return NextResponse.json({ key })
  } catch (e: any) {
    if (!e?.http) console.error("collection-bookings/file POST:", e)
    return err(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const who = await requireCollections()
    const { key } = await req.json()
    const k = String(key ?? "")
    if (!COLLECTION_FILE_RE.test(k)) return NextResponse.json({ error: "That isn't a collection booking file." }, { status: 400 })
    const bookingId = k.split("/")[1]
    const booking = await prisma.collectionBooking.findUnique({
      where: { id: bookingId }, select: { id: true, photoKeys: true, hotels: { select: { id: true, name: true, fileKeys: true } } },
    })
    if (!booking) return NextResponse.json({ error: "That booking isn't there — it may have been deleted." }, { status: 404 })

    const hotel = booking.hotels.find(h => h.fileKeys.includes(k))
    if (hotel) {
      await prisma.collectionHotel.update({ where: { id: hotel.id }, data: { fileKeys: hotel.fileKeys.filter(x => x !== k) }, select: { id: true } })
      await logEvent(booking.id, who, "file", `Removed a confirmation file from ${hotel.name ? `the ${hotel.name} stay` : "a hotel stay"}`)
    } else if (booking.photoKeys.includes(k)) {
      await prisma.collectionBooking.update({ where: { id: booking.id }, data: { photoKeys: booking.photoKeys.filter(x => x !== k) }, select: { id: true } })
      await logEvent(booking.id, who, "photo", k.endsWith(".pdf") ? "Removed a PDF" : "Removed a photo")
    } else {
      return NextResponse.json({ error: "That file isn't on the booking any more." }, { status: 404 })
    }
    await deleteObjectsFromR2([k]).catch(e => console.warn("collection-bookings/file DELETE: not removed from R2", e?.message))
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("collection-bookings/file DELETE:", e)
    return err(e)
  }
}
