import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { uploadBufferToR2 } from "@/lib/r2"

// Lot Archive ← vectis.co.uk. Two resumable server-side jobs, started from the
// archive page and left to run (they survive the tab closing, not a redeploy — press
// the button again and they carry on from where they were):
//
//   "site"   Walk the website's own sale ids upwards. Each sale's page gives its title
//            and date; the site's lot feed (the same JSON its catalogue pages load)
//            gives every lot with its lot number, the OLD SYSTEM'S LotID (the site
//            calls it unique_id), its own lot id + link, the photo path and hammer.
//            Matched to the archive by AuctionID (the first number of the sale's URL,
//            e.g. /bidding/724-doll-teddy-bear-sale-683 = AuctionID 724, site id 683)
//            + LotID. ⚠ ANNOTATE ONLY: the archive's rows come from the old system's
//            export; the site's figures sit beside them, and nothing is created from it.
//   "photos" Copy each lot's main photo into R2 so the pictures are ours whatever
//            happens to the site. ~23 KB each at "large".
//
// Measured 2026-09-07: site id 15 = 12 Dec 2008 Model Train Sale, 609 lots in one
// feed request, every one with a LotID; photos are served straight from S3 by LotID
// (checked 2008, 2019 and 2023 lots). Oldest sale on the site is Feb 2006.
// ⚠ Be polite: one request every PAUSE ms, an honest User-Agent, only finished sales.

const SITE = "https://www.vectis.co.uk"
import { htmlToText } from "@/lib/html-text"

export const SITE_IMAGES = "https://am-s3-bucket-assets.s3.eu-west-2.amazonaws.com/vectis/prod/"
const UA = "VectisHub archive (IT@vectis.co.uk)"

// ⚠⚠ THE SITE ANSWERS RAILWAY DIFFERENTLY FROM THE OFFICE. Measured 2026-09-09: the same request
// that returns 774 lots for sale 2 from the office returns **202 with an empty body** for every id
// from the Railway server. The lot feed is a Joomla AJAX task, and a request that does not look
// like the site's own page calling it is the likeliest reason it is being quietly discarded — so
// these are the headers that call would carry. If it still comes back empty, the block is at the
// website's end and needs whoever runs it to let the server through; the "found no sales at all"
// message says so rather than pretending the walk finished.
const FEED_HEADERS = {
  "User-Agent":       UA,
  "Content-Type":     "application/x-www-form-urlencoded",
  "Accept":           "application/json, text/javascript, */*; q=0.01",
  "Accept-Language":  "en-GB,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "Referer":          `${SITE}/`,
  "Origin":           SITE,
} as const
const PAUSE = 250
const MISSES_TO_STOP = 40          // this many empty site ids in a row = we're past the newest sale
const FEED_PAGE = 500

type Ctl = { stop: boolean }
const active = new Map<string, Ctl>()
export const isActive = (id: string) => active.has(id)
export function requestStop(id: string): boolean { const c = active.get(id); if (c) c.stop = true; return !!c }

export async function getJob(id: "site" | "photos" | "heroes") {
  const j = await prisma.archiveJob.findUnique({ where: { id } })
  return j ? { ...j, running: isActive(id) } : null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, " ")
const num = (v: unknown): number | null => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[£$,\s]/g, "")); return Number.isFinite(n) ? n : null }
const str = (v: unknown): string | null => { const s = v == null ? "" : String(v).trim(); return s ? s : null }

async function fetchSalePage(siteId: number): Promise<{ title: string; date: Date | null }> {
  const res = await fetch(`${SITE}/bidding/0-x-${siteId}`, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-GB,en;q=0.9" },
    cache: "no-store",
  })
  const html = res.ok ? await res.text() : ""
  const t = html.match(/<title>\s*Vectis Auctions\s*\|\s*([^<]*)<\/title>/i)
  const d = html.match(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/)
  return { title: decode(t?.[1] ?? "").trim(), date: d ? new Date(Date.UTC(+d[3], MONTHS.indexOf(d[2]), +d[1])) : null }
}

export type FeedLot = {
  lot_number: unknown; id: unknown; unique_id: unknown; image: unknown; description: unknown; meta: unknown
  low_estimate: unknown; high_estimate: unknown; hammer_price: unknown; sold: unknown; withdrawn: unknown
  sef_link: unknown; isFinished: unknown
}

/**
 * ⚠⚠ THE WEBSITE ANSWERS 500 FOR A SALE ID THAT DOES NOT EXIST. Probed live 2026-09-09: ids 2, 10,
 * 20, 40, 41, 50, 100, 500 and 1000 all return 200 with hundreds of lots, while 1, 5, 1500 and 2000
 * return 500. So a bad status is the site's way of saying "no such sale" — it is NOT an error, and
 * throwing on it killed the walk on the very first id it tried.
 *
 * ⚠ And a body that will not parse is NOT an empty sale. It means the site handed back something
 * other than its feed — a block page, a maintenance page, a login wall. The old code turned that
 * into `{}`, which read as "this sale has no lots", and forty of those in a row made the job
 * announce **"Finished — nothing beyond sale 0"** while having downloaded nothing at all. That is
 * exactly what production was showing. A refusal must stop the run and say so, never look like
 * success.
 */
