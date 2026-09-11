import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { hasAppAccess } from "@/lib/apps"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import { htmlToText } from "@/lib/html-text"
import {
  foldText, tokens, pluralVariants, accentForms,
  spellingState, spellingVariants, kickWordListBuild,
  type Correction, type SpellingState,
} from "@/lib/search-words"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// 🔎 GET /api/website-search — the tablet cataloguing screen's research tool (Jordan, 2026-09-10:
// "the ultimate search bar to help them research. Our own website's search bar is rubbish").
// It replaced Description Finder, which searched only text and showed no photos or prices.
//
// Three sources, searched together and sorted as one list:
//   abc — ArchiveLot: every lot sold through ABC, 1999–2023, with our copies of the site's photos.
//   bc  — WarehouseItem (the nightly BC sync: sale, lot, estimate, hammer, category) joined to
//         BcLotWeb (the website's full description, photo and link). Only lots that have been
//         through a sale that has happened — the same rule as Databases → BC Database.
//   hub — CatalogueLot: lots catalogued in the Hub that have NOT yet been through a BC sale (once
//         they have, they're in "bc" with a result, so they'd only be doubles).
//
// FORGIVING (Jordan: "if I add a , anywhere it doesn't find that one lot — the search needs to be a
// bit smarter"): the typed words are tidied — punctuation stripped, "&"/"and"/"the" ignored — and
// each word also matches its plural/singular, its accented spellings (marklin → märklin) and, when
// it looks misspelt, its nearest real spellings from our own descriptions. All in lib/search-words.ts.
// ⚠⚠ Every one of those is an extra spelling of the TYPED word; the descriptions are only ever
// matched with a plain ILIKE. Folding them per row (translate) took a search from 3.3 s to 36 s.
//
// ⚠ It never asks vectis.co.uk anything: the site answers the Hub's server with 202 and nothing
// (RULES.md), so this searches OUR copies. They're as fresh as the last office collection.
//
// ⚠ Speed, measured on production 2026-09-10 with no text index: ~2.4 s for a search over all three
// sources, results and counts together, even for "corgi" (115k matches). No trigram index on the
// descriptions (it would add roughly 500 MB) — the next step if it ever feels slow; ask first.
// A search must have a word, a sale or a category — an open-ended sort of 1.2 million rows is not a search.

export type SearchSource = "abc" | "bc" | "hub"

export type SearchResult = {
  source: SearchSource
  id: string
  /** ABC LotID · BC unique ID · the Hub lot's barcode. */
  ident: string | null
  saleCode: string | null
  saleName: string | null
  /** YYYY-MM-DD */
  saleDate: string | null
  lot: number | null
  /** Plain text — the website's HTML is taken out (lib/html-text.ts). */
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  /** null = unsold, or not been through a sale yet (Hub). */
  hammer: number | null
  /** The website's own hammer, when it differs from ours. */
  siteHammer: number | null
  photo: string | null
  photoFull: string | null
  /** Every photo we hold for it (Hub lots can have several). */
  images: string[]
  /** The lot on vectis.co.uk. */
  link: string | null
  category: string | null
  subcategory: string | null
}

export type SearchResponse = {
  results: SearchResult[]
  /** Matches per source — page 1 only. */
  counts: Record<SearchSource, number> | null
  page: number
  hasMore: boolean
  /** Why a source was left out, in plain words (e.g. a hammer filter can't apply to unsold Hub lots). */
  notes: string[]
  /** Words that looked misspelt and the real spellings searched as well — shown on screen. */
  corrections: Correction[]
  /** Whether the spelling list is there yet (it's built the first time it's needed). */
  spelling: SpellingState
}

const PAGE = 30
const MAX_WORDS = 8
const MAX_IMAGES = 12

