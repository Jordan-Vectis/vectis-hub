import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"

// Admin & Operations → Collection bookings (2026-11-23). A trip out to collect a vendor's items:
// where and when, what's being collected (with photos), special requirements, the driver(s) and van,
// and the hotel when it's an overnight. Admin staff pick a booking up, amend it and leave notes, and
// every change is written to CollectionBookingEvent with its before and after.

// The statuses, their labels, the file prefix and the CB-0001 reference live in the shared file,
// which the page reads too.
export * from "@/lib/collection-bookings-shared"

export const COLLECTIONS_NO_ACCESS = "You don't have Collection bookings — ask an admin to give it to you in Users & Permissions."

export type CollectionsUser = { userId: string; name: string; isAdmin: boolean }

/** Who is asking, checked fresh from the database (a login token can be hours old), and whether they
 *  hold the COLLECTION_BOOKINGS app. Admins always do. */
export async function requireCollections(): Promise<CollectionsUser> {
  const session = await getEffectiveSession()
  if (!session) throw Object.assign(new Error("Not signed in"), { http: 401 })
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { allowedApps: true, role: true, name: true, email: true },
  })
  if (!hasAppAccess(u?.role ?? "", u?.allowedApps ?? [], "COLLECTION_BOOKINGS")) {
    throw Object.assign(new Error(COLLECTIONS_NO_ACCESS), { http: 403 })
  }
  return { userId: session.user.id, name: u?.name || u?.email || "Unknown", isAdmin: u?.role === "ADMIN" }
}

export function missingTable(e: any): boolean {
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(String(e?.message ?? e))
}

// ── Reading what the page sends ──────────────────────────────────────────────
// undefined = not sent (leave it alone); "" = cleared.
export const str = (v: any, max = 200): string | undefined => (v === undefined ? undefined : String(v ?? "").trim().slice(0, max))
/** "" → null so a cleared date really clears; never "today". Stored as midnight UTC of that day. */
export const day = (v: any): Date | null | undefined => {
  if (v === undefined) return undefined
  const s = String(v ?? "").trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return isNaN(d.getTime()) ? null : d
}
/** "£1,234.56" → 123456 pence, so costs add up exactly. */
export const pence = (v: any): number | null | undefined => {
  if (v === undefined) return undefined
  const s = String(v ?? "").replace(/[^\d.]/g, "")
  if (!s) return null
  const n = Math.round(parseFloat(s) * 100)
  return isNaN(n) ? null : n
}
/** A list of names: trimmed, no blanks, no repeats (ignoring case), at most 6. */
export const names = (v: any): string[] | undefined => {
  if (v === undefined) return undefined
  const list = Array.isArray(v) ? v : String(v ?? "").split(",")
  const out: string[] = []
  for (const x of list) {
    const n = String(x ?? "").trim().slice(0, 80)
    if (n && !out.some(o => o.toLowerCase() === n.toLowerCase())) out.push(n)
  }
  return out.slice(0, 6)
}

// ── Where a postcode is (postcodes.io) ───────────────────────────────────────
// For the miles between bookings ("nearby" on the page). postcodes.io is the free postcode service
// from Ideal Postcodes (who already do the Hub's address lookup), on ONS / Ordnance Survey open data.
// ⚠ ONLY THE POSTCODE IS SENT — never the vendor's name, address or anything else — and only from the
// server. No key. A lookup that fails never stops a booking saving; it's tried again on a later load.

const POSTCODES_IO = "https://api.postcodes.io"
type Geo = { lat: number; lng: number; area: string | null }

