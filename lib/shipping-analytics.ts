// Shipping analytics — powers the BC Reports "Shipping" tab and its PDF.
//
// Combines two BC sources that don't live on the same row:
//   • ShipmentRequestAPI  → one row per dispatch (parcel). Carries the buyer's
//     destination country (EVA_CountryRegion) and the collection docket number
//     (EVA_DocumentNo, e.g. COL000010). Status "Cancelled" rows are dropped.
//   • Receipt_Lines_Excel → one row per lot. Carries the parcel size band
//     (EVA_SHIP_EVA_SizeClassification) and the collection number
//     (EVA_CollectionNo). Synced locally into WarehouseItem.
//
// The two are joined on the collection number, so each shipped lot's size can
// be tied to its destination country, and the Vectis rate sheet applied to
// estimate shipping revenue. Sizes come from the LOCAL WarehouseItem table
// (fast, no per-collection BC calls) — which means a full receipt-lines resync
// must have run to populate `collectionNo` + `sizeClassification`.

import { bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { parcelLotCharges, hasRate, regionOf, normalizeSize, PARCEL_SIZES, type Region } from "@/lib/shipping-rates"

export type ShippingAnalytics = {
  from: string
  to:   string
  byCountry: { country: string; count: number }[]
  byCity:    { city: string; country: string; count: number }[]
  byRegion:  { region: Region; parcels: number; items: number; revenue: number; estItems: number; estRevenue: number }[]
  bySize:    { size: string; items: number; revenue: number }[]
  byMonth:   { month: string; parcels: number; items: number; revenue: number; unlinked: number; estItems: number; estRevenue: number }[]
  byDeliveryStatus: { status: string; items: number }[]  // Shipped / Collected counts (standalone, by warehouse location + last-updated date)
  byCountrySize: {
    country: string
    region:  Region
    parcels: number                 // shipments to this country
    items:   number                 // sized lots shipped to this country
    revenue: number
    rated:   boolean                // is the country in the rate sheet?
    sizes:   Record<string, number> // size band → item count
  }[]
  sizesPresent: string[]            // ordered list of size labels seen in the data
  meta: {
    total:              number      // parcels (non-cancelled shipments)
    countries:          number
    cities:             number
    itemsWithSize:      number      // sized lots counted
    parcelsWithSize:    number      // collections with ≥1 sized lot
    parcelsWithoutSize: number      // collections with no size data found
    sizeDataAvailable:  boolean     // false until a receipt-lines resync has run
    estRevenueTotal:    number
    unratedParcels:     number      // shipments to countries with no rate sheet entry
    unratedItems:       number
    unlinkedParcels:    number      // shipments with no collection docket (e.g. "DISPATCH") — can't be joined to lots
    estItemsUnlinked:   number      // ROUGH estimate of items for unlinked parcels (region average)
    estRevenueUnlinked: number      // ROUGH estimate of £ for unlinked parcels (region average)
    collectedRefund:    number      // ROUGH estimate of shipping £ forgone because items were collected (UK rates)
  }
}

// Order sizes canonically (Small, Medium, Large, Contact, Collection Only)
// first, then any other labels alphabetically.
function orderSizes(labels: Iterable<string>): string[] {
  const seen = new Set(labels)
  const canon = (PARCEL_SIZES as readonly string[]).filter(s => seen.has(s))
  const extra = [...seen].filter(s => !(PARCEL_SIZES as readonly string[]).includes(s)).sort()
  return [...canon, ...extra]
}


export async function computeShippingAnalytics(
  token: string,
  from:  string,
  to:    string,
): Promise<ShippingAnalytics> {
  const empty = (): ShippingAnalytics => ({
    from, to, byCountry: [], byCity: [], byRegion: [], bySize: [], byMonth: [], byDeliveryStatus: [], byCountrySize: [],
    sizesPresent: [],
    meta: {
      total: 0, countries: 0, cities: 0, itemsWithSize: 0, parcelsWithSize: 0,
      parcelsWithoutSize: 0, sizeDataAvailable: false, estRevenueTotal: 0,
      unratedParcels: 0, unratedItems: 0, unlinkedParcels: 0,
      estItemsUnlinked: 0, estRevenueUnlinked: 0, collectedRefund: 0,
    },
  })

  const filter = `EVA_ShipmentDate ge ${from} and EVA_ShipmentDate le ${to}`
  // Walk ShipmentRequestAPI via skiptoken (@odata.nextLink) — NOT $skip, which
  // BC silently caps at ~38–40k rows (returns empty pages past the limit). This
  // mirrors the receipt-lines sync so a busy/long date range can't truncate.
  const all: any[] = []
  let link: string | null = null
  for (let page = 0; page < 2000; page++) {
    const { rows, nextLink } = await bcPageWithNext(
      token,
      link ?? "ShipmentRequestAPI",
      link ? undefined : { $filter: filter },
    )
    all.push(...rows)
    if (!nextLink) break
    link = nextLink
  }
  const active = all.filter((s) => s.EVA_Status !== "Cancelled")
  if (active.length === 0) return empty()

  // Field detection — prefer the confirmed names, fall back to a regex scan in
  // case BC renames them.
  const firstKeys  = Object.keys(active[0])
  const countryKey = firstKeys.includes("EVA_CountryRegion") ? "EVA_CountryRegion"
                   : (firstKeys.find((k) => /country/i.test(k)) ?? null)
  const cityKey    = firstKeys.includes("EVA_City") ? "EVA_City"
                   : (firstKeys.find((k) => /city/i.test(k)) ?? null)
  const colKey     = firstKeys.includes("EVA_DocumentNo") ? "EVA_DocumentNo"
                   : (firstKeys.find((k) => /documentno|collection/i.test(k)) ?? null)
  const dateKey    = firstKeys.includes("EVA_ShipmentDate") ? "EVA_ShipmentDate"
                   : (firstKeys.find((k) => /shipmentdate|date/i.test(k)) ?? null)

  // ── Parcel-level aggregation (country / city / collection) ──
  const countryCounts: Record<string, number> = {}
  const cityCounts:    Record<string, { count: number; country: string }> = {}
  const colToCountry:  Record<string, string> = {}
  const colToMonth:    Record<string, string> = {}
  const monthParcels:  Record<string, number> = {}
  const monthUnlinked: Record<string, number> = {}
  const unlinkedMR:    Record<string, number> = {}   // "month|region" → unlinked-parcel count (for the rough estimate)
  const colSet = new Set<string>()

  for (const row of active) {
    const country = (countryKey ? String(row[countryKey] ?? "") : "").toUpperCase().trim() || "Unknown"
    const city    = (cityKey    ? String(row[cityKey]    ?? "") : "").trim() || "Unknown"
    const col     = (colKey     ? String(row[colKey]     ?? "") : "").trim()
    // YYYY-MM from the shipment date (BC dates are ISO-ish strings)
    const month   = (dateKey ? String(row[dateKey] ?? "") : "").slice(0, 7) || "Unknown"

    countryCounts[country] = (countryCounts[country] ?? 0) + 1
    if (!cityCounts[city]) cityCounts[city] = { count: 0, country }
    cityCounts[city].count++
    monthParcels[month] = (monthParcels[month] ?? 0) + 1

    // Only real collection dockets (COL…) can be joined to lots. Some shipments
    // carry a placeholder EVA_DocumentNo like "DISPATCH" (no collection link) —
    // count them as "unlinked" so their missing items/revenue is explained, not
    // silently swallowed. (This was the Jul/Aug 2025 undercount: a chunk of
    // those months' shipments use "DISPATCH" instead of a COL number.)
    if (col && /^col/i.test(col)) {
      colSet.add(col)
      if (!colToCountry[col]) colToCountry[col] = country
      if (!colToMonth[col])   colToMonth[col]   = month
    } else {
      monthUnlinked[month] = (monthUnlinked[month] ?? 0) + 1
      const k = `${month}|${regionOf(country)}`
      unlinkedMR[k] = (unlinkedMR[k] ?? 0) + 1
    }
  }

  const byCountry = Object.entries(countryCounts)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
  const byCity = Object.entries(cityCounts)
    .map(([city, { count, country }]) => ({ city, country, count }))
    .sort((a, b) => b.count - a.count)

  // ── Pull sizes for those collections from the local synced receipt lines ──
  // Chunk the IN() query so a wide date range (tens of thousands of
  // collections) doesn't build one enormous parameter list.
  const cols = [...colSet]
  type Lot = { size: string }
  const colToLots: Record<string, Lot[]> = {}
  const CHUNK = 1000
  for (let i = 0; i < cols.length; i += CHUNK) {
    const slice = cols.slice(i, i + CHUNK)
    const rows = await prisma.warehouseItem.findMany({
      where: { collectionNo: { in: slice } },
      select: { collectionNo: true, sizeClassification: true },
    })
    // A lot whose collection matched WAS in a dispatched collection, so count it
    // even if its size is blank — normalizeSize(null) → "Unspecified" (£0).
    for (const r of rows) {
      if (!r.collectionNo) continue
      ;(colToLots[r.collectionNo] ??= []).push({ size: normalizeSize(r.sizeClassification) })
    }
  }

  // ── Join: attribute each collection's sized lots to its destination country ──
  type Agg = { parcels: number; items: number; revenue: number; sizes: Record<string, number>; region: Region; rated: boolean }
  const perCountry = new Map<string, Agg>()
  const ensure = (country: string): Agg => {
    let a = perCountry.get(country)
    if (!a) {
      a = { parcels: 0, items: 0, revenue: 0, sizes: {}, region: regionOf(country), rated: hasRate(country) }
      perCountry.set(country, a)
    }
    return a
  }
  // Seed parcel (shipment) counts per country
  for (const { country, count } of byCountry) ensure(country).parcels = count

  const sizeItems:    Record<string, number> = {}
  const sizeRevenue:  Record<string, number> = {}
  const monthItems:   Record<string, number> = {}
  const monthRevenue: Record<string, number> = {}
  const linkedCollByRegion: Record<string, number> = {}  // linked collections per region (for the rough-estimate average)
  let itemsWithSize = 0
  let parcelsWithSize = 0
  let estRevenueTotal = 0
  let unratedItems = 0

  // Dedupe by collection (one parcel = one collection, charged once even if a
  // collection appears on more than one shipment row). Each parcel is priced
  // the way Vectis charges it: one first-item charge (the dearest lot) + every
  // other lot at its size's additional-item rate (ex VAT). Each lot's
  // contribution is attributed back to its own size band.
  for (const col of cols) {
    const lots = colToLots[col]
    if (!lots || lots.length === 0) continue
    parcelsWithSize++
    const country = colToCountry[col] ?? "Unknown"
    const month   = colToMonth[col] ?? "Unknown"
    const agg = ensure(country)
    linkedCollByRegion[agg.region] = (linkedCollByRegion[agg.region] ?? 0) + 1
    // parcelLotCharges returns one entry per lot in the SAME order as the sizes
    // passed in, so charges[i] lines up with lots[i] (its delivery status).
    for (const lot of parcelLotCharges(country, lots.map((l) => l.size))) {
      agg.items++
      agg.sizes[lot.size] = (agg.sizes[lot.size] ?? 0) + 1
      agg.revenue += lot.rate
      itemsWithSize++
      estRevenueTotal += lot.rate
      sizeItems[lot.size]    = (sizeItems[lot.size]    ?? 0) + 1
      sizeRevenue[lot.size]  = (sizeRevenue[lot.size]  ?? 0) + lot.rate
      monthItems[month]      = (monthItems[month]      ?? 0) + 1
      monthRevenue[month]    = (monthRevenue[month]    ?? 0) + lot.rate
      if (!agg.rated) unratedItems++
    }
  }

  // ── Region rollup ──
  const regionAgg = new Map<Region, { parcels: number; items: number; revenue: number }>()
  for (const a of perCountry.values()) {
    const r = regionAgg.get(a.region) ?? { parcels: 0, items: 0, revenue: 0 }
    r.parcels += a.parcels
    r.items   += a.items
    r.revenue += a.revenue
    regionAgg.set(a.region, r)
  }

  // ── Rough estimate for "unlinked" (DISPATCH) parcels ──
  // They have a country (→ region) but no collection, so their lots aren't
  // visible. Value each at the AVERAGE items/£ per LINKED parcel in the same
  // region, so a UK unlinked parcel is valued like a UK one, Europe like Europe.
  // Kept SEPARATE from the actual figures (estItems/estRevenue) so the UI can
  // show a clearly-labelled "rough total" without faking the real numbers.
  const regionAvgItems: Record<string, number> = {}
  const regionAvgRev:   Record<string, number> = {}
  for (const [region, agg] of regionAgg) {
    const n = linkedCollByRegion[region] ?? 0
    regionAvgItems[region] = n > 0 ? agg.items   / n : 0
    regionAvgRev[region]   = n > 0 ? agg.revenue / n : 0
  }
  const estItemsByMonth:  Record<string, number> = {}
  const estRevByMonth:    Record<string, number> = {}
  const estItemsByRegion: Record<string, number> = {}
  const estRevByRegion:   Record<string, number> = {}
  let estItemsUnlinked = 0
  let estRevenueUnlinked = 0
  for (const [key, count] of Object.entries(unlinkedMR)) {
    const sep    = key.lastIndexOf("|")
    const month  = key.slice(0, sep)
    const region = key.slice(sep + 1)
    const ei = count * (regionAvgItems[region] ?? 0)
    const er = count * (regionAvgRev[region]   ?? 0)
    estItemsByMonth[month]   = (estItemsByMonth[month]   ?? 0) + ei
    estRevByMonth[month]     = (estRevByMonth[month]     ?? 0) + er
    estItemsByRegion[region] = (estItemsByRegion[region] ?? 0) + ei
    estRevByRegion[region]   = (estRevByRegion[region]   ?? 0) + er
    estItemsUnlinked   += ei
    estRevenueUnlinked += er
  }

  const byRegion = (["UK", "Europe", "Rest of World"] as Region[])
    .map((region) => {
      const a = regionAgg.get(region) ?? { parcels: 0, items: 0, revenue: 0 }
      return {
        region,
        parcels:    a.parcels,
        items:      a.items,
        revenue:    a.revenue,
        estItems:   Math.round(estItemsByRegion[region] ?? 0),
        estRevenue: estRevByRegion[region] ?? 0,
      }
    })
    .filter((r) => r.parcels > 0 || r.items > 0 || r.estItems > 0)

  const sizesPresent = orderSizes(Object.keys(sizeItems))
  const bySize = sizesPresent.map((size) => ({
    size, items: sizeItems[size] ?? 0, revenue: sizeRevenue[size] ?? 0,
  }))

  // Monthly trend — every month that has parcels and/or revenue, chronological.
  const monthKeys = [...new Set([...Object.keys(monthParcels), ...Object.keys(monthRevenue)])].sort()
  const byMonth = monthKeys.map((month) => ({
    month,
    parcels:    monthParcels[month]  ?? 0,
    items:      monthItems[month]    ?? 0,
    revenue:    monthRevenue[month]  ?? 0,
    unlinked:   monthUnlinked[month] ?? 0,
    estItems:   Math.round(estItemsByMonth[month] ?? 0),
    estRevenue: estRevByMonth[month] ?? 0,
  }))

  // ── Shipped vs Collected (standalone count — independent of the shipment join) ──
  // Simply count every warehouse item whose location is "Shipped" or "Collected",
  // last updated within the period (bcModifiedAt = EVA_SystemModifiedAt ≈ when the
  // location flipped). Used to gauge how many were collected so shipping can be
  // refunded. Nothing else feeds this — not the COL join, not the rate sheet.
  const periodFrom = new Date(from)
  const periodTo   = new Date(`${to}T23:59:59.999Z`)
  const dateWhere  = { gte: periodFrom, lte: periodTo }
  const [totalInPeriod, shippedCount, sandownCount, collectedRows] = await Promise.all([
    prisma.warehouseItem.count({ where: { bcModifiedAt: dateWhere } }),
    prisma.warehouseItem.count({ where: { location: { equals: "Shipped", mode: "insensitive" }, bcModifiedAt: dateWhere } }),
    prisma.warehouseItem.count({ where: { location: { equals: "SANDOWN", mode: "insensitive" }, bcModifiedAt: dateWhere } }),
    prisma.warehouseItem.findMany({
      where: { location: { equals: "Collected", mode: "insensitive" }, bcModifiedAt: dateWhere },
      select: { collectionNo: true, sizeClassification: true },
    }),
  ])
  const collectedCount = collectedRows.length
  // Estimated shipping that would be REFUNDED for these collections (the revenue
  // reduction). Group by collection and price each like a parcel (first item +
  // additionals) at UK rates — in-person collections are local. Rough estimate.
  const collectedGroups: Record<string, string[]> = {}
  collectedRows.forEach((r, i) => {
    const key = r.collectionNo || `__solo_${i}`
    ;(collectedGroups[key] ??= []).push(normalizeSize(r.sizeClassification))
  })
  let collectedRefund = 0
  for (const sizes of Object.values(collectedGroups)) {
    for (const lot of parcelLotCharges("GB", sizes)) collectedRefund += lot.rate
  }
  // Everything in the period that isn't Shipped/Collected/SANDOWN — incl. items
  // still in warehouse aisles, archive, or with no location (per Jordan's choice).
  const notScannedCount = Math.max(0, totalInPeriod - shippedCount - collectedCount - sandownCount)
  const byDeliveryStatus = [
    { status: "Shipped",               items: shippedCount },
    { status: "Collected",             items: collectedCount },
    { status: "SANDOWN",               items: sandownCount },
    { status: "Not scanned / unknown", items: notScannedCount },
  ].filter((s) => s.items > 0)

  const byCountrySize = [...perCountry.entries()]
    .map(([country, a]) => ({
      country, region: a.region, parcels: a.parcels, items: a.items,
      revenue: a.revenue, rated: a.rated, sizes: a.sizes,
    }))
    .sort((x, y) => y.parcels - x.parcels || y.revenue - x.revenue)

  const unratedParcels = active.filter((row) => {
    const country = (countryKey ? String(row[countryKey] ?? "") : "").toUpperCase().trim() || "Unknown"
    return !hasRate(country)
  }).length

  return {
    from, to, byCountry, byCity, byRegion, bySize, byMonth, byDeliveryStatus, byCountrySize, sizesPresent,
    meta: {
      total: active.length,
      countries: byCountry.length,
      cities: byCity.length,
      itemsWithSize,
      parcelsWithSize,
      parcelsWithoutSize: cols.length - parcelsWithSize,
      sizeDataAvailable: itemsWithSize > 0,
      estRevenueTotal,
      unratedParcels,
      unratedItems,
      unlinkedParcels: Object.values(monthUnlinked).reduce((a, b) => a + b, 0),
      estItemsUnlinked: Math.round(estItemsUnlinked),
      estRevenueUnlinked,
      collectedRefund,
    },
  }
}