// ⚠ Built from a FIXED map, never from the query string — it goes into raw SQL.
// ⚠ No result (unsold, or not sold yet) sorts LAST on both price directions: a lot with no hammer
// is not the cheapest, and letting it lead a low-to-high sort buries the genuinely cheap ones.
const ORDERS: Record<string, Prisma.Sql> = {
  newest:      Prisma.sql`u.sale_date DESC NULLS LAST, u.source, u.lot ASC NULLS LAST`,
  oldest:      Prisma.sql`u.sale_date ASC NULLS LAST, u.source, u.lot ASC NULLS LAST`,
  hammer_desc: Prisma.sql`u.hammer DESC NULLS LAST, u.sale_date DESC NULLS LAST`,
  hammer_asc:  Prisma.sql`u.hammer ASC NULLS LAST, u.sale_date DESC NULLS LAST`,
  est_desc:    Prisma.sql`u.est_high DESC NULLS LAST, u.sale_date DESC NULLS LAST`,
  est_asc:     Prisma.sql`u.est_low ASC NULLS LAST, u.sale_date DESC NULLS LAST`,
}

/** A LIKE pattern for one word — %, _ and \ in what they typed are matched literally. */
const likeParam = (word: string) => "%" + word.replace(/[\\%_]/g, m => "\\" + m) + "%"

/** The two "exact" ticks in the panel's filters (Jordan, 2026-09-11). Each governs its own kind of edge. */
type Exact = { numbers: boolean; words: boolean }

/** EXACT NUMBERS ("Class 37" was bringing up every Class 373) — ON by default: a word that starts or
 *  ends with a digit may not have more digits glued on at that end. "37" finds Class 37, 37/5 and
 *  No.37, never 373, 3714 or 37417; letters may still touch it, so "3514" finds R3514.
 *  EXACT WORDS — OFF by default: a word that starts or ends with a letter may not sit inside a longer
 *  word at that end, though its own plural still counts. "bus" finds bus and buses, never business or
 *  omnibus; "car" never carriage. Off, "loco" finding "locomotive" is usually what's wanted.
 *  Returns a case-insensitive POSIX pattern, or null when neither rule touches this word.
 *  ⚠ The ILIKE stays as the cheap first pass and the pattern only confirms the edges — measured on
 *  production, no slower (class 37: 2.4 s, 13,414 lots → 3,406). */
function edgePattern(word: string, exact: Exact): string | null {
  const first = word.charAt(0), last = word.charAt(word.length - 1)
  const digit = (c: string) => /\d/.test(c), letter = (c: string) => /\p{L}/u.test(c)
  const before = digit(first) && exact.numbers ? "(^|[^0-9])" : letter(first) && exact.words ? "(^|[^[:alnum:]])" : ""
  const after = digit(last) && exact.numbers ? "($|[^0-9])" : letter(last) && exact.words ? "(s|es)?($|[^[:alnum:]])" : ""
  if (!before && !after) return null
  return before + word.replace(/[\\^$.|?*+()[\]{}]/g, m => "\\" + m) + after
}

/** Every word group must appear in the lot's description — any one of its spellings will do (the
 *  word, its plural/singular, an accented or corrected spelling). None of the "without" words may.
 *  The ID fields are searched too, but ONLY when the search looks like an ID — and always as a plain
 *  "contains", so part of a barcode still finds it.
 *  ⚠ Measured 2026-09-10: gluing description + IDs + sale name into one string per row made every
 *  search take ~6 s; the description alone is ~2.4 s. Sale names have their own filter. */
function textConds(desc: Prisma.Sql, ids: Prisma.Sql, groups: string[][], without: string[], idLike: boolean, exact: Exact): Prisma.Sql[] {
  const inDesc = (word: string) => {
    const like = Prisma.sql`${desc} ILIKE ${likeParam(word)}`
    const edges = edgePattern(word, exact)
    return edges ? Prisma.sql`(${like} AND ${desc} ~* ${edges})` : like
  }
  const hit = (word: string) => (idLike ? Prisma.sql`(${inDesc(word)} OR ${ids} ILIKE ${likeParam(word)})` : inDesc(word))
  const c: Prisma.Sql[] = []
  for (const alts of groups) {
    const ors = alts.map(hit)
    c.push(ors.length === 1 ? ors[0] : Prisma.sql`(${Prisma.join(ors, " OR ")})`)
  }
  for (const w of without) c.push(Prisma.sql`NOT coalesce(${inDesc(w)}, false)`)
  return c
}

