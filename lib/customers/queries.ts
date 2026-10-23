import { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE, type ListFilters, type SortKey } from "@/lib/customers/filters"

// Everything the Customers list and the customer page read. Receipts, totes and lots come from the
// Hub's own BC copies (WarehouseReceiptTote, WarehouseTote, WarehouseItem) and the Hub's lots
// (CatalogueLot), linked by the person's number; "paid, not collected" from Accounts' cases; notes
// from CustomerNote. Nothing here calls BC. Every read of a table that may not exist yet (before
// Run Migrations) is tolerant: it answers null / 0 and the page says so.

const { sql, join, empty } = Prisma

const londonDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" }) // YYYY-MM-DD

export async function tableExists(name: string): Promise<boolean> {
  try {
    const r = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass(${`"${name}"`}) IS NOT NULL AS ok`
    return !!r[0]?.ok
  } catch { return false }
}

// ── The list ────────────────────────────────────────────────────────────────

export type ListRow = {
  id: string; name: string | null; name2: string | null; contactNo: string | null; vendorNo: string | null; buyerNo: string | null
  email: string | null; phone: string | null; mobile: string | null; city: string | null; postCode: string | null
  websiteId: string | null; blocked: string | null; trustedBuyer: boolean | null
  receipts: number; totes: number; lastReceipt: Date | null
  lots: number; sold: number; lastSale: string | null; hubLots: number
  notes: number; lastNote: Date | null; followUpAt: Date | null
  uncollected: number
}

export type Facets = {
  people: number; sellers: number; buyers: number; both: number; web: number
  blocked: number; trusted: number; noEmail: number
  lotsNow: number; receiptYear: number; uncollected: number; notes: number | null; followUp: number | null
}

function whereFor(f: ListFilters, notesReady: boolean): Prisma.Sql {
  const parts: Prisma.Sql[] = []
  if (f.type === "seller") parts.push(sql`c."vendorNo" IS NOT NULL`)
  if (f.type === "buyer") parts.push(sql`c."buyerNo" IS NOT NULL`)
  if (f.type === "both") parts.push(sql`c."vendorNo" IS NOT NULL AND c."buyerNo" IS NOT NULL`)
  if (f.type === "web") parts.push(sql`c."websiteId" IS NOT NULL`)
  if (f.q) {
    const pat = `%${f.q.replace(/[\\%_]/g, m => "\\" + m)}%`
    parts.push(sql`(c.name ILIKE ${pat} ESCAPE '\\' OR c."name2" ILIKE ${pat} ESCAPE '\\' OR c.email ILIKE ${pat} ESCAPE '\\'
      OR c."postCode" ILIKE ${pat} ESCAPE '\\' OR c.phone ILIKE ${pat} ESCAPE '\\' OR c.mobile ILIKE ${pat} ESCAPE '\\'
      OR c."contactNo" ILIKE ${pat} ESCAPE '\\' OR c."vendorNo" ILIKE ${pat} ESCAPE '\\' OR c."buyerNo" ILIKE ${pat} ESCAPE '\\'
      OR c.city ILIKE ${pat} ESCAPE '\\')`)
  }
  const t = f.toggles
  if (t.lotsNow) parts.push(sql`(EXISTS (SELECT 1 FROM "WarehouseItem" wi WHERE wi."vendorNo" = c."vendorNo" AND wi."auctionDate" >= ${londonDay()})
    OR EXISTS (SELECT 1 FROM "CatalogueLot" cl JOIN "CatalogueAuction" ca ON ca.id = cl."auctionId" WHERE cl.vendor = c."vendorNo" AND ca.complete = false))`)
  if (t.receiptYear) parts.push(sql`EXISTS (SELECT 1 FROM "WarehouseReceiptTote" rt WHERE rt."vendorNo" = c."vendorNo" AND rt."bcCreatedAt" >= now() - interval '1 year')`)
  if (t.uncollected) parts.push(sql`EXISTS (SELECT 1 FROM "UncollectedPaid" u WHERE u."buyerNo" = c."buyerNo" AND u.status NOT IN ('collected','closed'))`)
  if (t.notes && notesReady) parts.push(sql`EXISTS (SELECT 1 FROM "CustomerNote" n WHERE n."customerId" = c.id)`)
  if (t.followUp && notesReady) parts.push(sql`EXISTS (SELECT 1 FROM "CustomerNote" n WHERE n."customerId" = c.id AND n."followUpDone" = false AND n."followUpAt" IS NOT NULL AND n."followUpAt" < (date_trunc('day', now() AT TIME ZONE 'Europe/London') + interval '1 day') AT TIME ZONE 'Europe/London')`)
  if (t.blocked) parts.push(sql`c.blocked IS NOT NULL`)
  if (t.trusted) parts.push(sql`c."trustedBuyer" = true`)
  if (t.noEmail) parts.push(sql`coalesce(trim(c.email), '') = ''`)
  return parts.length ? sql`WHERE ${join(parts, " AND ")}` : empty
}

const AGG_SORTS: SortKey[] = ["lots", "receipts", "activity"]

export async function listCustomers(f: ListFilters, notesReady: boolean): Promise<{ rows: ListRow[]; total: number }> {
  const where = whereFor(f, notesReady)
  const offset = (f.page - 1) * PAGE_SIZE
  const notesLateral = notesReady
    ? sql`LEFT JOIN LATERAL (SELECT count(*) AS notes, max("createdAt") AS "lastNote",
          min("followUpAt") FILTER (WHERE "followUpDone" = false) AS "followUpAt" FROM "CustomerNote" WHERE "customerId" = c.id) n ON true`
    : sql`LEFT JOIN LATERAL (SELECT 0::bigint AS notes, NULL::timestamp AS "lastNote", NULL::timestamp AS "followUpAt") n ON true`

  // The page is picked first (ids + their order), then the counts are read for those 100 rows only.
  // Sorting by a count needs the counts for EVERY matching person first — grouped once, not per row.
  let page: Prisma.Sql
  if (AGG_SORTS.includes(f.sort)) {
    const order = f.sort === "lots" ? sql`li.lots DESC NULLS LAST`
      : f.sort === "receipts" ? sql`lr.receipts DESC NULLS LAST`
      : sql`GREATEST(lr."lastReceipt", ln."lastNote") DESC NULLS LAST`
    const notesAgg = notesReady
      ? sql`SELECT "customerId", max("createdAt") AS "lastNote" FROM "CustomerNote" GROUP BY 1`
      : sql`SELECT NULL::text AS "customerId", NULL::timestamp AS "lastNote" WHERE false`
    page = sql`SELECT f.id, row_number() OVER (ORDER BY ${order}, f.id) AS rn
      FROM (SELECT c.id, c."vendorNo" FROM "Customer" c ${where}) f
      LEFT JOIN (SELECT "vendorNo", count(*) AS lots FROM "WarehouseItem" WHERE "vendorNo" IS NOT NULL GROUP BY 1) li ON li."vendorNo" = f."vendorNo"
      LEFT JOIN (SELECT "vendorNo", count(DISTINCT "receiptNo") AS receipts, max("bcCreatedAt") AS "lastReceipt" FROM "WarehouseReceiptTote" WHERE "vendorNo" IS NOT NULL GROUP BY 1) lr ON lr."vendorNo" = f."vendorNo"
      LEFT JOIN (${notesAgg}) ln ON ln."customerId" = f.id
      ORDER BY rn LIMIT ${PAGE_SIZE} OFFSET ${offset}`
  } else {
    const order = f.sort === "name" ? sql`c.name ASC NULLS LAST` : sql`c."contactNo" DESC NULLS LAST`
    page = sql`SELECT c.id, row_number() OVER (ORDER BY ${order}, c.id) AS rn FROM "Customer" c ${where} ORDER BY rn LIMIT ${PAGE_SIZE} OFFSET ${offset}`
  }

  const [rows, totalRow] = await Promise.all([
    prisma.$queryRaw<any[]>`WITH page AS (${page})
      SELECT c.id, c.name, c."name2", c."contactNo", c."vendorNo", c."buyerNo", c.email, c.phone, c.mobile, c.city, c."postCode",
        c."websiteId", c.blocked, c."trustedBuyer",
        r.receipts::int AS receipts, r.totes::int AS totes, r."lastReceipt",
        i.lots::int AS lots, i.sold::int AS sold, i."lastSale", h."hubLots"::int AS "hubLots",
        n.notes::int AS notes, n."lastNote", n."followUpAt", u.uncollected::int AS uncollected
      FROM page p JOIN "Customer" c ON c.id = p.id
      LEFT JOIN LATERAL (SELECT count(DISTINCT "receiptNo") AS receipts, count(*) AS totes, max("bcCreatedAt") AS "lastReceipt"
                         FROM "WarehouseReceiptTote" WHERE c."vendorNo" IS NOT NULL AND "vendorNo" = c."vendorNo") r ON true
      LEFT JOIN LATERAL (SELECT count(*) AS lots, count(*) FILTER (WHERE "hammerPrice" > 0) AS sold, max("auctionDate") AS "lastSale"
                         FROM "WarehouseItem" WHERE c."vendorNo" IS NOT NULL AND "vendorNo" = c."vendorNo") i ON true
      LEFT JOIN LATERAL (SELECT count(*) AS "hubLots" FROM "CatalogueLot" cl
                         WHERE c."vendorNo" IS NOT NULL AND cl.vendor = c."vendorNo"
                           AND NOT EXISTS (SELECT 1 FROM "WarehouseItem" wi WHERE wi.barcode = cl.barcode)) h ON true
      ${notesLateral}
      LEFT JOIN LATERAL (SELECT count(*) AS uncollected FROM "UncollectedPaid"
                         WHERE c."buyerNo" IS NOT NULL AND "buyerNo" = c."buyerNo" AND status NOT IN ('collected','closed')) u ON true
      ORDER BY p.rn`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Customer" c ${where}`,
  ])
  return { rows: rows as ListRow[], total: Number(totalRow[0]?.n ?? 0) }
}

