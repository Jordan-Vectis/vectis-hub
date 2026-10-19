import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import { htmlToText } from "@/lib/html-text"
import { tokens, pluralVariants } from "@/lib/search-words"

// The test website's search (/search?q=…), over the same three lot databases the Hub's own Website
// Search reads — the SQL shape is copied from app/api/website-search/route.ts, where it was
// measured (about 2.4 s over everything with no text index; a search must have a word):
//   abc — ArchiveLot: every lot sold through the old system, 1999–2023 (always the archive).
//   bc  — WarehouseItem ⟕ BcLotWeb: Business Central's lots — sales that have happened and the
//         ones still to come, as long as the lot has a lot number (the sale page's own rule).
//   hub — CatalogueLot: lots catalogued in the Hub for a PUBLISHED sale that BC doesn't list in a
//         sale yet (once it does, the BC row is the one with the result and this would be a double).
// Simpler than the Hub's: no spelling list or accent forms (they need the SearchWord tables and are
// for staff research), a page of 48, and the three filters the header's select sends.
// Every hit links to the lot on THIS site — the sale's website number comes from ArchiveSale —
// and falls back to the lot's page on vectis.co.uk when we don't hold the sale.
// READ-ONLY, and searchLots never throws: a timeout or a missing table comes back as `note`.

export const SEARCH_PAGE = 48
const MAX_WORDS = 8
const MAX_PAGE = 200

export type SearchFilter = "upcoming" | "past" | "all"
export type SearchSource = "abc" | "bc" | "hub"

export type SearchHit = {
  source: SearchSource
  /** The ArchiveLot row id · the BC unique id (R008728-194) · the Hub lot id — what the lot's page is keyed on. */
  id: string
  /** The old system's LotID · the BC unique id · the Hub lot's barcode (or receipt id). */
  ident: string | null
  saleTitle: string | null
  /** The sale's day, at midnight UTC — format it with site-dates, which reads it in London. */
  saleDate: Date | null
  lot: number | null
  /** The Hub's own title, else the first 120 characters of the description cut at a word. */
  title: string
  /** Plain text — the website's HTML taken out. */
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  /** null = unsold, or not been through a sale yet. */
  hammer: number | null
  photo: string | null
  /** The lot on this site; else on vectis.co.uk (`external`); else null — nothing to open. */
  href: string | null
  external: boolean
  /** The sale is still to come (or running today): show the estimate and LOGIN TO BID, never "Unsold". */
  upcoming: boolean
}

export type SearchResult = {
  rows: SearchHit[]
  total: number
  page: number
  pages: number
  tookMs: number
  /** Why there is less than asked for, in plain words — a timeout, a database not set up here, a long query cut short. */
  note?: string
}

/** The header's select sends upcoming | past | all; anything else means everything. */
export function parseFilter(v: string | null | undefined): SearchFilter {
  return v === "upcoming" || v === "past" ? v : "all"
}

/** The words a query is searched as (tidied, little words dropped) — the page offers them one at a time when nothing is found. */
export function queryWords(q: string): string[] {
  return tokens(q, MAX_WORDS).map(t => t.raw)
}

// ── The SQL ──────────────────────────────────────────────────────────────────────────────────────

/** A LIKE pattern for one word — %, _ and \ in what they typed are matched literally. */
const likeParam = (word: string) => "%" + word.replace(/[\\%_]/g, m => "\\" + m) + "%"

/** EXACT NUMBERS, the Hub search's default ("Class 37" was bringing up every Class 373): a word that
 *  starts or ends with a digit may not have more digits glued on at that end — "37" finds Class 37,
 *  37/5 and No.37, never 373 or 3714; letters may still touch it, so "3514" finds R3514. The ILIKE
 *  stays as the cheap first pass and this pattern only confirms the edges. */
