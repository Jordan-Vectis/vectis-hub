import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import { htmlToText } from "@/lib/html-text"

// Auction results for the TEST website, read from the Hub's own sale databases: every sale in
// ArchiveSale (Databases → Sales), old-system lots from ArchiveLot (Databases → ABC Database) and
// Business Central lots from WarehouseItem ⟕ BcLotWeb (Databases → BC Database) — the same rules
// those pages use. Everything here is READ-ONLY, and nothing outside app/(site) depends on it: the
// site is a play area (see the "fake test website" memory entry), so it may read the Hub's data
// but must never change it or change anything shared.

export const SALES_PAGE = 24
export const LOTS_PAGE = 48

export type ResultSale = {
  siteId: number; auctionId: number | null; title: string; saleDate: Date | null; lots: number
  finished: boolean; code: string | null; heroUrl: string | null; heroKey: string | null
  /** The cover picture to show — our R2 copy (signed, 1 h) first, else the website's own file. */
  photo: string | null
}

export type ResultLot = {
  id: string; lot: number | null; description: string
  estimateLow: number | null; estimateHigh: number | null
  /** The hammer price; null = unsold (or no result held for it). */
  hammer: number | null
  photo: string | null; photoFull: string | null
}

export type ResultSummary = { lots: number; sold: number; hammerTotal: number }

// Only sales that have happened: the website's own "finished" flag, or a date that has passed.
const HAPPENED = Prisma.sql`(s."finished" OR (s."saleDate" IS NOT NULL AND s."saleDate" < now()))`
const SALE_ORDER = Prisma.sql`s."saleDate" DESC NULLS LAST, s."siteId" DESC`
const COLS_FULL = Prisma.sql`s."siteId", s."auctionId", s."title", s."saleDate", s."lots", s."finished", s."code", s."heroUrl", s."heroKey"`
// Until Run Migrations has added the 2026-09-22 columns (sale code + cover picture) on an
// environment, the sales still list — without them.
const COLS_BASIC = Prisma.sql`s."siteId", s."auctionId", s."title", s."saleDate", s."lots", s."finished", NULL::text AS "code", NULL::text AS "heroUrl", NULL::text AS "heroKey"`
const missingColumns = (e: unknown) => /heroUrl|heroKey|"code"/i.test(String((e as { message?: string })?.message ?? ""))

type SaleRow = Omit<ResultSale, "photo">

async function withPhoto(rows: SaleRow[]): Promise<ResultSale[]> {
  return Promise.all(rows.map(async r => ({
    ...r,
    photo: r.heroKey ? await getSignedImageUrl(r.heroKey, 3600).catch(() => null)
      : r.heroUrl ? SITE_IMAGES + r.heroUrl : null,
  })))
}

/** The View Results list: sales that have happened, newest first, searchable by title (and BC code). */
export async function listResultSales(opts: { search?: string; page?: number }): Promise<{ rows: ResultSale[]; total: number; page: number; pages: number }> {
  const q = (opts.search ?? "").trim()
  const page = Math.max(1, opts.page ?? 1)
  const like = `%${q}%`
  const run = async (cols: Prisma.Sql, searchCode: boolean) => {
    const where = !q ? HAPPENED
      : searchCode ? Prisma.sql`${HAPPENED} AND (s."title" ILIKE ${like} OR s."code" ILIKE ${like})`
      : Prisma.sql`${HAPPENED} AND s."title" ILIKE ${like}`
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<SaleRow[]>`SELECT ${cols} FROM "ArchiveSale" s WHERE ${where} ORDER BY ${SALE_ORDER} LIMIT ${SALES_PAGE} OFFSET ${(page - 1) * SALES_PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "ArchiveSale" s WHERE ${where}`,
    ])
    return { rows, total: Number(count[0]?.n ?? 0) }
  }
  let r: { rows: SaleRow[]; total: number }
  try { r = await run(COLS_FULL, true) }
  catch (e) { if (!missingColumns(e)) throw e; r = await run(COLS_BASIC, false) }
  return { rows: await withPhoto(r.rows), total: r.total, page, pages: Math.max(1, Math.ceil(r.total / SALES_PAGE)) }
}

/** Every dated sale that has happened, for the calendar sidebar — a day links to that sale's results. */
export async function resultCalendarEntries(): Promise<{ date: string; href: string }[]> {
  try {
    const rows = await prisma.$queryRaw<{ siteId: number; saleDate: Date }[]>`SELECT s."siteId", s."saleDate" FROM "ArchiveSale" s WHERE s."saleDate" IS NOT NULL AND ${HAPPENED} ORDER BY s."saleDate" DESC`
    return rows.map(r => ({ date: r.saleDate.toISOString(), href: `/auctions/results/${r.siteId}` }))
  } catch {
    return []
  }
}