/** The numbers beside each filter — one pass over Customer plus a few small reads. Never the BC
 *  card JSON: scanning it took 2.8 s (measured 2026-10-23), so "high risk" and "trusted seller"
 *  filters wait until those flags are copied into columns. */
export async function listFacets(notesReady: boolean): Promise<Facets> {
  const [c, n] = await Promise.all([
    prisma.$queryRaw<any[]>`SELECT
      count(*) AS people,
      count(*) FILTER (WHERE "vendorNo" IS NOT NULL) AS sellers,
      count(*) FILTER (WHERE "buyerNo" IS NOT NULL) AS buyers,
      count(*) FILTER (WHERE "vendorNo" IS NOT NULL AND "buyerNo" IS NOT NULL) AS both,
      count(*) FILTER (WHERE "websiteId" IS NOT NULL) AS web,
      count(*) FILTER (WHERE blocked IS NOT NULL) AS blocked,
      count(*) FILTER (WHERE "trustedBuyer" = true) AS trusted,
      count(*) FILTER (WHERE coalesce(trim(email), '') = '') AS "noEmail",
      (SELECT count(DISTINCT c2.id) FROM "UncollectedPaid" u JOIN "Customer" c2 ON c2."buyerNo" = u."buyerNo" WHERE u.status NOT IN ('collected','closed')) AS uncollected,
      (SELECT count(DISTINCT "vendorNo") FROM "WarehouseItem" WHERE "auctionDate" >= ${londonDay()}) AS "lotsNow",
      (SELECT count(DISTINCT "vendorNo") FROM "WarehouseReceiptTote" WHERE "bcCreatedAt" >= now() - interval '1 year') AS "receiptYear"
      FROM "Customer"`,
    notesReady
      ? prisma.$queryRaw<any[]>`SELECT count(DISTINCT "customerId") AS notes,
          count(DISTINCT "customerId") FILTER (WHERE "followUpDone" = false AND "followUpAt" IS NOT NULL
            AND "followUpAt" < (date_trunc('day', now() AT TIME ZONE 'Europe/London') + interval '1 day') AT TIME ZONE 'Europe/London') AS "followUp"
          FROM "CustomerNote"`.catch(() => [])
      : Promise.resolve([]),
  ])
  const r = c[0] ?? {}
  const num = (v: unknown) => Number(v ?? 0)
  return {
    people: num(r.people), sellers: num(r.sellers), buyers: num(r.buyers), both: num(r.both), web: num(r.web),
    blocked: num(r.blocked), trusted: num(r.trusted), noEmail: num(r.noEmail),
    lotsNow: num(r.lotsNow), receiptYear: num(r.receiptYear), uncollected: num(r.uncollected),
    notes: n[0] ? num(n[0].notes) : null, followUp: n[0] ? num(n[0].followUp) : null,
  }
}