function edgePattern(word: string): string | null {
  const digit = (c: string) => /\d/.test(c)
  const before = digit(word.charAt(0)) ? "(^|[^0-9])" : ""
  const after = digit(word.charAt(word.length - 1)) ? "($|[^0-9])" : ""
  if (!before && !after) return null
  return before + word.replace(/[\\^$.|?*+()[\]{}]/g, m => "\\" + m) + after
}

/** Every word must appear in the lot's text — the word or its plural/singular will do. The ID fields
 *  are searched too, but ONLY when the search looks like an ID (one word with a digit in it), and as
 *  a plain "contains", so part of a barcode still finds it. */
function textConds(text: Prisma.Sql, ids: Prisma.Sql, groups: string[][], idLike: boolean): Prisma.Sql[] {
  const inText = (word: string) => {
    const like = Prisma.sql`${text} ILIKE ${likeParam(word)}`
    const edges = edgePattern(word)
    return edges ? Prisma.sql`(${like} AND ${text} ~* ${edges})` : like
  }
  const hit = (word: string) => (idLike ? Prisma.sql`(${inText(word)} OR ${ids} ILIKE ${likeParam(word)})` : inText(word))
  return groups.map(alts => {
    const ors = alts.map(hit)
    return ors.length === 1 ? ors[0] : Prisma.sql`(${Prisma.join(ors, " OR ")})`
  })
}

const and = (conds: Prisma.Sql[]) => (conds.length ? Prisma.join(conds, " AND ") : Prisma.sql`TRUE`)
const uniq = (xs: string[]) => [...new Set(xs)]

// BC numbers a lot in currentLotNo (lotNo is the number it had at receipt); "0" = not yet numbered.
// A lot is "in a sale" once it has a sale, a date and a number — the sale page lists exactly those,
// so every BC hit has a page to open.
const LOT_NO = Prisma.sql`NULLIF(regexp_replace(COALESCE(NULLIF(w."currentLotNo", '0'), w."lotNo"), '[^0-9]', '', 'g'), '')::int`
const BC_IN_SALE = Prisma.sql`w."auctionCode" IS NOT NULL AND w."auctionDate" IS NOT NULL AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL`
// The sale has happened — the Hub's rule (Databases → BC Database): dated today or earlier.
const BC_PAST = Prisma.sql`w."auctionDate" <= to_char(now(), 'YYYY-MM-DD')`
// Still to come — and still running on the day itself, so from yesterday on.
const BC_UPCOMING = Prisma.sql`w."auctionDate" >= to_char(now() - interval '1 day', 'YYYY-MM-DD')`
// A Hub lot BC already lists in a sale — matched on the BARCODE only, the Hub's standing rule for
// "is this lot in BC" (RULES.md: legacy Hub-minted receipt ids collide with BC's own numbering, so
// a receipt-id match can point at a different lot entirely). Same test as the Hub's Website Search.
const HUB_IN_BC = Prisma.sql`EXISTS (SELECT 1 FROM "WarehouseItem" w WHERE w."barcode" = l."barcode" AND ${BC_IN_SALE})`
const HUB_UPCOMING = Prisma.sql`(NOT a."finished" AND NOT a."complete" AND (a."auctionDate" IS NULL OR a."auctionDate" >= now() - interval '1 day'))`

type Row = {
  source: SearchSource; id: string; ident: string | null; sale_title: string | null; sale_day: string | null
  lot: number | null; title: string | null; description: string | null
  est_low: number | null; est_high: number | null; hammer: number | null
  photo_key: string | null; site_photo: string | null; site_link: string | null
  sale_code: string | null; site_id: number | null; upcoming: boolean | null; total: number
}

// The first 120 characters of the description, cut at a word — never at a full stop, the same rule
// as the lot pages ("Mixed group. A group of…" must not become "Mixed group").
function headline(description: string): string {
  const t = description.replace(/\s+/g, " ").trim()
  if (!t) return "Lot"
  if (t.length <= 120) return t
  const cut = t.slice(0, 120)
  const space = cut.lastIndexOf(" ")
  return (space > 60 ? cut.slice(0, space) : cut).replace(/[,;:\-–]$/, "") + "…"
}

