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
import { COUNTRY_ALIASES } from "@/lib/country-names"

// Normalise a raw BC country value: uppercase, trim, and fold non-canonical
// codes (e.g. "UK" → "GB") so the same place can't appear as two rows.
function normCountry(raw: unknown): string {
  const c = String(raw ?? "").toUpperCase().trim()
  return (COUNTRY_ALIASES[c] ?? c) || "Unknown"
}

export type ShippingAnalytics = {
  from: string
  to:   string
  byCountry: { country: string; count: number }[]
  byCity:    { city: string; country: string; count: number }[]
  byRegion:  { region: Region; parcels: number; items: number; revenue: number; estItems: number; estRevenue: number }[]
  bySize:    { size: string; items: number; revenue: number }[]
  byMonth:   { month: string; parcels: number; items: number; revenue: number; unlinked: number; estItems: number; estRevenue: number }[]
  byDeliveryStatus: { status: string; items: number }[]  // Shipped / Collected / SANDOWN / Not-scanned counts (COL items, by warehouse location)
  notScannedLocations: { location: string; items: number }[]  // breakdown of what's in the "Not scanned / unknown" bucket
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
    notScannedExcludesLastMonth: boolean  // did the "Not scanned" bucket drop the last month? (false for windows ≤ ~1 month)
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

// Distribute an integer `total` across keys in proportion to their fractional
// `weights` using the largest-remainder (Hamilton) method, so the per-bucket
// integers PROVABLY sum to `total`. Used so the By Region / By Month estimated-
// item columns add up exactly to the headline "Items shipped" instead of
// drifting from independent per-bucket rounding.
function allocateRounded(weights: Record<string, number>, total: number): Record<string, number> {
  const keys = Object.keys(weights)
  const out: Record<string, number> = {}
  for (const k of keys) out[k] = 0
  if (total <= 0 || keys.length === 0) return out
  const parts = keys.map((k) => ({ k, floor: Math.floor(weights[k]), rem: weights[k] - Math.floor(weights[k]) }))
  for (const p of parts) out[p.k] = p.floor
  let leftover = total - parts.reduce((s, p) => s + p.floor, 0)
  parts.sort((a, b) => b.rem - a.rem)
  for (let i = 0; leftover > 0 && i < parts.length; i++, leftover--) out[parts[i].k]++
  for (let i = parts.length - 1; leftover < 0 && i >= 0; i--) { if (out[parts[i].k] > 0) { out[parts[i].k]--; leftover++ } }
  return out
}


export async function computeShippingAnalytics(
  token: string,
  from:  string,
  to:    string,
): Promise<ShippingAnalytics> {
  const empty = (): ShippingAnalytics => ({
    from, to, byCountry: [], byCity: [], byRegion: [], bySize: [], byMonth: [], byDeliveryStatus: [], notScannedLocations: [], byCountrySize: [],
    sizesPresent: [],
    meta: {
      total: 0, countries: 0, cities: 0, itemsWithSize: 0, parcelsWithSize: 0,
      parcelsWithoutSize: 0, sizeDataAvailable: false, estRevenueTotal: 0,
      unratedParcels: 0, unratedItems: 0, unlinkedParcels: 0,
      estItemsUnlinked: 0, estRevenueUnlinked: 0, collectedRefund: 0,
      notScannedExcludesLastMonth: true,
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
  const cityCounts:    Record<string, { city: string; count: number; country: string }> = {}
  const colToCountry:  Record<string, string> = {}
  const colToMonth:    Record<string, string> = {}
  const monthParcels:  Record<string, number> = {}
  const monthUnlinked: Record<string, number> = {}
  const unlinkedMR:    Record<string, number> = {}   // "month|region" → unlinked-parcel count (for the rough estimate)
  const colSet = new Set<string>()

  for (const row of active) {
    const country = normCountry(countryKey ? row[countryKey] : "")
    const city    = (cityKey    ? String(row[cityKey]    ?? "") : "").trim() || "Unknown"
    const col     = (colKey     ? String(row[colKey]     ?? "") : "").trim()
    // YYYY-MM from the shipment date (BC dates are ISO-ish strings)
    const month   = (dateKey ? String(row[dateKey] ?? "") : "").slice(0, 7) || "Unknown"

    countryCounts[country] = (countryCounts[country] ?? 0) + 1
    // Key by country+city so e.g. London (GB) and London (CA) don't merge into
    // one mislabelled row (which also mis-plotted the UK map).
    const cityCK = `${country}|${city}`
    if (!cityCounts[cityCK]) cityCounts[cityCK] = { city, count: 0, country }
    cityCounts[cityCK].count++
    monthParcels[month] = (monthParcels[month] ?? 0) + 1

    // Only real collection dockets (COL…) can be joined to lots. Some shipments
    // carry a placeholder EVA_DocumentNo like "DISPATCH" (no collection link) —
    // count them as "unlinked" so their missing items/revenue is explained, not
    // silently swallowed. (This was the Jul/Aug 2025 undercount: a chunk of
    // those months' shipments use "DISPATCH" instead of a COL number.)
    if (col && /^col/i.test(col)) {
      colSet.add(col)
      if (!colToCountry[col]) colToCountry[col] = country
      // A collection can appear on more than one shipment row, and rows arrive in
      // BC storage order (no $orderby). Pin the month to the EARLIEST shipment
      // date so the By Month split is deterministic across syncs. ("Unknown" >
      // any real "YYYY-MM" lexicographically, so a real date always wins.)
      if (!colToMonth[col] || month < colToMonth[col]) colToMonth[col] = month
    } else {
      monthUnlinked[month] = (monthUnlinked[month] ?? 0) + 1
      const k = `${month}|${regionOf(country)}`
      unlinkedMR[k] = (unlinkedMR[k] ?? 0) + 1
    }
  }

  const byCountry = Object.entries(countryCounts)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
  const byCity = Object.values(cityCounts)
    .map(({ city, country, count }) => ({ city, country, count }))
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
  // Overall (all-region) average per linked parcel, used as a fallback so that a
  // region whose parcels are ALL unlinked (no COL ever joined) still gets an
  // estimate instead of silently contributing 0 items/£.
  let totLinkedColls = 0, totLinkedItems = 0, totLinkedRev = 0
  for (const [region, agg] of regionAgg) {
    totLinkedColls += linkedCollByRegion[region] ?? 0
    totLinkedItems += agg.items
    totLinkedRev   += agg.revenue
  }
  const overallAvgItems = totLinkedColls > 0 ? totLinkedItems / totLinkedColls : 0
  const overallAvgRev   = totLinkedColls > 0 ? totLinkedRev   / totLinkedColls : 0
  for (const [region, agg] of regionAgg) {
    const n = linkedCollByRegion[region] ?? 0
    regionAvgItems[region] = n > 0 ? agg.items   / n : overallAvgItems
    // Rest of World is quote-only (£0), so never fall it back to a non-zero rate.
    regionAvgRev[region]   = n > 0 ? agg.revenue / n : (region === "Rest of World" ? 0 : overallAvgRev)
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
  // Round the estimated-item total ONCE, then allocate it across regions and
  // months with largest-remainder so each split sums back to this exact figure
  // (and therefore to the headline "Items shipped"). Revenue is never rounded.
  const estItemsTotal  = Math.round(estItemsUnlinked)
  const regionEstAlloc = allocateRounded(estItemsByRegion, estItemsTotal)
  const monthEstAlloc  = allocateRounded(estItemsByMonth, estItemsTotal)

  const byRegion = (["UK", "Europe", "Rest of World"] as Region[])
    .map((region) => {
      const a = regionAgg.get(region) ?? { parcels: 0, items: 0, revenue: 0 }
      return {
        region,
        parcels:    a.parcels,
        items:      a.items,
        revenue:    a.revenue,
        estItems:   regionEstAlloc[region] ?? 0,
        estRevenue: estRevByRegion[region] ?? 0,
      }
    })
    .filter((r) => r.parcels > 0 || r.items > 0 || r.estItems > 0)

  const sizesPresent = orderSizes(Object.keys(sizeItems))
  const bySize = sizesPresent.map((size) => ({
    size, items: sizeItems[size] ?? 0, revenue: sizeRevenue[size] ?? 0,
  }))
  // NB: the un-docketed ("DISPATCH") parcels' estimated lots can't be split by
  // size, so they are NOT added as a fake size row here — the UI/PDF show them as
  // a separate "+ estimated" line below the size table (meta.estItemsUnlinked /
  // estRevenueUnlinked). Real sizes + that line = the headline.

  // Monthly trend — every month that has parcels and/or revenue, chronological.
  const monthKeys = [...new Set([...Object.keys(monthParcels), ...Object.keys(monthRevenue)])].sort()
  const byMonth = monthKeys.map((month) => ({
    month,
    parcels:    monthParcels[month]  ?? 0,
    items:      monthItems[month]    ?? 0,
    revenue:    monthRevenue[month]  ?? 0,
    unlinked:   monthUnlinked[month] ?? 0,
    estItems:   monthEstAlloc[month] ?? 0,
    estRevenue: estRevByMonth[month] ?? 0,
  }))

  // ── Shipped vs Collected (standalone count — independent of the shipment join) ──
  // Simply count every warehouse item whose location is "Shipped" or "Collected",
  // last updated within the period (bcModifiedAt = EVA_SystemModifiedAt ≈ when the
  // location flipped). Used to gauge how many were collected so shipping can be
  // refunded. Nothing else feeds this — not the COL join, not the rate sheet.
  // Only items that actually went INTO a collection (have a COL number) — that's
  // the population this report is about, and it strips out pending/unsold stock.
  const colOnly = { collectionNo: { not: null } }
  // Filter by the lot's AUCTION DATE (EVA_AuctionDate, an ISO yyyy-mm-dd string →
  // lexicographic gte/lte == chronological), NOT bcModifiedAt: a 2023 lot that
  // was merely touched in BC recently has a recent bcModifiedAt and would wrongly
  // land inside a "last 12 months" window (e.g. the 139 lots at A17G2). The
  // ...T23:59:59 upper bound is inclusive whether auctionDate is date-only or has
  // a time component.
  const aucWhere = { gte: from, lte: `${to}T23:59:59.999Z` }
  // "Not scanned / unknown" normally drops the last month (recent auctions may
  // not be dispatched/collected yet). Compute "one month before `to`" WITHOUT JS
  // day-overflow (31 Mar -> 28 Feb, not 3 Mar): clamp the day to the last day of
  // the previous month. And if that cutoff falls before `from` (a selected window
  // of a month or less), don't invert the range to empty — count the full window
  // instead, matching the other three buckets so the % base stays coherent.
  const toD = new Date(`${to}T00:00:00.000Z`)
  const lastDayPrevMonth = new Date(Date.UTC(toD.getUTCFullYear(), toD.getUTCMonth(), 0)).getUTCDate()
  const cutoff = new Date(Date.UTC(toD.getUTCFullYear(), toD.getUTCMonth() - 1, Math.min(toD.getUTCDate(), lastDayPrevMonth)))
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const notScannedExcludesLastMonth = cutoffStr >= from
  const preAucTo = notScannedExcludesLastMonth ? cutoffStr : to
  const preAucWhere = { gte: from, lte: `${preAucTo}T23:59:59.999Z` }
  const [shippedCount, sandownCount, collectedRows, preLocGroups] = await Promise.all([
    prisma.warehouseItem.count({ where: { ...colOnly, location: { equals: "Shipped", mode: "insensitive" }, auctionDate: aucWhere } }),
    prisma.warehouseItem.count({ where: { ...colOnly, location: { equals: "SANDOWN", mode: "insensitive" }, auctionDate: aucWhere } }),
    prisma.warehouseItem.findMany({
      where: { ...colOnly, location: { equals: "Collected", mode: "insensitive" }, auctionDate: aucWhere },
      select: { collectionNo: true, sizeClassification: true },
    }),
    prisma.warehouseItem.groupBy({
      by: ["location"],
      where: { ...colOnly, auctionDate: preAucWhere },
      _count: { _all: true },
    }),
  ])
  const collectedCount = collectedRows.length

  // "Not scanned / unknown" = COL items (excluding the last month) NOT at
  // Shipped / Collected / SANDOWN, plus a breakdown of what their locations
  // actually are so they can be investigated.
  // Known warehouse locations that are NOT a shipping disposition and aren't
  // "unscanned" either — exclude them from the breakdown entirely (per Jordan's
  // list). Add more here if other holding locations turn up.
  const EXCLUDED_LOCS = new Set(["archive", "query"])
  const notScannedLocAgg: Record<string, number> = {}
  let notScannedCount = 0
  for (const g of preLocGroups) {
    const raw = String(g.location ?? "").trim()
    const lc  = raw.toLowerCase()
    if (lc === "shipped" || lc === "collected" || lc === "sandown") continue
    if (EXCLUDED_LOCS.has(lc)) continue
    const n = g._count._all
    notScannedCount += n
    notScannedLocAgg[raw || "(no location)"] = (notScannedLocAgg[raw || "(no location)"] ?? 0) + n
  }
  const sortedNotScanned = Object.entries(notScannedLocAgg)
    .map(([location, items]) => ({ location, items }))
    .sort((a, b) => b.items - a.items)
  const TOP_LOCS = 25
  const notScannedLocations = sortedNotScanned.slice(0, TOP_LOCS)
  // Keep the drill-in readable but still reconcilable: fold everything past the
  // top 25 into one "(N other locations)" row so the rows always sum to the
  // headline "Not scanned / unknown" count.
  if (sortedNotScanned.length > TOP_LOCS) {
    const shown = notScannedLocations.reduce((s, x) => s + x.items, 0)
    const rest = notScannedCount - shown
    if (rest > 0) notScannedLocations.push({ location: `(${sortedNotScanned.length - TOP_LOCS} other locations)`, items: rest })
  }
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
    const country = normCountry(countryKey ? row[countryKey] : "")
    return !hasRate(country)
  }).length

  return {
    from, to, byCountry, byCity, byRegion, bySize, byMonth, byDeliveryStatus, notScannedLocations, byCountrySize, sizesPresent,
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
      estItemsUnlinked: estItemsTotal,
      estRevenueUnlinked,
      collectedRefund,
      notScannedExcludesLastMonth,
    },
  }
}