export async function getResultSale(siteId: number): Promise<ResultSale | null> {
  const run = (cols: Prisma.Sql) => prisma.$queryRaw<SaleRow[]>`SELECT ${cols} FROM "ArchiveSale" s WHERE s."siteId" = ${siteId} LIMIT 1`
  let rows: SaleRow[]
  try { rows = await run(COLS_FULL) }
  catch (e) { if (!missingColumns(e)) throw e; rows = await run(COLS_BASIC) }
  if (!rows[0]) return null
  return (await withPhoto(rows))[0]
}

// ── Lots ────────────────────────────────────────────────────────────────────────────────────────

// BC numbers a lot in currentLotNo (lotNo is the number it had at receipt); "0" = not yet numbered.
const LOT_NO = Prisma.sql`NULLIF(regexp_replace(COALESCE(NULLIF(w."currentLotNo", '0'), w."lotNo"), '[^0-9]', '', 'g'), '')::int`
const BC_FROM = Prisma.sql`FROM "WarehouseItem" w LEFT JOIN "BcLotWeb" b ON b."uniqueId" = upper(w."uniqueId")`

type LotRow = {
  id: string; lot: number | null; shortDesc: string | null; longDesc: string | null
  estimateLow: number | null; estimateHigh: number | null
  hammerPrice: number | null; siteHammerPrice: number | null
  photoKey: string | null; photoXlKey: string | null; sitePhoto: string | null
}

async function finishLots(rows: LotRow[]): Promise<ResultLot[]> {
  return Promise.all(rows.map(async r => {
    // Our R2 copy first (signed), else the website's own file; the full-size copy only opens in the viewer.
    const photo = r.photoKey ? await getSignedImageUrl(r.photoKey, 3600).catch(() => null)
      : r.sitePhoto ? SITE_IMAGES + r.sitePhoto.replace("/large/", "/medium/") : null
    const photoFull = r.photoXlKey ? await getSignedImageUrl(r.photoXlKey, 3600).catch(() => photo)
      : r.sitePhoto ? SITE_IMAGES + r.sitePhoto.replace("/large/", "/xlarge/") : photo
    // The website hands BC descriptions over as HTML; the old system's are plain (the cleaner leaves plain text alone).
    const description = htmlToText(r.longDesc || r.shortDesc || "")
    const hammer = r.hammerPrice ?? r.siteHammerPrice ?? null
    return {
      id: r.id, lot: r.lot, description,
      estimateLow: r.estimateLow, estimateHigh: r.estimateHigh,
      hammer: hammer != null && hammer > 0 ? hammer : null,
      photo, photoFull,
    }
  }))
}

/**
 * The Business Central sale code behind a sale on the website — recorded on the sale itself since
 * 2026-09-22, or read off any lot the website collection filed under this sale number.
 */
async function resolveBcCode(sale: ResultSale): Promise<string | null> {
  if (sale.code) return sale.code
  try {
    const r = await prisma.$queryRaw<{ auctionCode: string }[]>`SELECT "auctionCode" FROM "BcLotWeb" WHERE "siteSaleId" = ${sale.siteId} AND "auctionCode" IS NOT NULL LIMIT 1`
    return r[0]?.auctionCode ?? null
  } catch {
    return null
  }
}

const empty = (page: number) => ({ rows: [] as ResultLot[], total: 0, page, pages: 1, source: "none" as const })