const and = (conds: Prisma.Sql[]) => (conds.length ? Prisma.join(conds, " AND ") : Prisma.sql`TRUE`)
const uniq = (xs: string[]) => [...new Set(xs)]

const num = (v: string | null) => {
  if (v == null || v.trim() === "") return null
  const n = Number(v.replace(/[£,\s]/g, ""))
  return Number.isFinite(n) && n >= 0 ? n : null
}
const year = (v: string | null) => (v && /^\d{4}$/.test(v) && +v >= 1900 && +v <= 2100 ? +v : null)

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    // Read fresh — a session token can be hours old, and removed access must not still open the door.
    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true } })
    if (!me || !hasAppAccess(me.role, me.allowedApps, "CATALOGUING")) {
      return NextResponse.json({ error: "Website Search is part of Cataloguing, which your account can't open." }, { status: 403 })
    }

    const sp = req.nextUrl.searchParams
    const q = (sp.get("q") ?? "").trim().slice(0, 200)
    const exact = sp.get("phrase") === "1"
    const typed = tokens(q, MAX_WORDS)
    const words = typed.map(t => t.word)
    const phraseText = q.toLowerCase().replace(/\s+/g, " ").trim()
    // The phrase as typed, and with its accents folded.
    const phrase = exact && phraseText.length >= 2 ? uniq([phraseText, foldText(phraseText)]) : null
    const without = uniq(tokens(sp.get("without") ?? "", MAX_WORDS).flatMap(t => [t.word, t.raw]))
    // Exact numbers is ON unless the panel's tick says otherwise ("37" ≠ 373); exact words is OFF
    // unless ticked ("bus" ≠ business).
    const matchRules: Exact = { numbers: sp.get("whole") !== "0", words: sp.get("words") === "1" }
    const sale = (sp.get("sale") ?? "").trim().slice(0, 100)
    const cat = (sp.get("cat") ?? "").trim().slice(0, 100)
    const sub = (sp.get("sub") ?? "").trim().slice(0, 100)
    const hmin = num(sp.get("hmin")), hmax = num(sp.get("hmax"))
    // ONE figure, not from/to (Jordan, 2026-09-11: a from/to pair "sorta doesn't make sense" against a
    // low–high estimate) — a lot is shown when its estimate COVERS it.
    const est = num(sp.get("est"))
    const yfrom = year(sp.get("yfrom")), yto = year(sp.get("yto"))
    const status = sp.get("status") === "sold" ? "sold" : sp.get("status") === "unsold" ? "unsold" : ""
    const photoOnly = sp.get("photo") === "1"
    const orderBy = ORDERS[sp.get("order") ?? ""] ?? ORDERS.newest
    const page = Math.min(200, Math.max(1, parseInt(sp.get("page") ?? "1") || 1))
    const asked = new Set((sp.get("src") ?? "abc,bc,hub").split(",").map(s => s.trim()).filter(Boolean))

    if (!phrase && !words.length && !sale && !cat) {
      return NextResponse.json({ error: "Type a word or two to search for (or pick a sale or a category)." }, { status: 400 })
    }

    // The spelling list is built the first time it's needed (and refreshed weekly) — never waited for.
    kickWordListBuild()
    const spell = await spellingState()

    // Which sources can this search apply to at all?
    const notes: string[] = []
    let useAbc = asked.has("abc"), useBc = asked.has("bc"), useHub = asked.has("hub")
    if (useAbc && (cat || sub)) { useAbc = false; notes.push("ABC lots have no category, so a category filter leaves them out.") }
    if (useHub && (hmin != null || hmax != null || status)) { useHub = false; notes.push("Hub lots haven't been through a sale yet, so hammer and sold/unsold filters leave them out.") }
    if (!useAbc && !useBc && !useHub) {
      return NextResponse.json({ results: [], counts: { abc: 0, bc: 0, hub: 0 }, page, hasMore: false, notes, corrections: [], spelling: spell.state } satisfies SearchResponse)
    }

    // Each typed word becomes a group of spellings, any one of which will do.
    const ready = spell.state === "ready"
    const sv = !phrase && words.length && ready
      ? await spellingVariants(words)
      : { extra: new Map<string, string[]>(), corrections: [] as Correction[] }
    const spelt: string[][] = phrase ? [phrase] : typed.map(t => uniq([
      ...pluralVariants(t.word),
      ...(t.raw !== t.word ? [t.raw] : []),                      // "kämmer" as typed
      ...(sv.extra.get(t.word) ?? []).flatMap(pluralVariants),   // a corrected spelling
    ]))
    const forms = ready && !phrase ? await accentForms(spelt.flat()) : new Map<string, string[]>()
    const groups = spelt.map(alts => uniq([...alts, ...alts.flatMap(a => forms.get(a) ?? [])]))   // "märklin" for marklin
    // One word with a digit in it — F073116, R009030-1, a LotID — is probably an ID, so the ID fields are searched too.
    const idLike = !phrase && words.length === 1 && /\d/.test(words[0])

    const branches: Prisma.Sql[] = []
    if (useAbc) {
      const tc = textConds(Prisma.sql`a."description"`, Prisma.sql`coalesce(a."lotId", '')`, groups, without, idLike, matchRules)
      branches.push(Prisma.sql`
        SELECT 'abc'::text AS source, a."id", a."lotId" AS ident, a."auctionId"::text AS sale_code, a."saleTitle" AS sale_name,
               a."auctionDate"::date AS sale_date, a."lot" AS lot, a."description" AS description,
               a."estimateLow"::float8 AS est_low, a."estimateHigh"::float8 AS est_high, NULLIF(a."hammerPrice", 0)::float8 AS hammer,
               a."siteHammerPrice"::float8 AS site_hammer, a."photoKey" AS photo_key, a."photoXlKey" AS photo_xl_key,
               a."sitePhoto" AS site_photo, a."siteLink" AS site_link, NULL::text AS category, NULL::text AS subcategory, NULL::text[] AS images
        FROM "ArchiveLot" a
        WHERE ${and(tc)}`)
    }
    if (useBc) {
      const tc = textConds(Prisma.sql`COALESCE(b."description", w."description")`, Prisma.sql`(w."uniqueId" || ' ' || coalesce(w."barcode", ''))`, groups, without, idLike, matchRules)
      const lotNo = Prisma.sql`NULLIF(regexp_replace(COALESCE(NULLIF(w."currentLotNo", '0'), w."lotNo"), '[^0-9]', '', 'g'), '')::int`
      // Same "has been through a sale that has happened" rule as Databases → BC Database.
      const base = Prisma.sql`w."auctionCode" IS NOT NULL AND w."auctionDate" IS NOT NULL AND w."auctionDate" <= to_char(now(), 'YYYY-MM-DD') AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL`
      branches.push(Prisma.sql`
        SELECT 'bc'::text AS source, w."id", w."uniqueId" AS ident, w."auctionCode" AS sale_code, w."auctionName" AS sale_name,
               CASE WHEN w."auctionDate" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN to_date(substr(w."auctionDate", 1, 10), 'YYYY-MM-DD') END AS sale_date,
               ${lotNo} AS lot, COALESCE(b."description", w."description") AS description,
               w."lowEstimate"::float8 AS est_low, w."highEstimate"::float8 AS est_high, NULLIF(w."hammerPrice", 0)::float8 AS hammer,
               b."siteHammerPrice"::float8 AS site_hammer, b."photoKey" AS photo_key, b."photoXlKey" AS photo_xl_key,
               b."sitePhoto" AS site_photo, b."siteLink" AS site_link, w."category" AS category, w."subcategory" AS subcategory, NULL::text[] AS images
        FROM "WarehouseItem" w LEFT JOIN "BcLotWeb" b ON b."uniqueId" = upper(w."uniqueId")
        WHERE ${base} AND ${and(tc)}`)
    }
    if (useHub) {
      const tc = textConds(Prisma.sql`l."description"`, Prisma.sql`(coalesce(l."barcode", '') || ' ' || coalesce(l."receiptUniqueId", ''))`, groups, without, idLike, matchRules)
      branches.push(Prisma.sql`
        SELECT 'hub'::text AS source, l."id", COALESCE(l."barcode", l."receiptUniqueId") AS ident, a."code" AS sale_code, a."name" AS sale_name,
               a."auctionDate"::date AS sale_date, NULL::int AS lot, l."description" AS description,
               COALESCE(l."estimateLow", l."aiEstimateLow")::float8 AS est_low, COALESCE(l."estimateHigh", l."aiEstimateHigh")::float8 AS est_high,
               NULL::float8 AS hammer, NULL::float8 AS site_hammer, l."imageUrls"[1] AS photo_key, NULL::text AS photo_xl_key,
               NULL::text AS site_photo, NULL::text AS site_link, l."category" AS category, l."subCategory" AS subcategory, l."imageUrls" AS images
        FROM "CatalogueLot" l JOIN "CatalogueAuction" a ON a."id" = l."auctionId"
        WHERE l."description" <> ''
          AND NOT EXISTS (SELECT 1 FROM "WarehouseItem" w WHERE w."barcode" = l."barcode" AND w."auctionDate" IS NOT NULL AND w."auctionDate" <= to_char(now(), 'YYYY-MM-DD'))
          AND ${and(tc)}`)
    }
    const union = Prisma.join(branches, " UNION ALL ")

    const outer: Prisma.Sql[] = []
    if (yfrom != null) outer.push(Prisma.sql`u.sale_date >= make_date(${yfrom}::int, 1, 1)`)
    if (yto != null) outer.push(Prisma.sql`u.sale_date < make_date(${yto + 1}::int, 1, 1)`)
    if (hmin != null) outer.push(Prisma.sql`u.hammer >= ${hmin}`)
    if (hmax != null) outer.push(Prisma.sql`u.hammer <= ${hmax}`)
    // "Estimate around £100": low ≤ 100 ≤ high. A lot with only one side of an estimate uses it for both.
    if (est != null) outer.push(Prisma.sql`COALESCE(u.est_low, u.est_high) <= ${est} AND COALESCE(u.est_high, u.est_low) >= ${est}`)
    if (status === "sold") outer.push(Prisma.sql`u.hammer > 0`)
    if (status === "unsold") outer.push(Prisma.sql`u.hammer IS NULL`)
    if (sale) outer.push(Prisma.sql`(u.sale_name ILIKE ${likeParam(sale)} OR u.sale_code ILIKE ${likeParam(sale)})`)
    if (cat) outer.push(Prisma.sql`u.category = ${cat}`)
    if (sub) outer.push(Prisma.sql`u.subcategory = ${sub}`)
    if (photoOnly) outer.push(Prisma.sql`(u.photo_key IS NOT NULL OR u.site_photo IS NOT NULL)`)
    const where = and(outer)

    type Row = {
      source: SearchSource; id: string; ident: string | null; sale_code: string | null; sale_name: string | null; sale_day: string | null
      lot: number | null; description: string | null; est_low: number | null; est_high: number | null; hammer: number | null; site_hammer: number | null
      photo_key: string | null; photo_xl_key: string | null; site_photo: string | null; site_link: string | null
      category: string | null; subcategory: string | null; images: string[] | null
      n_abc: number; n_bc: number; n_hub: number
    }

    // ⚠ A cap on the query, so one pathological search can't tie up a database connection. Inside a
    // transaction because the pooler hands out a connection per transaction (SET LOCAL stays put).
    // ⚠ ONE pass: the per-source counts ride along as window totals over EVERY match (computed before
    // the LIMIT), so they cost nothing extra — a separate count query doubled the time.
    // ⚠ FILTER per source, not PARTITION BY source — a partition only reports sources that happen to
    // have a row on this page, so Hub's count went missing whenever no Hub lot made the first 30.
    const rows = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = 20000`
      return tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT u.source, u.id, u.ident, u.sale_code, u.sale_name, to_char(u.sale_date, 'YYYY-MM-DD') AS sale_day, u.lot, u.description,
               u.est_low, u.est_high, u.hammer, u.site_hammer, u.photo_key, u.photo_xl_key, u.site_photo, u.site_link,
               u.category, u.subcategory, u.images,
               (count(*) FILTER (WHERE u.source = 'abc') OVER ())::int AS n_abc,
               (count(*) FILTER (WHERE u.source = 'bc')  OVER ())::int AS n_bc,
               (count(*) FILTER (WHERE u.source = 'hub') OVER ())::int AS n_hub
        FROM (${union}) u WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${PAGE + 1} OFFSET ${(page - 1) * PAGE}`)
    }, { timeout: 25_000, maxWait: 10_000 })

    const sign = (key: string) => getSignedImageUrl(key, 3600).catch(() => null)
    const results: SearchResult[] = await Promise.all(rows.slice(0, PAGE).map(async r => {
      let images: string[] = []
      let photo: string | null = null
      let photoFull: string | null = null
      if (r.source === "hub") {
        images = (await Promise.all((r.images ?? []).slice(0, MAX_IMAGES).map(sign))).filter((u): u is string => !!u)
        photo = images[0] ?? null
        photoFull = photo
      } else {
        photo = r.photo_key ? await sign(r.photo_key) : r.site_photo ? SITE_IMAGES + r.site_photo.replace("/large/", "/medium/") : null
        photoFull = r.photo_xl_key ? (await sign(r.photo_xl_key)) ?? photo : r.site_photo ? SITE_IMAGES + r.site_photo.replace("/large/", "/xlarge/") : photo
        if (photoFull) images = [photoFull]
      }
      return {
        source: r.source,
        id: r.id,
        ident: r.ident,
        saleCode: r.sale_code,
        saleName: r.sale_name,
        saleDate: r.sale_day,
        lot: r.lot,
        // Stored BC text is being cleaned of the website's HTML; this covers any row not done yet.
        description: htmlToText(r.description),
        estimateLow: r.est_low,
        estimateHigh: r.est_high,
        hammer: r.hammer,
        siteHammer: r.site_hammer != null && r.site_hammer !== r.hammer ? r.site_hammer : null,
        photo,
        photoFull,
        images,
        link: r.site_link ? `https://www.vectis.co.uk/${r.site_link.replace(/^\/+/, "")}` : null,
        category: r.category,
        subcategory: r.subcategory,
      }
    }))

    // Page 1 only; a page past the last match has no rows to carry the totals, so it reports none.
    const first = rows[0]
    const counts: SearchResponse["counts"] = page === 1
      ? { abc: Number(first?.n_abc ?? 0), bc: Number(first?.n_bc ?? 0), hub: Number(first?.n_hub ?? 0) }
      : null
    return NextResponse.json({
      results, counts, page, hasMore: rows.length > PAGE, notes, corrections: sv.corrections, spelling: spell.state,
    } satisfies SearchResponse)
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (/statement timeout|57014|canceling statement/i.test(msg)) {
      return NextResponse.json({ error: "That search took too long — add another word or a filter to narrow it down." }, { status: 503 })
    }
    if (/does not exist|relation/i.test(msg)) {
      return NextResponse.json({ error: "One of the lot databases isn't set up on this environment yet." }, { status: 503 })
    }
    console.error("website-search error:", e)
    return NextResponse.json({ error: "The search couldn't be run — try again in a moment." }, { status: 500 })
  }
}