// ── One customer ────────────────────────────────────────────────────────────

export type Receipt = { receiptNo: string; totes: number; first: Date | null; lots: number; sold: number; sales: string | null; lastSale: string | null }
export type Tote = { toteNo: string; receiptNo: string | null; location: string | null; status: string | null; catalogued: boolean | null; bcCreatedAt: Date | null }
export type Lot = { uniqueId: string; barcode: string | null; description: string | null; auctionCode: string | null; auctionName: string | null; auctionDate: string | null; lotNo: string | null; hammerPrice: number | null; collected: boolean | null; receiptNo: string | null }
export type HubLot = { id: string; barcode: string | null; title: string; estimateLow: number | null; estimateHigh: number | null; auctionCode: string; auctionName: string; auctionId: string; createdAt: Date }
export type Note = { id: string; kind: string; text: string; followUpAt: Date | null; followUpDone: boolean; byId: string | null; byName: string | null; createdAt: Date }
export type UncollectedCase = { id: string; saleCode: string | null; invoiceNo: string | null; amountPaid: number | null; paidAt: Date | null; status: string }

export type SellerFigures = {
  receipts: number; totes: number; lots: number; sold: number; hammer: number
  unsoldUncollected: number; lotsNow: number; hubOnlyLots: number
}

export async function sellerFigures(vendorNo: string | null): Promise<SellerFigures> {
  const zero: SellerFigures = { receipts: 0, totes: 0, lots: 0, sold: 0, hammer: 0, unsoldUncollected: 0, lotsNow: 0, hubOnlyLots: 0 }
  if (!vendorNo) return zero
  try {
    const r = await prisma.$queryRaw<any[]>`SELECT
      (SELECT count(DISTINCT "receiptNo") FROM "WarehouseReceiptTote" WHERE "vendorNo" = ${vendorNo}) AS receipts,
      (SELECT count(*) FROM "WarehouseTote" WHERE "vendorNo" = ${vendorNo}) AS totes,
      count(*) AS lots,
      count(*) FILTER (WHERE "hammerPrice" > 0) AS sold,
      coalesce(sum("hammerPrice") FILTER (WHERE "hammerPrice" > 0), 0) AS hammer,
      count(*) FILTER (WHERE coalesce("hammerPrice", 0) = 0 AND collected = false AND "auctionDate" < ${londonDay()}) AS "unsoldUncollected",
      count(*) FILTER (WHERE "auctionDate" >= ${londonDay()}) AS "lotsNow",
      (SELECT count(*) FROM "CatalogueLot" cl WHERE cl.vendor = ${vendorNo}
         AND NOT EXISTS (SELECT 1 FROM "WarehouseItem" wi WHERE wi.barcode = cl.barcode)) AS "hubOnlyLots"
      FROM "WarehouseItem" WHERE "vendorNo" = ${vendorNo}`
    const x = r[0] ?? {}
    const num = (v: unknown) => Number(v ?? 0)
    return { receipts: num(x.receipts), totes: num(x.totes), lots: num(x.lots), sold: num(x.sold), hammer: num(x.hammer),
      unsoldUncollected: num(x.unsoldUncollected), lotsNow: num(x.lotsNow), hubOnlyLots: num(x.hubOnlyLots) }
  } catch (e: any) {
    console.error("[customers] sellerFigures:", e?.message)
    return zero
  }
}