/** A sale's lots in lot order — photo, description, estimate and hammer — searchable by lot number or words. */
export async function getResultLots(sale: ResultSale, opts: { search?: string; page?: number }): Promise<{ rows: ResultLot[]; total: number; page: number; pages: number; source: "abc" | "bc" | "none" }> {
  const q = (opts.search ?? "").trim()
  const page = Math.max(1, opts.page ?? 1)
  const off = (page - 1) * LOTS_PAGE
  const like = `%${q}%`
  const lotNo = /^\d+$/.test(q) ? Number(q) : null
  const finish = async (rows: LotRow[], count: { n: bigint }[], source: "abc" | "bc") => {
    const total = Number(count[0]?.n ?? 0)
    return { rows: await finishLots(rows), total, page, pages: Math.max(1, Math.ceil(total / LOTS_PAGE)), source }
  }

  if (sale.auctionId != null) {
    // An old-system (ABC) sale: its lots came from the Crystal report, keyed by the sheet's AuctionID —
    // the first number in the website's own address for the sale.
    const base = Prisma.sql`"auctionId" = ${sale.auctionId}`
    const where = !q ? base
      : lotNo != null ? Prisma.sql`${base} AND ("lot" = ${lotNo} OR "description" ILIKE ${like})`
      : Prisma.sql`${base} AND "description" ILIKE ${like}`
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<LotRow[]>`SELECT "id", "lot", NULL::text AS "shortDesc", "description" AS "longDesc", "estimateLow", "estimateHigh", "hammerPrice", "siteHammerPrice", "photoKey", "photoXlKey", "sitePhoto" FROM "ArchiveLot" WHERE ${where} ORDER BY "lot" ASC, "id" ASC LIMIT ${LOTS_PAGE} OFFSET ${off}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "ArchiveLot" WHERE ${where}`,
    ])
    return finish(rows, count, "abc")
  }

  // A Business Central sale. The BC sync (WarehouseItem) is the complete list of its lots and holds the
  // hammer prices; the website's copy (BcLotWeb) adds the full description and the photo.
  const code = await resolveBcCode(sale)
  if (code) {
    const base = Prisma.sql`w."auctionCode" = ${code} AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL`
    const where = !q ? base
      : lotNo != null ? Prisma.sql`${base} AND (${LOT_NO} = ${lotNo} OR w."description" ILIKE ${like} OR b."description" ILIKE ${like})`
      : Prisma.sql`${base} AND (w."description" ILIKE ${like} OR b."description" ILIKE ${like})`
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<LotRow[]>`SELECT w."id", ${LOT_NO} AS "lot", w."description" AS "shortDesc", b."description" AS "longDesc", w."lowEstimate" AS "estimateLow", w."highEstimate" AS "estimateHigh", NULLIF(w."hammerPrice", 0) AS "hammerPrice", b."siteHammerPrice", b."photoKey", b."photoXlKey", b."sitePhoto" ${BC_FROM} WHERE ${where} ORDER BY ${LOT_NO} ASC NULLS LAST, w."uniqueId" ASC LIMIT ${LOTS_PAGE} OFFSET ${off}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n ${BC_FROM} WHERE ${where}`,
    ])
    return finish(rows, count, "bc")
  }

  // No code known for this sale: whatever the website collection filed under its sale number.
  try {
    const base = Prisma.sql`b."siteSaleId" = ${sale.siteId}`
    const where = !q ? base
      : lotNo != null ? Prisma.sql`${base} AND (b."lotNumber" = ${lotNo} OR b."description" ILIKE ${like})`
      : Prisma.sql`${base} AND b."description" ILIKE ${like}`
    const from = Prisma.sql`FROM "BcLotWeb" b LEFT JOIN "WarehouseItem" w ON upper(w."uniqueId") = b."uniqueId"`
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<LotRow[]>`SELECT b."uniqueId" AS "id", b."lotNumber" AS "lot", w."description" AS "shortDesc", b."description" AS "longDesc", w."lowEstimate" AS "estimateLow", w."highEstimate" AS "estimateHigh", NULLIF(w."hammerPrice", 0) AS "hammerPrice", b."siteHammerPrice", b."photoKey", b."photoXlKey", b."sitePhoto" ${from} WHERE ${where} ORDER BY b."lotNumber" ASC NULLS LAST, b."uniqueId" ASC LIMIT ${LOTS_PAGE} OFFSET ${off}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n ${from} WHERE ${where}`,
    ])
    return finish(rows, count, "bc")
  } catch {
    return empty(page)
  }
}

/** Sold count and hammer total for the sale's banner — null when the figures can't be read. */
export async function getResultSummary(sale: ResultSale): Promise<ResultSummary | null> {
  try {
    let r: { n: bigint; sold: bigint; total: number | null }[]
    if (sale.auctionId != null) {
      r = await prisma.$queryRaw`SELECT count(*)::bigint AS n, count(*) FILTER (WHERE "hammerPrice" > 0)::bigint AS sold, sum("hammerPrice") FILTER (WHERE "hammerPrice" > 0)::float8 AS total FROM "ArchiveLot" WHERE "auctionId" = ${sale.auctionId}`
    } else {
      const code = await resolveBcCode(sale)
      if (code) {
        r = await prisma.$queryRaw`SELECT count(*)::bigint AS n, count(*) FILTER (WHERE w."hammerPrice" > 0)::bigint AS sold, sum(w."hammerPrice") FILTER (WHERE w."hammerPrice" > 0)::float8 AS total FROM "WarehouseItem" w WHERE w."auctionCode" = ${code} AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL`
      } else {
        r = await prisma.$queryRaw`SELECT count(*)::bigint AS n, count(*) FILTER (WHERE b."siteHammerPrice" > 0)::bigint AS sold, sum(b."siteHammerPrice") FILTER (WHERE b."siteHammerPrice" > 0)::float8 AS total FROM "BcLotWeb" b WHERE b."siteSaleId" = ${sale.siteId}`
      }
    }
    const a = r[0]
    if (!a) return null
    return { lots: Number(a.n), sold: Number(a.sold), hammerTotal: a.total ?? 0 }
  } catch {
    return null
  }
}