async function fetchFeed(siteId: number, page: number): Promise<{ lots: FeedLot[]; total: number; missing: boolean }> {
  const body = new URLSearchParams({
    per_page: String(FEED_PAGE), current_page: String(page), auction_id: String(siteId), lot_order: "", sale_type: "", keyword: "",
    cate_arr: "[]", sub_cate_arr: "[]", extended_attrs_obj: "{}", low_estimate: "", high_estimate: "", catalogue_layout_header_id: "0",
  })
  const res = await fetch(`${SITE}/index.php?option=com_bidding&format=json&task=commission.getLots`, {
    method: "POST", headers: FEED_HEADERS, body, cache: "no-store",
  })
  // 4xx/5xx = there is no sale with that id.
  if (!res.ok) return { lots: [], total: 0, missing: true }
  const text = (await res.text()).trim()
  // ⚠⚠ AN EMPTY BODY IS "NO SUCH SALE", NOT A REFUSAL. Measured 2026-09-09: from this office the
  // site answers **500** for a missing sale id, but from Railway it answers **202 with an empty
  // body** for the same id. Treating that as an error stopped the whole walk dead on sale 1 and it
  // never reached sale 2, which has 774 lots. An empty answer carries no information, so the only
  // safe reading is "nothing here" — move on, and let the miss counter decide when to stop.
  // ⚠ The guard that makes this safe is in the walk: reaching the end having read ZERO sales is
  // reported as something to look at, never as "Finished". So if the site really is refusing us,
  // it says so instead of quietly claiming there is nothing there.
  if (!text) return { lots: [], total: 0, missing: true }
  let j: any
  try { j = JSON.parse(text) } catch {
    // A body that is not JSON is a real refusal — a block page, a maintenance page, a login wall.
    throw new Error(`The website did not return its lot feed for sale ${siteId} — it answered ${res.status} with ${text.slice(0, 80)}`)
  }
  // JSON that simply has no lot list (the site's "no such auction" shape) is a miss too.
  if (!Array.isArray(j?.lots)) return { lots: [], total: 0, missing: true }
  return { lots: j.lots, total: Number(j?.total_lots) || 0, missing: false }
}

async function fetchAllLots(siteId: number): Promise<{ lots: FeedLot[]; missing: boolean }> {
  const out: FeedLot[] = []
  for (let p = 1; p <= 40; p++) {
    const { lots, total, missing } = await fetchFeed(siteId, p)
    if (missing && p === 1) return { lots: [], missing: true }
    out.push(...lots)
    if (!lots.length || lots.length < FEED_PAGE || out.length >= total) break
    await sleep(PAUSE)
  }
  return { lots: out, missing: false }
}

