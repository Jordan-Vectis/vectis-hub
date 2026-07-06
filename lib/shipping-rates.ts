// Vectis website shipping rates — used by the Shipping report (BC Reports) to
// estimate shipping revenue from BC dispatch data + parcel-size classification.
//
// Source: "Shipping Rates.xlsx" (provided by Jordan, 2026-06-26). Keyed by
// destination country code (matches BC `EVA_CountryRegion`) × parcel size band
// (matches BC `EVA_SHIP_EVA_SizeClassification`). `first` = first-item cost,
// `additional` = each extra item in the same parcel.
//
// ⚠ STATIC SNAPSHOT — this is NOT synced from anywhere. If Vectis changes its
// shipping rates, update this table by hand (re-run the generator over the new
// spreadsheet). The Shipping report's revenue figures are only as current as
// this file.

export const PARCEL_SIZES = ["Small", "Medium", "Large", "Contact", "Collection Only"] as const
export type ParcelSize = (typeof PARCEL_SIZES)[number]

type Rate = { first: number; additional: number }

// country code → size band → { first, additional }
export const SHIPPING_RATES: Record<string, Partial<Record<ParcelSize, Rate>>> = {
  AT: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  BE: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  BG: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  BY: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  CH: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  CY: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  CZ: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  DE: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  DK: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  EE: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  ES: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  FI: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  FR: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  GB: { "Small": { first: 14.95, additional: 1.95 }, "Medium": { first: 19.95, additional: 4.95 }, "Large": { first: 24.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  UK: { "Small": { first: 14.95, additional: 1.95 }, "Medium": { first: 19.95, additional: 4.95 }, "Large": { first: 24.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } }, // BC sometimes emits the literal "UK" for Great Britain — same rates as GB (without this, "UK" priced £0)
  GG: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  GL: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  GR: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  HR: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  HU: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  IE: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  IS: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  IT: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  JE: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  IM: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } }, // Isle of Man (Crown Dependency) — ASSUMED same tier as the Channel Islands (GG/JE), not in the source sheet. Confirm rate with Jordan.
  LT: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  LU: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  LV: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  MT: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  NI: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  NL: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  NO: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  PL: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  PT: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  RO: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  RU: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  SE: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  SI: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  SK: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  TR: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  UA: { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  // European territories not in the source spreadsheet — priced at the standard
  // western-EU tier (same as FR/DE/ES + the Channel Islands) per Jordan's call
  // (2026-06-29), so they contribute estimated revenue instead of £0.
  AD: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  AL: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  AX: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  BA: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  FO: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  GI: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  LI: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  MC: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  MD: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  ME: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  MK: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  RS: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  SM: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
  VA: { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 }, "Contact": { first: 0, additional: 0 }, "Collection Only": { first: 0, additional: 0 } },
}

// Normalise a raw BC size value to a canonical band. BC's
// `EVA_SHIP_EVA_SizeClassification` is set by cataloguers, so guard against
// casing/spacing variants. Unknown values are returned trimmed (kept as their
// own row so nothing is silently dropped) — "" becomes "Unspecified".
export function normalizeSize(raw: unknown): string {
  const t = String(raw ?? "").trim()
  if (!t) return "Unspecified"
  const lower = t.toLowerCase().replace(/\s+/g, " ")
  if (lower === "small")  return "Small"
  if (lower === "medium") return "Medium"
  if (lower === "large")  return "Large"
  if (lower === "contact" || lower === "contact us") return "Contact"
  if (lower === "collection only" || lower === "collectiononly" || lower === "collection") return "Collection Only"
  return t
}

// First-item cost for a country/size. Returns 0 for countries not in the rate
// sheet (international "Contact" destinations), unknown sizes, and the
// Contact / Collection Only bands (all £0 in the sheet).
export function firstItemRate(country: string, size: string): number {
  const c = SHIPPING_RATES[String(country ?? "").toUpperCase().trim()]
  if (!c) return 0
  const r = c[size as ParcelSize]
  return r ? r.first : 0
}

// Each-extra-item cost for a country/size (0 for unrated countries / 0-rate bands).
export function additionalItemRate(country: string, size: string): number {
  const c = SHIPPING_RATES[String(country ?? "").toUpperCase().trim()]
  if (!c) return 0
  const r = c[size as ParcelSize]
  return r ? r.additional : 0
}