export async function receiptsFor(vendorNo: string | null, limit = 500): Promise<Receipt[]> {
  if (!vendorNo) return []
  try {
    const rows = await prisma.$queryRaw<any[]>`SELECT rt."receiptNo", count(*)::int AS totes, min(rt."bcCreatedAt") AS first,
        coalesce(i.lots, 0)::int AS lots, coalesce(i.sold, 0)::int AS sold, i.sales, i."lastSale"
      FROM "WarehouseReceiptTote" rt
      LEFT JOIN (SELECT "receiptNo", count(*) AS lots, count(*) FILTER (WHERE "hammerPrice" > 0) AS sold,
                        string_agg(DISTINCT "auctionCode", ', ') AS sales, max("auctionDate") AS "lastSale"
                 FROM "WarehouseItem" WHERE "vendorNo" = ${vendorNo} AND "receiptNo" IS NOT NULL GROUP BY 1) i ON i."receiptNo" = rt."receiptNo"
      WHERE rt."vendorNo" = ${vendorNo}
      GROUP BY rt."receiptNo", i.lots, i.sold, i.sales, i."lastSale"
      ORDER BY first DESC NULLS LAST LIMIT ${limit}`
    return rows as Receipt[]
  } catch (e: any) { console.error("[customers] receiptsFor:", e?.message); return [] }
}

