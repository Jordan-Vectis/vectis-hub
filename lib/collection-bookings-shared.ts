// Admin & Operations → Collection bookings: the constants both the server and the page use.
// No server imports here — the page (a client component) reads this file too.

export const COLLECTION_STATUSES = ["NEW", "IN_HAND", "BOOKED", "COLLECTED", "CANCELLED"] as const
export type CollectionStatus = typeof COLLECTION_STATUSES[number]
export const COLLECTION_STATUS_LABEL: Record<CollectionStatus, string> = {
  NEW:       "New — not picked up",
  IN_HAND:   "Being arranged",
  BOOKED:    "Booked",
  COLLECTED: "Collected",
  CANCELLED: "Cancelled",
}
/** Still to happen — the bookings the page opens on. */
export const OPEN_COLLECTION_STATUSES: CollectionStatus[] = ["NEW", "IN_HAND", "BOOKED"]

/** R2 prefix for every file on a booking: photos of the collection and hotel confirmations.
 *  ⚠ Served ONLY by /api/collection-bookings/file (app-gated). The general photo routes refuse it,
 *  because these hold vendors' home addresses and staff hotel bookings. */
export const COLLECTION_FILE_PREFIX = "collection-bookings/"
/** collection-bookings/<booking id>/<time>-<random>.<ext> — the only shape the upload route writes. */
export const COLLECTION_FILE_RE = /^collection-bookings\/[a-z0-9]{10,40}\/\d{10,16}-[a-z0-9]{6,12}\.(jpg|jpeg|png|webp|pdf)$/

export const ref = (n: number) => `CB-${String(n).padStart(4, "0")}`

/** Collections within this many miles of each other are marked as nearby. */
export const NEARBY_MILES = 30

/** Straight-line ("as the crow flies") miles between two points — the haversine formula. Roads are
 *  longer, typically by a fifth to a third, so the page always says "straight line". */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}