async function askPostcodesIo(path: string): Promise<any | null> {
  const r = await fetch(`${POSTCODES_IO}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000), cache: "no-store" })
  if (r.status === 404) return null // not a postcode it knows
  if (!r.ok) throw new Error(`postcodes.io answered ${r.status}`)
  return (await r.json())?.result ?? null
}

/** The full postcode first; if postcodes.io doesn't know it (new, retired or mistyped), its district
 *  (LS1 of LS1 1AA) — close enough for "nearby". null = neither is known. Throws = couldn't ask. */
export async function locatePostcode(postcode: string): Promise<Geo | null> {
  const pc = postcode.replace(/\s+/g, "").toUpperCase()
  if (!/^[A-Z]{1,2}\d[A-Z\d]?(\d[A-Z]{2})?$/.test(pc)) return null // not shaped like a UK postcode
  if (pc.length > 4) {
    const full = await askPostcodesIo(`/postcodes/${encodeURIComponent(pc)}`)
    if (full?.latitude != null && full?.longitude != null) return { lat: full.latitude, lng: full.longitude, area: full.admin_district ?? null }
  }
  const outward = pc.length > 4 ? pc.slice(0, -3) : pc
  const district = await askPostcodesIo(`/outcodes/${encodeURIComponent(outward)}`)
  if (district?.latitude != null && district?.longitude != null) {
    const area = Array.isArray(district.admin_district) ? district.admin_district[0] : district.admin_district
    return { lat: district.latitude, lng: district.longitude, area: area ?? null }
  }
  return null
}

/** The location fields to save with a postcode. If postcodes.io can't be reached, they're cleared with
 *  geoPostcode left empty, so the next load of the page tries again. */
export async function geoFor(postcode: string): Promise<{ lat: number | null; lng: number | null; area: string | null; geoPostcode: string | null }> {
  const pc = postcode.trim().toUpperCase()
  if (!pc) return { lat: null, lng: null, area: null, geoPostcode: null }
  try {
    const g = await locatePostcode(pc)
    return { lat: g?.lat ?? null, lng: g?.lng ?? null, area: g?.area ?? null, geoPostcode: pc }
  } catch (e: any) {
    console.warn("collection-bookings: postcode lookup failed, will retry:", e?.message)
    return { lat: null, lng: null, area: null, geoPostcode: null }
  }
}

// ── The change log ───────────────────────────────────────────────────────────
// How each field is named and shown in "Changed …" lines on the booking's history.

const ukDay = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "")
const money = (p: number | null) => (p == null ? "" : `£${(p / 100).toFixed(2)}`)
const shown = (v: any): string => {
  if (v == null) return ""
  if (v instanceof Date) return ukDay(v)
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return v ? "yes" : "no"
  return String(v)
}
const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}…` : s)

export const BOOKING_FIELDS: Record<string, string> = {
  vendorName: "Vendor", vendorNo: "Vendor number", phone: "Phone", email: "Email",
  address: "Address", postcode: "Postcode",
  collectFrom: "Collection date", collectTo: "Last day", timeWindow: "Time",
  description: "What's being collected", size: "How much", requirements: "Special requirements",
  drivers: "Drivers", vanId: "Van", needsHotel: "Needs a hotel",
}

export const HOTEL_FIELDS: Record<string, string> = {
  name: "Hotel", address: "Hotel address", phone: "Hotel phone",
  checkIn: "Check-in", checkOut: "Check-out", rooms: "Rooms", guests: "Who's staying",
  confirmationNo: "Confirmation number", bookedVia: "Booked through", costPence: "Cost",
  payment: "Payment", notes: "Hotel notes",
}

/** "Collection date: Tue 2 Dec 2025 → Wed 3 Dec 2025; Drivers: — → Dan, Sam". Empty when nothing changed.
 *  `fmt` turns a stored value into words for a field that needs it (the van's name, a cost). */
export function describeChanges(
  before: Record<string, any>, after: Record<string, any>, labels: Record<string, string>,
  fmt: Record<string, (v: any) => string> = {},
): string {
  const parts: string[] = []
  for (const k of Object.keys(after)) {
    if (!(k in labels)) continue
    const f = fmt[k] ?? (k === "costPence" ? (v: any) => money(v) : shown)
    const a = f(before[k]), b = f(after[k])
    if (a === b) continue
    // Long text (a description, the requirements) is named, not quoted twice over.
    if (a.length > 80 || b.length > 80) parts.push(`${labels[k]} edited`)
    else parts.push(`${labels[k]}: ${a ? clip(a) : "—"} → ${b ? clip(b) : "—"}`)
  }
  return parts.join("; ")
}

/** Writes one line on the booking's history and bumps its updatedAt, so a note or a hotel change
 *  moves it up the "last changed" order like an edit to the booking itself does. */
export async function logEvent(bookingId: string, who: CollectionsUser, kind: string, text: string) {
  await prisma.$transaction([
    prisma.collectionBookingEvent.create({ data: { bookingId, kind, text: text.slice(0, 4000), byId: who.userId, byName: who.name } }),
    prisma.collectionBooking.update({ where: { id: bookingId }, data: { updatedAt: new Date() }, select: { id: true } }),
  ])
}