export async function totesFor(vendorNo: string | null): Promise<Tote[]> {
  if (!vendorNo) return []
  return prisma.warehouseTote.findMany({
    where: { vendorNo }, orderBy: [{ bcCreatedAt: "desc" }, { toteNo: "asc" }], take: 500,
    select: { toteNo: true, receiptNo: true, location: true, status: true, catalogued: true, bcCreatedAt: true },
  }).catch(() => [])
}

export async function lotsFor(vendorNo: string | null, opts: { sale?: string | null; page?: number; take?: number } = {}): Promise<{ lots: Lot[]; total: number; sales: { code: string; name: string | null; n: number }[] }> {
  if (!vendorNo) return { lots: [], total: 0, sales: [] }
  const take = opts.take ?? 100
  const skip = ((opts.page ?? 1) - 1) * take
  const where = { vendorNo, ...(opts.sale ? { auctionCode: opts.sale } : {}) }
  try {
    const [lots, total, sales] = await Promise.all([
      prisma.warehouseItem.findMany({
        where, orderBy: [{ auctionDate: "desc" }, { lotNo: "asc" }], take, skip,
        select: { uniqueId: true, barcode: true, description: true, auctionCode: true, auctionName: true, auctionDate: true, lotNo: true, hammerPrice: true, collected: true, receiptNo: true },
      }),
      prisma.warehouseItem.count({ where }),
      prisma.$queryRaw<{ code: string; name: string | null; n: bigint }[]>`SELECT "auctionCode" AS code, max("auctionName") AS name, count(*) AS n
        FROM "WarehouseItem" WHERE "vendorNo" = ${vendorNo} AND "auctionCode" IS NOT NULL GROUP BY 1 ORDER BY max("auctionDate") DESC NULLS LAST`,
    ])
    return { lots, total, sales: sales.map(s => ({ ...s, n: Number(s.n) })) }
  } catch (e: any) { console.error("[customers] lotsFor:", e?.message); return { lots: [], total: 0, sales: [] } }
}

/** Lots catalogued in the Hub under this seller that BC's copy doesn't have (by barcode) — on their
 *  way to BC, or never pushed. */
export async function hubOnlyLotsFor(vendorNo: string | null, take = 100): Promise<HubLot[]> {
  if (!vendorNo) return []
  try {
    const rows = await prisma.$queryRaw<any[]>`SELECT cl.id, cl.barcode, cl.title, cl."estimateLow", cl."estimateHigh", cl."createdAt",
        ca.code AS "auctionCode", ca.name AS "auctionName", ca.id AS "auctionId"
      FROM "CatalogueLot" cl JOIN "CatalogueAuction" ca ON ca.id = cl."auctionId"
      WHERE cl.vendor = ${vendorNo} AND NOT EXISTS (SELECT 1 FROM "WarehouseItem" wi WHERE wi.barcode = cl.barcode)
      ORDER BY cl."createdAt" DESC LIMIT ${take}`
    return rows as HubLot[]
  } catch (e: any) { console.error("[customers] hubOnlyLotsFor:", e?.message); return [] }
}

export async function notesFor(customerId: string, take = 500): Promise<Note[] | null> {
  try {
    return await prisma.customerNote.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take })
  } catch { return null } // the table isn't there yet
}

export async function uncollectedFor(buyerNo: string | null): Promise<UncollectedCase[]> {
  if (!buyerNo) return []
  return prisma.uncollectedPaid.findMany({
    where: { buyerNo }, orderBy: [{ paidAt: "desc" }], take: 50,
    select: { id: true, saleCode: true, invoiceNo: true, amountPaid: true, paidAt: true, status: true },
  }).catch(() => [])
}