const slugTitle = (sef: unknown) => {
  const m = String(sef ?? "").match(/^bidding\/\d+-(.+?)-\d+\//)
  return m ? m[1].split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ") : ""
}

/**
 * Annotates one finished sale's lots that are ALREADY in the archive: the site's own
 * lot number and link, its photo path, and its hammer (kept beside ours, never over
 * ours). ⚠ ANNOTATE ONLY — nothing is created from the site (Jordan, 2026-09-07: "I
 * dont really want the website to pull it because the website has errors"); lots the
 * site has and the archive doesn't are only counted. Matched on LotID (the site's
 * unique_id) — sale + lot number is not unique in the old data.
 */
async function writeSale(auctionId: number, title: string, date: Date | null, lots: FeedLot[]): Promise<{ matched: number; added: number }> {
  const existing = new Set((await prisma.archiveLot.findMany({ where: { auctionId }, select: { lotId: true } })).map(r => r.lotId).filter((x): x is string => !!x))
  const clean = lots.map(l => ({ l, lot: Math.round(Number(l.lot_number)), lotId: str(l.unique_id) })).filter(x => Number.isFinite(x.lot) && x.lotId)
  const seen = new Set<string>()
  const uniq = clean.filter(x => (seen.has(x.lotId!) ? false : (seen.add(x.lotId!), true)))
  const toMatch = uniq.filter(x => existing.has(x.lotId!))
  const siteOnly = uniq.length - toMatch.length
  const hammer = (l: FeedLot) => (Number(l.sold) ? num(l.hammer_price) : null)

  if (toMatch.length) {
    // One statement per sale. Numbers travel as text and are cast in SQL so nulls are
    // never a driver question. The sheet's own figures are kept; only blanks are filled.
    const lotIds = toMatch.map(x => x.lotId!)
    const siteIds = toMatch.map(x => (Number.isFinite(Number(x.l.id)) ? String(Math.round(Number(x.l.id))) : ""))
    const links = toMatch.map(x => (str(x.l.sef_link) ?? "").replace(/^\/+/, ""))
    const photos = toMatch.map(x => str(x.l.image) ?? "")
    const hammers = toMatch.map(x => { const h = hammer(x.l); return h == null ? "" : String(h) })
    const los = toMatch.map(x => { const n = num(x.l.low_estimate); return n == null ? "" : String(n) })
    const his = toMatch.map(x => { const n = num(x.l.high_estimate); return n == null ? "" : String(n) })
    await prisma.$executeRaw`
      UPDATE "ArchiveLot" a SET
        "siteLotId"       = NULLIF(v."siteLotId", '')::int,
        "siteLink"        = NULLIF(v."link", ''),
        "sitePhoto"       = COALESCE(NULLIF(v."photo", ''), a."sitePhoto"),
        "siteHammerPrice" = NULLIF(v."hammer", '')::float8,
        "saleTitle"       = CASE WHEN a."saleTitle" = '' THEN ${title} ELSE a."saleTitle" END,
        "auctionDate"     = COALESCE(a."auctionDate", ${date}::timestamp),
        "estimateLow"     = COALESCE(a."estimateLow", NULLIF(v."lo", '')::float8),
        "estimateHigh"    = COALESCE(a."estimateHigh", NULLIF(v."hi", '')::float8)
      FROM unnest(${lotIds}::text[], ${siteIds}::text[], ${links}::text[], ${photos}::text[], ${hammers}::text[], ${los}::text[], ${his}::text[])
        AS v("lotId", "siteLotId", "link", "photo", "hammer", "lo", "hi")
      WHERE a."auctionId" = ${auctionId} AND a."lotId" = v."lotId"`
  }
  return { matched: toMatch.length, added: siteOnly }
}

const isBcId = (u: string | null): u is string => !!u && /^r\d+-\d+$/i.test(u)

/**
 * BC-era lots (unique_id "r008728-194" = WarehouseItem "R008728-194"): the website is
 * the ONLY source of the long description (BC's API exposes just the 250-char short
 * one), so these rows are CREATED as well as updated — but only in BcLotWeb, never on
 * WarehouseItem, whose figures stay BC's own. One INSERT … ON CONFLICT per sale.
 */
/**
 * ⚠ EXPORTED so the browser-collected import writes through exactly this, rather than a second
 * copy of the same INSERT. The website blocks our server (202, empty body, from Railway only), so
 * the lot feed is collected in Jordan's own browser on vectis.co.uk and uploaded — but it must land
 * in the database by the same path as the live walk or the two will drift.
 */
export async function writeBcSale(auctionCode: string | null, lots: FeedLot[], siteSaleId: number | null = null): Promise<number> {
  const seen = new Set<string>()
  const rows = lots
    .map(l => ({ l, id: str(l.unique_id)?.toUpperCase() ?? null }))
    .filter((x): x is { l: FeedLot; id: string } => isBcId(x.id) && !seen.has(x.id!) && (seen.add(x.id!), true))
  if (!rows.length) return 0
  const hammer = (l: FeedLot) => (Number(l.sold) ? num(l.hammer_price) : null)
  const ids = rows.map(x => x.id)
  const lotNos = rows.map(x => (Number.isFinite(Number(x.l.lot_number)) ? String(Math.round(Number(x.l.lot_number))) : ""))
  // ⚠ Plain text, not the website's HTML (<p>, &nbsp;, &auml;…) — it spoilt the screen, Copy
  // description and the search (Jordan, 2026-09-10). Older rows are cleaned by lib/search-words.ts.
  const descs = rows.map(x => htmlToText(String(x.l.description ?? "")))
  const siteIds = rows.map(x => (Number.isFinite(Number(x.l.id)) ? String(Math.round(Number(x.l.id))) : ""))
  const links = rows.map(x => (str(x.l.sef_link) ?? "").replace(/^\/+/, ""))
  const photos = rows.map(x => str(x.l.image) ?? "")
  const hammers = rows.map(x => { const h = hammer(x.l); return h == null ? "" : String(h) })
  // ⚠ The website's own sale NUMBER, kept so the Hub knows how far the collection has got and the
  // next run can start from the sale after it. Nothing else reads it.
  const sale = Number.isFinite(Number(siteSaleId)) && Number(siteSaleId) > 0 ? Math.round(Number(siteSaleId)) : null

  // ⚠⚠ MIGRATION-SAFE. Code reaches Railway the moment it is pushed; migrations wait for the Run
  // Migrations button. Without this fallback an upload on an environment that has not run them yet
  // would fail outright — losing every lot in the file over one column of bookkeeping.
  try {
    await prisma.$executeRaw`
      INSERT INTO "BcLotWeb" ("uniqueId", "auctionCode", "lotNumber", "description", "siteLotId", "siteSaleId", "siteLink", "sitePhoto", "siteHammerPrice", "pulledAt")
      SELECT v."id", ${auctionCode}, NULLIF(v."lot", '')::int, NULLIF(v."desc", ''), NULLIF(v."siteId", '')::int, ${sale}, NULLIF(v."link", ''), NULLIF(v."photo", ''), NULLIF(v."hammer", '')::float8, now()
      FROM unnest(${ids}::text[], ${lotNos}::text[], ${descs}::text[], ${siteIds}::text[], ${links}::text[], ${photos}::text[], ${hammers}::text[])
        AS v("id", "lot", "desc", "siteId", "link", "photo", "hammer")
      ON CONFLICT ("uniqueId") DO UPDATE SET
        "auctionCode" = COALESCE(EXCLUDED."auctionCode", "BcLotWeb"."auctionCode"),
        "lotNumber" = COALESCE(EXCLUDED."lotNumber", "BcLotWeb"."lotNumber"),
        "description" = COALESCE(EXCLUDED."description", "BcLotWeb"."description"),
        "siteLotId" = COALESCE(EXCLUDED."siteLotId", "BcLotWeb"."siteLotId"),
        "siteSaleId" = COALESCE(EXCLUDED."siteSaleId", "BcLotWeb"."siteSaleId"),
        "siteLink" = COALESCE(EXCLUDED."siteLink", "BcLotWeb"."siteLink"),
        "sitePhoto" = COALESCE(EXCLUDED."sitePhoto", "BcLotWeb"."sitePhoto"),
        "siteHammerPrice" = COALESCE(EXCLUDED."siteHammerPrice", "BcLotWeb"."siteHammerPrice"),
        "pulledAt" = now()`
  } catch (e: any) {
    if (!/siteSaleId/i.test(String(e?.message ?? ""))) throw e
    await prisma.$executeRaw`
      INSERT INTO "BcLotWeb" ("uniqueId", "auctionCode", "lotNumber", "description", "siteLotId", "siteLink", "sitePhoto", "siteHammerPrice", "pulledAt")
      SELECT v."id", ${auctionCode}, NULLIF(v."lot", '')::int, NULLIF(v."desc", ''), NULLIF(v."siteId", '')::int, NULLIF(v."link", ''), NULLIF(v."photo", ''), NULLIF(v."hammer", '')::float8, now()
      FROM unnest(${ids}::text[], ${lotNos}::text[], ${descs}::text[], ${siteIds}::text[], ${links}::text[], ${photos}::text[], ${hammers}::text[])
        AS v("id", "lot", "desc", "siteId", "link", "photo", "hammer")
      ON CONFLICT ("uniqueId") DO UPDATE SET
        "auctionCode" = COALESCE(EXCLUDED."auctionCode", "BcLotWeb"."auctionCode"),
        "lotNumber" = COALESCE(EXCLUDED."lotNumber", "BcLotWeb"."lotNumber"),
        "description" = COALESCE(EXCLUDED."description", "BcLotWeb"."description"),
        "siteLotId" = COALESCE(EXCLUDED."siteLotId", "BcLotWeb"."siteLotId"),
        "siteLink" = COALESCE(EXCLUDED."siteLink", "BcLotWeb"."siteLink"),
        "sitePhoto" = COALESCE(EXCLUDED."sitePhoto", "BcLotWeb"."sitePhoto"),
        "siteHammerPrice" = COALESCE(EXCLUDED."siteHammerPrice", "BcLotWeb"."siteHammerPrice"),
        "pulledAt" = now()`
  }
  return rows.length
}

/**
 * What does the website actually say to THIS server? Reports the raw answer for a couple of sale
 * ids so a silent 202 can be seen for what it is, rather than guessed at from an empty report.
 */
export async function probeSite(ids: number[] = [2, 10]) {
  const out: { siteId: number; status: number; contentType: string; bytes: number; lots: number | null; snippet: string }[] = []
  for (const siteId of ids) {
    try {
      const body = new URLSearchParams({
        per_page: "5", current_page: "1", auction_id: String(siteId), lot_order: "", sale_type: "", keyword: "",
        cate_arr: "[]", sub_cate_arr: "[]", extended_attrs_obj: "{}", low_estimate: "", high_estimate: "", catalogue_layout_header_id: "0",
      })
      const res = await fetch(`${SITE}/index.php?option=com_bidding&format=json&task=commission.getLots`, {
        method: "POST", headers: FEED_HEADERS, body, cache: "no-store",
      })
      const text = (await res.text()).trim()
      let lots: number | null = null
      try { const j = JSON.parse(text); lots = Array.isArray(j?.lots) ? j.lots.length : null } catch {}
      out.push({
        siteId, status: res.status,
        contentType: res.headers.get("content-type") ?? "(none)",
        bytes: text.length, lots,
        snippet: text.slice(0, 160) || "(empty body)",
      })
    } catch (e: any) {
      out.push({ siteId, status: 0, contentType: "(request failed)", bytes: 0, lots: null, snippet: e?.message ?? "unknown" })
    }
    await sleep(PAUSE)
  }
  return out
}

// ── "site" job ──────────────────────────────────────────────────────────────

export type Scope = "abc" | "bc" | "both"

export async function startSitePull(startedBy: string, scope: Scope = "both") {
  if (isActive("site")) return getJob("site")
  let job = await prisma.archiveJob.upsert({ where: { id: "site" }, create: { id: "site", startedBy, scope }, update: { error: null, startedBy, scope } })
  if (job.done) {
    // Run again: from the first sale that wasn't finished last time (or after the last one seen).
    const [firstOpen, last] = await Promise.all([
      prisma.archiveSale.findFirst({ where: { finished: false }, orderBy: { siteId: "asc" }, select: { siteId: true } }),
      prisma.archiveSale.findFirst({ orderBy: { siteId: "desc" }, select: { siteId: true } }),
    ])
    const cursor = Math.max(0, (firstOpen?.siteId ?? (last?.siteId ?? 0) + 1) - 1)
    job = await prisma.archiveJob.update({ where: { id: "site" }, data: { cursor, done: false, sales: 0, matched: 0, added: 0, note: null } })
  }
  void runSitePull()
  return { ...job, running: true }
}

async function runSitePull() {
  const ctl: Ctl = { stop: false }; active.set("site", ctl)
  try {
    const job = await prisma.archiveJob.findUniqueOrThrow({ where: { id: "site" } })
    const scope = (job.scope as Scope) ?? "both"
    let cursor = job.cursor, misses = 0, seen = 0
    while (!ctl.stop) {
      const siteId = cursor + 1
      const known = await prisma.archiveSale.findUnique({ where: { siteId } })
      if (known?.finished && known.lots > 0) {                            // pulled on an earlier run — skip without touching the site
        cursor = siteId; await prisma.archiveJob.update({ where: { id: "site" }, data: { cursor } }); continue
      }
      const page = await fetchSalePage(siteId); await sleep(PAUSE)
      // ⚠ A refusal is NOT an empty sale. Retry a few times, then stop with the reason — never let
      // the site being unreachable look like having reached the end of it.
      let lots: FeedLot[] = [], missing = false
      let attempt = 0
      for (;;) {
        try { ({ lots, missing } = await fetchAllLots(siteId)); break }
        catch (e: any) {
          if (++attempt >= 4) {
            await prisma.archiveJob.update({
              where: { id: "site" },
              data: { error: `${e?.message ?? "The website could not be read"} — stopped at sale ${siteId}, nothing was lost. Try again in a while.` },
            })
            return
          }
          await sleep(PAUSE * 8 * attempt)
        }
      }
      if (!lots.length && !page.title) {
        misses++
        if (misses >= MISSES_TO_STOP) {
          const lastReal = siteId - misses
          await prisma.archiveJob.update({
            where: { id: "site" },
            data: {
              done: true,
              note: seen > 0
                ? `Finished — ${seen} sale${seen === 1 ? "" : "s"} read, nothing beyond sale ${lastReal}`
                : `Stopped at sale ${siteId} having found no sales at all. Every id came back empty, which usually means the website is not serving its lot feed to the Hub rather than that there is nothing there. Worth looking at — this is not "finished".`,
            },
          })
          break
        }
        cursor = siteId; await sleep(PAUSE); continue
      }
      misses = 0
      seen++
      const m = String(lots[0]?.sef_link ?? "").match(/^bidding\/(\d+)-/)
      const auctionId = m ? +m[1] : null
      const codeM = String(lots[0]?.sef_link ?? "").match(/^bidding\/([A-Za-z]\d+)-/)     // a BC sale's URL starts with its code: D062-…
      const auctionCode = codeM ? codeM[1].toUpperCase() : null
      const finished = lots.length > 0 && lots.every(l => !!l.isFinished)
      const title = page.title || slugTitle(lots[0]?.sef_link) || `Sale ${siteId}`
      await prisma.archiveSale.upsert({
        where: { siteId },
        create: { siteId, auctionId, title, saleDate: page.date, lots: lots.length, finished },
        update: { auctionId, title, saleDate: page.date, lots: lots.length, finished, pulledAt: new Date() },
      })
      let matched = 0, added = 0
      // ⚠ One walk covers both databases because they are the SAME sales on the website — what the
      // scope changes is which database gets written. Running "bc" leaves the ABC archive untouched.
      if (scope !== "bc" && finished && auctionId != null) ({ matched, added } = await writeSale(auctionId, title, page.date, lots))
      if (scope !== "abc" && finished && lots.some(l => isBcId(str(l.unique_id)))) matched += await writeBcSale(auctionCode, lots, siteId)   // BC-era lots → BcLotWeb
      cursor = siteId
      await prisma.archiveJob.update({
        where: { id: "site" },
        data: { cursor, sales: { increment: 1 }, matched: { increment: matched }, added: { increment: added }, note: `Sale ${siteId} · ${title} · ${lots.length} lots${finished ? "" : " (not finished yet — skipped)"}` },
      })
      await sleep(PAUSE)
    }
  } catch (e: any) {
    console.error("archive site pull error:", e)
    await prisma.archiveJob.update({ where: { id: "site" }, data: { error: e?.message ?? "Stopped with an error" } }).catch(() => {})
  } finally { active.delete("site") }
}

// ── "photos" job ────────────────────────────────────────────────────────────

// Two copies per lot: the site's "large" (~23 KB) for display, and its "xlarge"
// (~250 KB, the best it holds — there are no originals) as the backup, so a future
// move off the website has the full-quality pictures. ~260 GB for the whole archive.
const PHOTO_TODO: Prisma.ArchiveLotWhereInput = { sitePhoto: { not: null }, OR: [{ photoKey: null }, { photoXlKey: null }] }
const BC_PHOTO_TODO: Prisma.BcLotWebWhereInput = { sitePhoto: { not: null }, OR: [{ photoKey: null }, { photoXlKey: null }] }

export async function startPhotoCopy(startedBy: string, scope: Scope = "both") {
  if (isActive("photos")) return getJob("photos")
  // ⚠ The total has to match the scope, or the BC run shows "376 of 948,506" and looks stuck when
  // it is actually nearly done.
  const total =
    (scope === "bc"  ? 0 : await prisma.archiveLot.count({ where: PHOTO_TODO })) +
    (scope === "abc" ? 0 : await prisma.bcLotWeb.count({ where: BC_PHOTO_TODO }))
  const job = await prisma.archiveJob.upsert({
    where: { id: "photos" },
    create: { id: "photos", startedBy, total, scope },
    update: { error: null, startedBy, total, scope, done: false, added: 0, note: null },
  })
  void runPhotoCopy()
  return { ...job, running: true }
}

async function runPhotoCopy() {
  const ctl: Ctl = { stop: false }; active.set("photos", ctl)
  try {
    const scope = ((await prisma.archiveJob.findUnique({ where: { id: "photos" }, select: { scope: true } }))?.scope as Scope) ?? "both"
    const grab = async (path: string): Promise<Buffer | null> => {             // null = the site has no such file
      const res = await fetch(SITE_IMAGES + path, { headers: { "User-Agent": UA } })
      if (res.status === 404 || res.status === 403) return null
      if (!res.ok) throw new Error(`Photo download answered ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    }
    // One lot, either database: display copy then full-size; returns the fields to save.
    type PhotoRow = { sitePhoto: string; photoKey: string | null; photoXlKey: string | null }
    const copyOne = async (l: PhotoRow, prefix: string, safe: string): Promise<{ photoKey?: string; photoXlKey?: string } | null> => {
      const data: { photoKey?: string; photoXlKey?: string } = {}
      if (!l.photoKey) {
        const buf = await grab(l.sitePhoto)
        if (!buf) return null                                                     // the site has no picture after all
        data.photoKey = `${prefix}/${safe}.webp`
        await uploadBufferToR2(buf, data.photoKey, "image/webp")
      }
      if (!l.photoXlKey) {
        const buf = await grab(l.sitePhoto.replace("/large/", "/xlarge/"))
        if (buf) { data.photoXlKey = `${prefix}/xl/${safe}.webp`; await uploadBufferToR2(buf, data.photoXlKey, "image/webp") }
        else data.photoXlKey = data.photoKey ?? l.photoKey ?? undefined            // no full-size on the site: the display copy is the best there is
      }
      return data
    }
    while (!ctl.stop) {
      let n = 0
      // ABC lots first, then BC lots — same treatment, different folders.
      // ⚠⚠ SCOPE IS WHY THIS EXISTS. The copy did every ABC photo before it started a single BC one,
      // so the BC Database sat at 0 photos behind 948,000 ABC lots. Running it from the BC page now
      // does BC only.
      const batch = scope === "bc" ? [] : await prisma.archiveLot.findMany({ where: PHOTO_TODO, select: { id: true, lotId: true, sitePhoto: true, photoKey: true, photoXlKey: true }, take: 40, orderBy: { id: "asc" } })
      if (batch.length) {
        for (let i = 0; i < batch.length && !ctl.stop; i += 5) {
          await Promise.all(batch.slice(i, i + 5).map(async l => {
            const data = await copyOne(l as PhotoRow, "archive-photos", String(l.lotId || l.id).replace(/[^A-Za-z0-9_-]/g, ""))
            // Same read-back trap as the BC job below — keep the select.
            await prisma.archiveLot.update({
              where:  { id: l.id },
              data:   data ?? { sitePhoto: null },
              select: { id: true },
            })
            if (data) n++
          }))
          await sleep(100)
        }
      } else {
        const bc = scope === "abc" ? [] : await prisma.bcLotWeb.findMany({ where: BC_PHOTO_TODO, select: { uniqueId: true, sitePhoto: true, photoKey: true, photoXlKey: true }, take: 40, orderBy: { uniqueId: "asc" } })
        if (!bc.length) {
          // ⚠ "Nothing to copy" and "everything is copied" are not the same sentence. With no
          // website pull yet there are no photo paths to copy from, and saying it was all done
          // reads as success when nothing has happened.
          const [siteJob, photoJob] = await Promise.all([
            prisma.archiveJob.findUnique({ where: { id: "site" },   select: { sales: true } }),
            prisma.archiveJob.findUnique({ where: { id: "photos" }, select: { added: true } }),
          ])
          await prisma.archiveJob.update({
            where: { id: "photos" },
            data: {
              done: true,
              note: (photoJob?.added ?? 0) > 0 || (siteJob?.sales ?? 0) > 0
                ? "Every photo the site has is in the Hub, display and full-size, for both databases"
                : "Nothing to copy yet — run \"Pull from the website\" first, so the lots have a photo to copy.",
            },
          })
          break
        }
        for (let i = 0; i < bc.length && !ctl.stop; i += 5) {
          await Promise.all(bc.slice(i, i + 5).map(async l => {
            const data = await copyOne(l as PhotoRow, "bc-photos", l.uniqueId.replace(/[^A-Za-z0-9_-]/g, ""))
            // ⚠ `select` is not tidying. Without it Prisma reads the whole row back after the
            // update, which means it names EVERY column in the model — so a column that has
            // shipped in code but not yet in the database (Run Migrations is a manual button here)
            // fails an update that never touched it. That is exactly how this job died on
            // production with "BcLotWeb.siteSaleId does not exist" while writing only photo keys.
            await prisma.bcLotWeb.update({
              where:  { uniqueId: l.uniqueId },
              data:   data ?? { sitePhoto: null },
              select: { uniqueId: true },
            })
            if (data) n++
          }))
          await sleep(100)
        }
      }
      await prisma.archiveJob.update({ where: { id: "photos" }, data: { added: { increment: n }, note: null } })
    }
  } catch (e: any) {
    console.error("archive photo copy error:", e)
    await prisma.archiveJob.update({ where: { id: "photos" }, data: { error: e?.message ?? "Stopped with an error" } }).catch(() => {})
  } finally { active.delete("photos") }
}

// ── Sale pictures ("heroes") ─────────────────────────────────────────────────
//
// Every sale page on the website carries one cover picture — the one its auction calendar shows —
// at a fixed place on Amazon S3: `auction_images/large/<sale guid>/<image guid>.webp`, old ABC
// sales and BC ones alike (checked on sales 683 and 1566, 2026-09-22). Jordan: "is it possible to
// get them as well? … make a new tab for them in databases". The office collector records it with
// each sale's title and date (the site won't answer the Hub's server); the "heroes" job below then
// copies it into R2 — S3 the server CAN reach, exactly as it fetches the lot photos.

export const SALE_HERO_PREFIX = "sale-photos"

export type SaleMeta = {
  siteId: number
  auctionId?: number | null
  code?: string | null
  title?: string | null
  /** yyyy-mm-dd */
  date?: string | null
  /** The picture's path under SITE_IMAGES, or its full address — either is accepted. */
  hero?: string | null
  lotCount?: number | null
  finished?: boolean | null
}

/** Writes what a collector learned about a SALE. Never blanks a value already held; a new picture
 *  clears our old copy so the heroes job fetches it again. ⚠ Migration-safe: without the picture
 *  columns it still keeps title, date and lot count. */
export async function upsertSaleMeta(m: SaleMeta): Promise<{ hero: boolean }> {
  const siteId = Math.round(Number(m.siteId))
  if (!Number.isFinite(siteId) || siteId <= 0) return { hero: false }
  const title = str(m.title) ?? `Sale ${siteId}`
  const date = m.date && /^\d{4}-\d{2}-\d{2}/.test(m.date) ? new Date(`${m.date.slice(0, 10)}T00:00:00Z`) : null
  const code = str(m.code)?.toUpperCase() ?? null
  const hero = str(m.hero)?.replace(/^https?:\/\/[^/]+\/vectis\/prod\//i, "").replace(/^\/+/, "") ?? null
  const lots = Number.isFinite(Number(m.lotCount)) ? Math.max(0, Math.round(Number(m.lotCount))) : 0
  const finished = m.finished === true
  const auctionId = Number.isFinite(Number(m.auctionId)) && Number(m.auctionId) > 0 ? Math.round(Number(m.auctionId)) : null
  try {
    await prisma.$executeRaw`
      INSERT INTO "ArchiveSale" ("siteId", "auctionId", "title", "saleDate", "lots", "finished", "pulledAt", "code", "heroUrl", "heroAt")
      VALUES (${siteId}, ${auctionId}, ${title}, ${date}, ${lots}, ${finished}, now(), ${code}, ${hero}, CASE WHEN ${hero}::text IS NULL THEN NULL ELSE now() END)
      ON CONFLICT ("siteId") DO UPDATE SET
        "auctionId" = COALESCE(EXCLUDED."auctionId", "ArchiveSale"."auctionId"),
        "title"     = CASE WHEN EXCLUDED."title" LIKE 'Sale %' THEN "ArchiveSale"."title" ELSE EXCLUDED."title" END,
        "saleDate"  = COALESCE(EXCLUDED."saleDate", "ArchiveSale"."saleDate"),
        "lots"      = GREATEST(EXCLUDED."lots", "ArchiveSale"."lots"),
        "finished"  = "ArchiveSale"."finished" OR EXCLUDED."finished",
        "pulledAt"  = now(),
        "code"      = COALESCE(EXCLUDED."code", "ArchiveSale"."code"),
        "heroUrl"   = COALESCE(EXCLUDED."heroUrl", "ArchiveSale"."heroUrl"),
        "heroAt"    = CASE WHEN EXCLUDED."heroUrl" IS NOT NULL AND EXCLUDED."heroUrl" IS DISTINCT FROM "ArchiveSale"."heroUrl" THEN now() ELSE "ArchiveSale"."heroAt" END,
        "heroKey"   = CASE WHEN EXCLUDED."heroUrl" IS NOT NULL AND EXCLUDED."heroUrl" IS DISTINCT FROM "ArchiveSale"."heroUrl" THEN NULL ELSE "ArchiveSale"."heroKey" END`
    return { hero: !!hero }
  } catch (e: any) {
    if (!/heroUrl|heroAt|heroKey|"code"/i.test(String(e?.message ?? ""))) throw e
    await prisma.$executeRaw`
      INSERT INTO "ArchiveSale" ("siteId", "auctionId", "title", "saleDate", "lots", "finished", "pulledAt")
      VALUES (${siteId}, ${auctionId}, ${title}, ${date}, ${lots}, ${finished}, now())
      ON CONFLICT ("siteId") DO UPDATE SET
        "auctionId" = COALESCE(EXCLUDED."auctionId", "ArchiveSale"."auctionId"),
        "title"     = CASE WHEN EXCLUDED."title" LIKE 'Sale %' THEN "ArchiveSale"."title" ELSE EXCLUDED."title" END,
        "saleDate"  = COALESCE(EXCLUDED."saleDate", "ArchiveSale"."saleDate"),
        "lots"      = GREATEST(EXCLUDED."lots", "ArchiveSale"."lots"),
        "finished"  = "ArchiveSale"."finished" OR EXCLUDED."finished",
        "pulledAt"  = now()`
    return { hero: false }
  }
}

// ── "heroes" job: copy each sale's picture into R2 ──────────────────────────

export async function startHeroCopy(startedBy: string) {
  if (isActive("heroes")) return getJob("heroes")
  let total = 0
  try {
    const r = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "ArchiveSale" WHERE "heroUrl" IS NOT NULL AND "heroKey" IS NULL`
    total = Number(r[0]?.n ?? 0)
  } catch {
    throw new Error("The sale-picture columns aren't on this environment yet — press Run Migrations on the Admin page first.")
  }
  const job = await prisma.archiveJob.upsert({
    where: { id: "heroes" },
    create: { id: "heroes", startedBy, total, scope: "sales" },
    update: { error: null, startedBy, total, done: false, added: 0, note: null },
  })
  void runHeroCopy()
  return { ...job, running: true }
}

async function runHeroCopy() {
  const ctl: Ctl = { stop: false }; active.set("heroes", ctl)
  try {
    while (!ctl.stop) {
      const batch = await prisma.$queryRaw<{ siteId: number; heroUrl: string }[]>`
        SELECT "siteId", "heroUrl" FROM "ArchiveSale" WHERE "heroUrl" IS NOT NULL AND "heroKey" IS NULL ORDER BY "siteId" DESC LIMIT 20`
      if (!batch.length) {
        await prisma.archiveJob.update({ where: { id: "heroes" }, data: { done: true, note: "Every sale picture the website has is in the Hub" } })
        break
      }
      let n = 0
      for (let i = 0; i < batch.length && !ctl.stop; i += 5) {
        await Promise.all(batch.slice(i, i + 5).map(async s => {
          const res = await fetch(SITE_IMAGES + s.heroUrl, { headers: { "User-Agent": UA } })
          // The bucket answers 403 for a missing file, like the lot photos — not a picture after all.
          if (res.status === 404 || res.status === 403) {
            await prisma.$executeRaw`UPDATE "ArchiveSale" SET "heroUrl" = NULL WHERE "siteId" = ${s.siteId}`
            return
          }
          if (!res.ok) throw new Error(`Picture download answered ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          const ext = (s.heroUrl.match(/\.(webp|jpe?g|png)$/i)?.[1] ?? "webp").toLowerCase()
          const type = ext === "png" ? "image/png" : ext.startsWith("jp") ? "image/jpeg" : "image/webp"
          const key = `${SALE_HERO_PREFIX}/${s.siteId}.${ext === "jpeg" ? "jpg" : ext}`
          await uploadBufferToR2(buf, key, type)
          await prisma.$executeRaw`UPDATE "ArchiveSale" SET "heroKey" = ${key} WHERE "siteId" = ${s.siteId}`
          n++
        }))
        await sleep(100)
      }
      await prisma.archiveJob.update({ where: { id: "heroes" }, data: { added: { increment: n }, note: null } })
    }
  } catch (e: any) {
    console.error("sale picture copy error:", e)
    await prisma.archiveJob.update({ where: { id: "heroes" }, data: { error: e?.message ?? "Stopped with an error" } }).catch(() => {})
  } finally { active.delete("heroes") }
}