// Price one parcel the way Vectis actually charges it: ONE "first item" (the
// single dearest lot — the one whose size has the highest first-item rate) at
// its first-item rate, and EVERY other lot at its own size's additional rate.
// Returns each lot's contribution so callers can both total the parcel and
// attribute revenue back to per-size / per-country buckets.
//
//   e.g. UK parcel of 1 Medium + 3 Small →
//        Medium £19.95 (first) + 3 × Small £1.95 (additional) = £25.80
export function parcelLotCharges(
  country: string,
  sizes: string[],
): { size: string; rate: number; first: boolean }[] {
  if (sizes.length === 0) return []
  // Pick the first item: highest first-item rate wins (ties → earliest).
  let firstIdx = 0
  let maxFirst = -1
  sizes.forEach((s, i) => {
    const fr = firstItemRate(country, s)
    if (fr > maxFirst) { maxFirst = fr; firstIdx = i }
  })
  return sizes.map((size, i) => {
    const first = i === firstIdx
    return { size, first, rate: first ? firstItemRate(country, size) : additionalItemRate(country, size) }
  })
}

// Does the rate sheet cover this destination country at all?
export function hasRate(country: string): boolean {
  return !!SHIPPING_RATES[String(country ?? "").toUpperCase().trim()]
}

// ─── Region grouping: UK / Europe / Rest of World ─────────────────────────────

export type Region = "UK" | "Europe" | "Rest of World"
export const REGIONS: Region[] = ["UK", "Europe", "Rest of World"]

// UK = Great Britain, Northern Ireland + the Crown Dependencies (Channel
// Islands / Isle of Man). Move GG/JE/IM into EUROPE_CODES if Jordan wants the
// Channel Islands counted as Europe instead.
const UK_CODES = new Set(["GB", "UK", "NI", "GG", "JE", "IM"])

// Europe = EU + the rest of geographic Europe. Greenland (GL) is grouped here
// to match the rate sheet, which prices it on the European tier.
const EUROPE_CODES = new Set([
  "AD", "AL", "AT", "AX", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK",
  "EE", "ES", "FI", "FO", "FR", "GI", "GL", "GR", "HR", "HU", "IE", "IS", "IT",
  "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT",
  "RO", "RS", "RU", "SE", "SI", "SK", "SM", "TR", "UA", "VA",
])

export function regionOf(country: string): Region {
  const c = String(country ?? "").toUpperCase().trim()
  if (UK_CODES.has(c))     return "UK"
  if (EUROPE_CODES.has(c)) return "Europe"
  return "Rest of World"
}

// ─── Price bands (for the Shipping report's price calculator) ─────────────────
//
// The ~50-country matrix above only holds THREE distinct price tiers plus a
// quote-only "Rest of World". Every country within a tier shares the same
// Small/Medium/Large first- and extra-item prices, so the calculator groups by
// band rather than showing 50 near-identical rows.

export type RateBand = "UK" | "Europe (West)" | "Europe (East & rest)" | "Rest of World"

// The three chargeable bands, in display order. "Rest of World" is quote-only
// (£0) so it's not a calculator row.
export const RATE_BANDS: RateBand[] = ["UK", "Europe (West)", "Europe (East & rest)"]

// The current price for each band — these mirror the matrix above exactly (any
// country in the band uses these). Update alongside SHIPPING_RATES if prices
// change. Small/Medium/Large only; Contact/Collection Only are £0 (not charged).
export const BAND_RATES: Record<RateBand, Partial<Record<ParcelSize, Rate>>> = {
  "UK":                   { "Small": { first: 14.95, additional: 1.95 }, "Medium": { first: 19.95, additional: 4.95 }, "Large": { first: 24.95, additional: 19.95 } },
  "Europe (West)":        { "Small": { first: 34.95, additional: 4.95 }, "Medium": { first: 49.95, additional: 9.95 }, "Large": { first: 64.95, additional: 19.95 } },
  "Europe (East & rest)": { "Small": { first: 34.95, additional: 9.95 }, "Medium": { first: 66.95, additional: 14.95 }, "Large": { first: 89.95, additional: 19.95 } },
  "Rest of World":        {},
}

// Which price band does a destination country fall in? Classified by matching
// its actual Small-size rates against BAND_RATES (all sizes move together within
// a band), so it stays correct if the matrix is re-tiered. Countries with no
// rate-sheet entry are "Rest of World" (quote only). NB this is a PRICE band,
// not a geographic region — e.g. Northern Ireland is priced on the Europe (West)
// tier in the sheet, so it bands there even though its region is UK.
export function rateBandOf(country: string): RateBand {
  const c = SHIPPING_RATES[String(country ?? "").toUpperCase().trim()]
  const s = c?.["Small"]
  if (!s) return "Rest of World"
  for (const band of RATE_BANDS) {
    const b = BAND_RATES[band]["Small"]!
    if (s.first === b.first && s.additional === b.additional) return band
  }
  return "Rest of World"
}