const message = (e: unknown) => String((e as { message?: string })?.message ?? e)
// Before Run Migrations has added ArchiveSale.code (2026-09-22) on an environment, the sale number
// of a BC lot can only come from the website's own copy of it.
const codeColumnMissing = (e: unknown) => /does not exist/i.test(message(e)) && /\bcode\b/i.test(message(e))

/**
 * The lots matching `q` under the filter, newest sale first (soonest first for upcoming), 48 a
 * page. One query: the three sources as UNION ALL branches, the total as a window count over every
 * match, and the sale's website number looked up for the page's rows only. Photos are signed for
 * the page's rows only. Never throws — see `note`.
 */
export async function searchLots({ q, filter, page }: { q: string; filter: SearchFilter; page: number }): Promise<SearchResult> {
  const started = Date.now()
  const pageNo = Math.min(MAX_PAGE, Math.max(1, Math.floor(page) || 1))
  const done = (rows: SearchHit[], total: number, note?: string): SearchResult => ({
    rows, total, page: pageNo, pages: Math.max(1, Math.ceil(total / SEARCH_PAGE)), tookMs: Date.now() - started, ...(note ? { note } : {}),
  })

  const query = (q ?? "").trim().slice(0, 200)
  if (!query) return done([], 0)
  const typed = tokens(query, MAX_WORDS)
  if (typed.length === 0) return done([], 0, "Type a word of at least two letters to search for.")
  const allWords = tokens(query, MAX_WORDS * 4).length
  const cut = allWords > typed.length ? `Only the first ${MAX_WORDS} words were searched.` : undefined

  // Each typed word becomes a group of spellings, any one of which will do: the word as typed and
  // its plural/singular. One word with a digit in it (F073116, R009030-1, a LotID) is probably an
  // ID, so the ID fields are searched too.
  const groups = typed.map(t => uniq([...pluralVariants(t.word), ...(t.raw !== t.word ? [t.raw] : [])]))
  const idLike = typed.length === 1 && /\d/.test(typed[0].word)

  const branches: Prisma.Sql[] = []
  if (filter !== "upcoming") {
    const tc = textConds(Prisma.sql`a."description"`, Prisma.sql`coalesce(a."lotId", '')`, groups, idLike)
    branches.push(Prisma.sql`
      SELECT 'abc'::text AS source, a."id" AS id, a."lotId" AS ident, a."saleTitle" AS sale_title, a."auctionDate"::date AS sale_date,
             a."lot" AS lot, NULL::text AS title, a."description" AS description,
             a."estimateLow"::float8 AS est_low, a."estimateHigh"::float8 AS est_high,
             COALESCE(NULLIF(a."hammerPrice", 0), NULLIF(a."siteHammerPrice", 0))::float8 AS hammer,
             a."photoKey" AS photo_key, a."sitePhoto" AS site_photo, a."siteLink" AS site_link,
             a."auctionId" AS abc_auction_id, NULL::int AS site_sale_id, NULL::text AS sale_code, FALSE AS upcoming
      FROM "ArchiveLot" a
      WHERE ${and(tc)}`)
  }
  {
    const tc = textConds(Prisma.sql`COALESCE(b."description", w."description")`, Prisma.sql`(w."uniqueId" || ' ' || coalesce(w."barcode", ''))`, groups, idLike)
    const when = filter === "past" ? BC_PAST : filter === "upcoming" ? BC_UPCOMING : Prisma.sql`TRUE`
    branches.push(Prisma.sql`
      SELECT 'bc'::text AS source, w."uniqueId" AS id, w."uniqueId" AS ident, w."auctionName" AS sale_title,
             CASE WHEN w."auctionDate" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN to_date(substr(w."auctionDate", 1, 10), 'YYYY-MM-DD') END AS sale_date,
             ${LOT_NO} AS lot, NULL::text AS title, COALESCE(b."description", w."description") AS description,
             w."lowEstimate"::float8 AS est_low, w."highEstimate"::float8 AS est_high,
             COALESCE(NULLIF(w."hammerPrice", 0), NULLIF(b."siteHammerPrice", 0))::float8 AS hammer,
             b."photoKey" AS photo_key, b."sitePhoto" AS site_photo, b."siteLink" AS site_link,
             NULL::int AS abc_auction_id, b."siteSaleId" AS site_sale_id, w."auctionCode" AS sale_code, (${BC_UPCOMING}) AS upcoming
      FROM "WarehouseItem" w LEFT JOIN "BcLotWeb" b ON b."uniqueId" = upper(w."uniqueId")
      WHERE ${BC_IN_SALE} AND ${when} AND ${and(tc)}`)
  }
  if (filter !== "past") {
    // The Hub's lots have a real title as well as a description, and the table is small, so both are searched.
    const tc = textConds(Prisma.sql`(l."title" || ' ' || l."description")`, Prisma.sql`(coalesce(l."barcode", '') || ' ' || coalesce(l."receiptUniqueId", ''))`, groups, idLike)
    const when = filter === "upcoming" ? HUB_UPCOMING : Prisma.sql`TRUE`
    branches.push(Prisma.sql`
      SELECT 'hub'::text AS source, l."id" AS id, COALESCE(l."barcode", l."receiptUniqueId") AS ident, a."name" AS sale_title, a."auctionDate"::date AS sale_date,
             NULL::int AS lot, l."title" AS title, l."description" AS description,
             COALESCE(l."estimateLow", l."aiEstimateLow")::float8 AS est_low, COALESCE(l."estimateHigh", l."aiEstimateHigh")::float8 AS est_high,
             NULLIF(l."hammerPrice", 0)::float8 AS hammer,
             l."imageUrls"[1] AS photo_key, NULL::text AS site_photo, NULL::text AS site_link,
             NULL::int AS abc_auction_id, NULL::int AS site_sale_id, a."code" AS sale_code, ${HUB_UPCOMING} AS upcoming
      FROM "CatalogueLot" l JOIN "CatalogueAuction" a ON a."id" = l."auctionId"
      WHERE a."published" AND NOT ${HUB_IN_BC} AND ${when} AND ${and(tc)}`)
  }
  const union = Prisma.join(branches, " UNION ALL ")

  // Soonest first when looking ahead, newest first when looking back; lots in order within a sale.
  const inner = filter === "upcoming"
    ? Prisma.sql`u.sale_date ASC NULLS LAST, u.source, u.lot ASC NULLS LAST`
    : Prisma.sql`u.sale_date DESC NULLS LAST, u.source, u.lot ASC NULLS LAST`
  const outer = filter === "upcoming"
    ? Prisma.sql`p.sale_day ASC NULLS LAST, p.source, p.lot ASC NULLS LAST`
    : Prisma.sql`p.sale_day DESC NULLS LAST, p.source, p.lot ASC NULLS LAST`

  // The website's number for the lot's sale: an old-system sale by its AuctionID, a BC sale by the
  // number the website collection filed the lot under, else the newest sale carrying its BC code.
  // Looked up OUTSIDE the paged query, so it runs for the page's 49 rows and not every match.
  const siteId = (withCode: boolean) => Prisma.sql`CASE p.source
      WHEN 'abc' THEN (SELECT s."siteId" FROM "ArchiveSale" s WHERE s."auctionId" = p.abc_auction_id LIMIT 1)
      WHEN 'bc' THEN ${withCode
        ? Prisma.sql`COALESCE(p.site_sale_id, (SELECT s."siteId" FROM "ArchiveSale" s WHERE s."code" = p.sale_code ORDER BY s."saleDate" DESC NULLS LAST LIMIT 1))`
        : Prisma.sql`p.site_sale_id`}
    END`

  // A cap on the query, so one pathological search can't tie up a database connection — inside a
  // transaction because the pooler hands out a connection per transaction (SET LOCAL stays put).
  // ONE pass: the total rides along as a window count over every match, computed before the LIMIT.
  const run = (withCode: boolean) => prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = 20000`
    return tx.$queryRaw<Row[]>(Prisma.sql`
      SELECT p.source, p.id, p.ident, p.sale_title, p.sale_day, p.lot, p.title, p.description,
             p.est_low, p.est_high, p.hammer, p.photo_key, p.site_photo, p.site_link, p.sale_code, p.upcoming, p.total,
             ${siteId(withCode)} AS site_id
      FROM (
        SELECT u.source, u.id, u.ident, u.sale_title, to_char(u.sale_date, 'YYYY-MM-DD') AS sale_day, u.lot, u.title, u.description,
               u.est_low, u.est_high, u.hammer, u.photo_key, u.site_photo, u.site_link,
               u.abc_auction_id, u.site_sale_id, u.sale_code, u.upcoming,
               (count(*) OVER ())::int AS total
        FROM (${union}) u
        ORDER BY ${inner}
        LIMIT ${SEARCH_PAGE + 1} OFFSET ${(pageNo - 1) * SEARCH_PAGE}
      ) p
      ORDER BY ${outer}`)
  }, { timeout: 25_000, maxWait: 10_000 })

  let rows: Row[]
  try {
    try { rows = await run(true) }
    catch (e) { if (!codeColumnMissing(e)) throw e; rows = await run(false) }
  } catch (e) {
    const msg = message(e)
    if (/statement timeout|57014|canceling statement|Transaction already closed|timed out/i.test(msg)) {
      return done([], 0, "That search took too long — add another word to narrow it down.")
    }
    if (/does not exist|relation/i.test(msg)) {
      return done([], 0, "The lot archive isn't set up on this environment yet.")
    }
    console.error("site search error:", e)
    return done([], 0, "The search couldn't be run — please try again in a moment.")
  }

  // Only the page's rows get a photo address: our R2 copy (signed, 1 h) first, else the website's
  // own file at "medium"; a Hub photo already held as a full address is used as it is.
  const sign = (key: string) => (key.startsWith("http") ? Promise.resolve(key) : getSignedImageUrl(key, 3600).catch(() => null))
  const hits: SearchHit[] = await Promise.all(rows.slice(0, SEARCH_PAGE).map(async r => {
    const photo = r.photo_key ? await sign(r.photo_key) : r.site_photo ? SITE_IMAGES + r.site_photo.replace("/large/", "/medium/") : null
    // Stored BC text is being cleaned of the website's HTML; this covers any row not done yet.
    const description = htmlToText(r.description)
    const title = (r.title ?? "").replace(/\s+/g, " ").trim() || headline(description)
    let href: string | null = null
    let external = false
    if (r.source === "hub") {
      href = r.sale_code ? `/auctions/${encodeURIComponent(r.sale_code)}/lot/${encodeURIComponent(r.id)}` : null
    } else if (r.site_id != null) {
      href = `/auctions/results/${r.site_id}/lot/${encodeURIComponent(r.id)}`
    } else if (r.site_link) {
      href = `https://www.vectis.co.uk/${r.site_link.replace(/^\/+/, "")}`
      external = true
    }
    return {
      source: r.source,
      id: r.id,
      ident: r.ident,
      saleTitle: r.sale_title,
      saleDate: r.sale_day ? new Date(`${r.sale_day}T00:00:00Z`) : null,
      lot: r.lot,
      title,
      description,
      estimateLow: r.est_low,
      estimateHigh: r.est_high,
      hammer: r.hammer != null && r.hammer > 0 ? r.hammer : null,
      photo,
      href,
      external,
      upcoming: r.hammer == null && !!r.upcoming,
    }
  }))

  // A page past the last match has no row to carry the total, so it reports none.
  const total = Number(rows[0]?.total ?? 0)
  return done(hits, total, cut)
}
