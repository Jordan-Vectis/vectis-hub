import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import { htmlToText } from "@/lib/html-text"
import ArchiveSite from "../archive/archive-site"
import BcCollect from "./bc-collect"
import BcTools from "./bc-tools"
import { BC_FIRST_SITE_SALE, BC_LAST_SITE_SALE } from "@/lib/bc-web-collector"
import ZoomPhoto from "@/components/zoom-photo"

// Databases → BC Database: every Business Central lot that has been through a sale,
// built like the ABC database. The lot's own figures (sale, lot number, estimate,
// hammer, short description) come from the nightly BC sync (WarehouseItem); the long
// description, the photo and the link to vectis.co.uk come from the website pull
// (BcLotWeb) — BC's API has no long description at all. Server-rendered, 100 a page.
const PAGE = 100
const fmtGBP = (n: number | null) => n == null ? "—" : "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 0 })
const fmtDate = (s: string | null) => { if (!s) return "—"; const d = new Date(s + "T00:00:00Z"); return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""

type Row = { id: string; uniqueId: string; auctionCode: string | null; auctionName: string | null; auctionDate: string | null; lotNo: number | null; shortDesc: string | null; longDesc: string | null; estimateLow: number | null; estimateHigh: number | null; hammerPrice: number | null; siteHammerPrice: number | null; siteLink: string | null; sitePhoto: string | null; photoKey: string | null; photoXlKey: string | null; noOfPhotos: number | null; photo?: string | null; photoFull?: string | null }

export default async function BcDatabasePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"
  const sp = await searchParams
  const q = one(sp.q).trim(), sale = one(sp.sale).trim()
  const dFrom = one(sp.from).trim(), dTo = one(sp.to).trim()
  const status = one(sp.status).trim(), photo = one(sp.photo).trim(), desc = one(sp.desc).trim()
  const order = one(sp.order).trim()
  const min = parseFloat(one(sp.min)), max = parseFloat(one(sp.max))
  const page = Math.max(1, parseInt(one(sp.page)) || 1)
  const FILTERS = ["q", "sale", "from", "to", "min", "max", "status", "photo", "desc"] as const
  const anyFilter = FILTERS.some(k => one(sp[k]).trim())

  // Lots given a sale and a lot number. Sales still to come are listed too, marked Upcoming (Jordan,
  // 2026-09-25: "show upcoming ones marked as upcoming") — their catalogue is collected from the site
  // before the sale. ⚠ The summary tiles stay on HELD sales only, so sold/unsold figures aren't
  // diluted by lots that haven't been offered yet; upcoming ones get their own line.
  const TODAY_SQL = Prisma.sql`to_char(now() AT TIME ZONE 'Europe/London', 'YYYY-MM-DD')`
  const todayLondon = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date())
  const conds: Prisma.Sql[] = [Prisma.sql`w."auctionCode" IS NOT NULL AND w."auctionDate" IS NOT NULL AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL`]
  // ⚠ The search covers the unique ID too — looking a known lot up by "R009030-1" is the commonest
  // reason anyone opens this page, and it used to find nothing.
  if (q) conds.push(Prisma.sql`(w."description" ILIKE ${"%" + q + "%"} OR b."description" ILIKE ${"%" + q + "%"} OR w."auctionName" ILIKE ${"%" + q + "%"} OR w."uniqueId" ILIKE ${"%" + q + "%"})`)
  if (sale) conds.push(Prisma.sql`(w."auctionName" ILIKE ${"%" + sale + "%"} OR w."auctionCode" ILIKE ${"%" + sale + "%"})`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dFrom)) conds.push(Prisma.sql`w."auctionDate" >= ${dFrom}`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dTo)) conds.push(Prisma.sql`w."auctionDate" <= ${dTo}`)
  if (Number.isFinite(min)) conds.push(Prisma.sql`w."hammerPrice" >= ${min}`)
  if (Number.isFinite(max)) conds.push(Prisma.sql`w."hammerPrice" <= ${max} AND w."hammerPrice" > 0`)
  if (status === "sold") conds.push(Prisma.sql`w."hammerPrice" > 0 AND w."auctionDate" <= ${TODAY_SQL}`)
  if (status === "unsold") conds.push(Prisma.sql`COALESCE(w."hammerPrice", 0) = 0 AND w."auctionDate" <= ${TODAY_SQL}`)
  if (status === "held") conds.push(Prisma.sql`w."auctionDate" <= ${TODAY_SQL}`)
  if (status === "upcoming") conds.push(Prisma.sql`w."auctionDate" > ${TODAY_SQL}`)
  if (photo === "yes") conds.push(Prisma.sql`(b."photoKey" IS NOT NULL OR b."sitePhoto" IS NOT NULL)`)
  if (photo === "no") conds.push(Prisma.sql`(b."photoKey" IS NULL AND b."sitePhoto" IS NULL)`)
  if (desc === "full") conds.push(Prisma.sql`b."description" IS NOT NULL`)
  if (desc === "short") conds.push(Prisma.sql`b."description" IS NULL`)
  const where = Prisma.join(conds, " AND ")
  const from = Prisma.sql`FROM "WarehouseItem" w LEFT JOIN "BcLotWeb" b ON b."uniqueId" = upper(w."uniqueId")`
  // ⚠ Built from a fixed map, never from the query string — this goes into raw SQL, so anything a
  // visitor could influence must not reach it. An unknown value simply falls back to the default.
  // ⚠ Unsold lots (hammer 0) sort LAST on both price directions: a lot with no result is not the
  // cheapest, and letting the nulls lead a low-to-high sort buries the genuinely cheap ones.
  const LOT_NO = Prisma.sql`NULLIF(regexp_replace(COALESCE(NULLIF(w."currentLotNo", '0'), w."lotNo"), '[^0-9]', '', 'g'), '')::int`
  const ORDERS: Record<string, Prisma.Sql> = {
    date_desc:   Prisma.sql`w."auctionDate" DESC, w."auctionCode" DESC, ${LOT_NO} ASC`,
    date_asc:    Prisma.sql`w."auctionDate" ASC, w."auctionCode" ASC, ${LOT_NO} ASC`,
    sale_desc:   Prisma.sql`w."auctionCode" DESC, ${LOT_NO} ASC`,
    sale_asc:    Prisma.sql`w."auctionCode" ASC, ${LOT_NO} ASC`,
    lot_asc:     Prisma.sql`${LOT_NO} ASC NULLS LAST, w."auctionDate" DESC`,
    lot_desc:    Prisma.sql`${LOT_NO} DESC NULLS LAST, w."auctionDate" DESC`,
    est_desc:    Prisma.sql`w."highEstimate" DESC NULLS LAST, w."auctionDate" DESC`,
    est_asc:     Prisma.sql`w."lowEstimate" ASC NULLS LAST, w."auctionDate" DESC`,
    hammer_desc: Prisma.sql`NULLIF(w."hammerPrice", 0) DESC NULLS LAST, w."auctionDate" DESC`,
    hammer_asc:  Prisma.sql`NULLIF(w."hammerPrice", 0) ASC NULLS LAST, w."auctionDate" DESC`,
  }
  const orderBy = ORDERS[order] ?? ORDERS.date_desc

  type Stats = { n: number; sales: number; from: string | null; to: string | null; hammer: number; sold: number; longDesc: number; inHub: number; fullSize: number; siteOnly: number; noPhoto: number }
  let rows: Row[] = [], total = 0, stats: Stats | null = null, tableError: string | null = null
  let upcoming: { n: number; sales: number } | null = null
  try {
    const [r, t, agg] = await Promise.all([
      prisma.$queryRaw<Row[]>`
        SELECT w."id", w."uniqueId", w."auctionCode", w."auctionName", w."auctionDate",
               NULLIF(regexp_replace(COALESCE(NULLIF(w."currentLotNo", '0'), w."lotNo"), '[^0-9]', '', 'g'), '')::int AS "lotNo",
               w."description" AS "shortDesc", b."description" AS "longDesc", w."lowEstimate" AS "estimateLow", w."highEstimate" AS "estimateHigh",
               NULLIF(w."hammerPrice", 0) AS "hammerPrice", b."siteHammerPrice", b."siteLink", b."sitePhoto", b."photoKey", b."photoXlKey", w."noOfPhotos"
        ${from} WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n ${from} WHERE ${where}`,
      prisma.$queryRaw<{ n: bigint; sales: bigint; from: string | null; to: string | null; hammer: number | null; sold: bigint; longdesc: bigint; inhub: bigint; fullsize: bigint; siteonly: bigint }[]>`
        SELECT count(*)::bigint AS n, count(DISTINCT w."auctionCode")::bigint AS sales, min(w."auctionDate") AS "from", max(w."auctionDate") AS "to",
               sum(w."hammerPrice")::float8 AS hammer, count(*) FILTER (WHERE w."hammerPrice" > 0)::bigint AS sold,
               count(b."description")::bigint AS longdesc, count(b."photoKey")::bigint AS inhub,
               count(*) FILTER (WHERE b."photoXlKey" LIKE 'bc-photos/xl/%')::bigint AS fullsize,
               count(*) FILTER (WHERE b."photoKey" IS NULL AND b."sitePhoto" IS NOT NULL)::bigint AS siteonly
        ${from} WHERE w."auctionCode" IS NOT NULL AND w."auctionDate" IS NOT NULL AND w."auctionDate" <= ${TODAY_SQL} AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL`,
    ])
    rows = r; total = Number(t[0]?.n ?? 0)
    try {
      const u = await prisma.$queryRaw<{ n: bigint; sales: bigint }[]>`
        SELECT count(*)::bigint AS n, count(DISTINCT w."auctionCode")::bigint AS sales FROM "WarehouseItem" w
         WHERE w."auctionCode" IS NOT NULL AND w."auctionDate" > ${TODAY_SQL} AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL`
      upcoming = { n: Number(u[0]?.n ?? 0), sales: Number(u[0]?.sales ?? 0) }
    } catch (e) {
      console.error("[databases/bc] upcoming count failed:", e)
    }
    const a = agg[0]; const n = Number(a?.n ?? 0), inHub = Number(a?.inhub ?? 0), siteOnly = Number(a?.siteonly ?? 0)
    stats = { n, sales: Number(a?.sales ?? 0), from: a?.from ?? null, to: a?.to ?? null, hammer: a?.hammer ?? 0, sold: Number(a?.sold ?? 0), longDesc: Number(a?.longdesc ?? 0), inHub, fullSize: Number(a?.fullsize ?? 0), siteOnly, noPhoto: n - inHub - siteOnly }
    await Promise.all(rows.map(async row => {
      row.photo = row.photoKey ? await getSignedImageUrl(row.photoKey, 3600).catch(() => null)
        : row.sitePhoto ? SITE_IMAGES + String(row.sitePhoto).replace("/large/", "/medium/") : null
      row.photoFull = row.photoXlKey ? await getSignedImageUrl(row.photoXlKey, 3600).catch(() => row.photo)
        : row.sitePhoto ? SITE_IMAGES + String(row.sitePhoto).replace("/large/", "/xlarge/") : row.photo
    }))
  } catch (e: any) {
    tableError = /does not exist|relation/i.test(String(e?.message)) ? "The BC Database table isn't there yet — Run Migrations on this environment first." : (e?.message ?? "Couldn't read the BC database")
  }
  const pages = Math.max(1, Math.ceil(total / PAGE))

  // ⚠ Measured, not worked out from the data: a full run on 2026-09-09 found Business Central
  // sales between site numbers 1062 (B007) and 1558, with the old system below that. The margin
  // past the end catches sales the website has added since.
  // ⚠ How far the collection has got, read off the lots themselves, so "where do I start next
  // time" is a fact rather than something to remember. Migration-safe — the column is new, and an
  // environment that has not run migrations simply shows nothing instead of breaking the page.
  // ⚠⚠ THE COUNT IS READ ALONGSIDE THE MARKER, AND BOTH ARE SHOWN. `siteSaleId` arrived after the
  // table and `writeBcSale` falls back cleanly without it, so every lot loaded before the column
  // existed carries NULL — `max()` is then null although the database is full. The panel said
  // "Nothing collected yet", the instructions it hands to Claude said "that is the whole range",
  // and a year of sales was collected again for nothing (Jordan, 2026-09-17: "whats the point
  // pulling in data we already have?"). A MISSING MARKER IS NOT AN EMPTY DATABASE — never write
  // anything here that lets one imply the other.
  let collectedTo: number | null = null
  let waitingFrom: number | null = null
  let held = 0
  if (isAdmin) {
    try {
      const r = await prisma.$queryRaw<{ n: number; m: number | null }[]>`SELECT count(*)::int AS n, max("siteSaleId") AS m FROM "BcLotWeb"`
      held = Number(r[0]?.n ?? 0)
      collectedTo = r[0]?.m != null ? Number(r[0].m) : null
      // ⚠⚠ THE HIGHEST SALE COLLECTED IS NOT WHERE TO CARRY ON (2026-09-25). Sale numbers are given
      // when a sale is LISTED, and the website marked sales weeks away as finished, so a run took
      // F115–F127 before they were held and max() said "up to 1566" — the next run started at 1567
      // and a sale held since was never picked up. The next run starts from the FIRST sale not yet
      // properly in: one dated today or later (from its page, recorded on ArchiveSale), or one near
      // the top whose lots came in with no hammer price at all (taken early, before this fix).
      if (collectedTo != null) {
        try {
          const w = await prisma.$queryRaw<{ m: number | null }[]>`
            SELECT min(x) AS m FROM (
              SELECT min(s."siteId") AS x FROM "ArchiveSale" s
               WHERE s."siteId" >= ${BC_FIRST_SITE_SALE} AND s."siteId" <= ${collectedTo}
                 AND s."saleDate" >= (now() AT TIME ZONE 'Europe/London')::date
              UNION ALL
              SELECT min(g.id) FROM (
                SELECT b."siteSaleId" AS id FROM "BcLotWeb" b
                 WHERE b."siteSaleId" > ${collectedTo - 60}
                 GROUP BY b."siteSaleId" HAVING count(b."siteHammerPrice") = 0
              ) g
            ) t`
          waitingFrom = w[0]?.m != null ? Number(w[0].m) : null
        } catch (e) {
          console.error("[databases/bc] couldn't work out the first sale still waiting:", e)
        }
      }
    } catch {
      // No siteSaleId column here yet — the count still answers "is there anything at all?".
      try {
        const r = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "BcLotWeb"`
        held = Number(r[0]?.n ?? 0)
      } catch { held = 0 }
      collectedTo = null
    }
  }
  const collect = { from: waitingFrom ?? (collectedTo ? collectedTo + 1 : BC_FIRST_SITE_SALE), to: Math.max(BC_LAST_SITE_SALE, collectedTo ?? 0) + 60 }
  // ⚠ EVERY filter travels with a page change and with a sort. Page 2 quietly reverting to
  // unfiltered and newest-first is what made the filters feel broken.
  const carry = () => {
    const u = new URLSearchParams()
    for (const k of FILTERS) { const v = one(sp[k]).trim(); if (v) u.set(k, v) }
    return u
  }
  const link = (p: number) => { const u = carry(); if (order) u.set("order", order); u.set("page", String(p)); return `/databases/bc?${u}` }
  // Clicking a column sorts it the way that column is normally wanted first — newest sale, biggest
  // hammer, lot 1 upwards — and clicking it again turns it round.
  const NATURAL: Record<string, "asc" | "desc"> = { date: "desc", sale: "desc", lot: "asc", est: "desc", hammer: "desc" }
  const current = order || "date_desc"
  const sortHref = (f: string) => {
    const nat = NATURAL[f]
    const dir = current === `${f}_${nat}` ? (nat === "desc" ? "asc" : "desc") : nat
    const u = carry(); u.set("order", `${f}_${dir}`)
    return `/databases/bc?${u}`
  }
  const arrow = (f: string) => current === `${f}_desc` ? " ▼" : current === `${f}_asc` ? " ▲" : ""
  const input = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-violet-500"
  const sortCls = "hover:text-violet-600 dark:hover:text-violet-400"
  const pct = (x: number) => stats?.n ? Math.round((x / stats.n) * 100) : 0
  const tile = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] px-4 py-3"
  const big = "text-2xl font-bold text-gray-900 dark:text-white tabular-nums", lbl = "text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400", sub = "text-xs text-gray-500 dark:text-gray-400 mt-0.5"
  const code = "font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded"

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0D0D0F] text-gray-900 dark:text-gray-100">
      <div className="px-4 py-6 space-y-5">
        <div>
          <Link href="/databases" className="text-sm text-gray-500 hover:text-gray-300">← Databases</Link>
          <h1 className="text-xl font-bold mt-1">BC Database</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Every lot sold through Business Central — sale, lot, estimate and hammer from the nightly BC sync, with the full description, photo and link matched from the website.</p>
        </div>

        {stats && stats.n > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={tile}><div className={lbl}>Lots in the BC database</div><div className={big}>{stats.n.toLocaleString()}</div>
              <div className={sub}>{stats.sales.toLocaleString()} sales held · {fmtDate(stats.from)} → {fmtDate(stats.to)}</div>
              {upcoming && upcoming.n > 0 && <div className={`${sub} text-sky-600 dark:text-sky-400`}>+ {upcoming.n.toLocaleString()} upcoming lots in {upcoming.sales.toLocaleString()} sales</div>}</div>
            <div className={tile}><div className={lbl}>Sold</div><div className={big}>{stats.sold.toLocaleString()}</div>
              <div className={sub}>hammer total {fmtGBP(stats.hammer)} · {(stats.n - stats.sold).toLocaleString()} unsold</div></div>
            <div className={tile}><div className={lbl}>Photos in the Hub</div><div className={big}>{stats.inHub.toLocaleString()} <span className="text-base font-semibold text-gray-500">({pct(stats.inHub)}%)</span></div>
              <div className={sub}>{stats.fullSize.toLocaleString()} full-size backups · {stats.siteOnly.toLocaleString()} still on the website only · {stats.noPhoto.toLocaleString()} not matched yet</div>
              <div className="mt-2 h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${pct(stats.inHub)}%` }} /></div></div>
            <div className={tile}><div className={lbl}>Full descriptions from the website</div><div className={big}>{stats.longDesc.toLocaleString()} <span className="text-base font-semibold text-gray-500">({pct(stats.longDesc)}%)</span></div>
              <div className={sub}>the rest show BC's short description until the pull reaches their sale</div></div>
          </div>
        )}

        {/* ⚠ ONE tools block, not four competing panels (Jordan, 2026-09-09: "its become a mess UI
            wise"). Each tool is a compact card: what it is, its button, a line of live status. The
            explanations sit behind a "What this does" toggle — they are read once and then in the
            way for ever, and between them they pushed the search box and the lots off the screen. */}
        {isAdmin && (
          <BcTools
            jobs={<ArchiveSite scope="bc" />}
            load={<BcCollect defaultFrom={collect.from} defaultTo={collect.to} collectedTo={collectedTo} held={held} />}
            exportPanel={
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">⬇ Export &amp; handover — for a backup, or a future website</h3>
                <div className="mt-3 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                  <div className="flex flex-wrap items-center gap-3">
                    <a href="/api/databases/bc/export" className="min-h-[44px] inline-flex items-center px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">⬇ Export data (CSV)</a>
                    <span className="text-gray-600 dark:text-gray-400">Every lot, one row each: BC's figures, the website's full description, both photo file names and the site link. Streams as it goes.</span>
                  </div>
                  <p><span className="font-semibold text-gray-900 dark:text-white">Where the photos live.</span> Cloudflare R2, bucket <code className={code}>{process.env.CLOUDFLARE_R2_BUCKET ?? "(not set)"}</code>, two files per lot named by its BC unique ID:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><code className={code}>bc-photos/xl/&#123;UniqueID&#125;.webp</code> — full size (about 250 KB)</li>
                    <li><code className={code}>bc-photos/&#123;UniqueID&#125;.webp</code> — small display copy (about 23 KB)</li>
                  </ul>
                  <p className="text-gray-600 dark:text-gray-400">Handover works exactly as on the ABC Database page: the CSV plus a read-only R2 token, copied bucket-to-bucket. The lot data itself lives in Business Central and is re-synced nightly.</p>
                </div>
              </div>
            }
          />
        )}

        {/* ⚠ The filters are ON SCREEN, not hidden behind "More filters" (Jordan, 2026-09-09: "the
            filtering options are still awful"). Every one of them is carried through paging AND
            through a sort, and every column that can be ordered says which way it is going. */}
        <form method="get" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input name="q" defaultValue={q} placeholder="Search descriptions or a unique ID — e.g. Corgi 267, Steiff, R009030-1" className={input} />
            <button type="submit" className="min-h-[44px] px-5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Search</button>
            <Link href="/databases/bc" className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500 text-sm text-gray-700 dark:text-gray-300">Clear</Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input name="sale" defaultValue={sale} placeholder="Sale — name or code (F111)" className={input} />
            <label className="flex items-center gap-2"><span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 shrink-0">From</span><input type="date" name="from" defaultValue={dFrom} className={`${input} w-full dark:[color-scheme:dark]`} /></label>
            <label className="flex items-center gap-2"><span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 shrink-0">To</span><input type="date" name="to" defaultValue={dTo} className={`${input} w-full dark:[color-scheme:dark]`} /></label>
            <select name="status" defaultValue={status} className={input} aria-label="Sold, unsold or upcoming">
              <option value="">Held and upcoming</option>
              <option value="held">Held only</option>
              <option value="sold">Sold only</option>
              <option value="unsold">Unsold only</option>
              <option value="upcoming">Upcoming only</option>
            </select>
            <input name="min" defaultValue={one(sp.min)} placeholder="Hammer from £" inputMode="numeric" className={input} />
            <input name="max" defaultValue={one(sp.max)} placeholder="Hammer to £" inputMode="numeric" className={input} />
            <select name="photo" defaultValue={photo} className={input} aria-label="Whether the lot has a photo">
              <option value="">Any photo</option>
              <option value="yes">Has a photo</option>
              <option value="no">No photo yet</option>
            </select>
            <select name="desc" defaultValue={desc} className={input} aria-label="Which description the lot has">
              <option value="">Any description</option>
              <option value="full">Full description</option>
              <option value="short">Short one only</option>
            </select>
          </div>
          {/* ⚠ Keeps the chosen sort when the form is submitted — without it every search threw
              the ordering away and dropped back to newest-first. */}
          {order && <input type="hidden" name="order" value={order} />}
        </form>

        {tableError ? (
          <p className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">⚠ {tableError}</p>
        ) : stats && stats.n === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">Nothing here yet — the BC sync hasn't loaded any sold lots. Run Data Sync first.</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">{total.toLocaleString()} {total === 1 ? "lot" : "lots"}{anyFilter ? " match" : ""} · page {page} of {pages}
              <span className="ml-3 text-xs">Photo in Hub: <span className="font-bold text-emerald-600 dark:text-emerald-400">✓</span> copied into the Hub · <span className="text-amber-600 dark:text-amber-400">website only</span> not copied yet · — no photo · <span className="font-semibold text-sky-700 dark:text-sky-300">Upcoming</span> = sale not held yet</span></p>
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-[#141416]">
                  <tr>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2"><Link href={sortHref("date")} className={sortCls}>Date{arrow("date")}</Link></th>
                    <th className="px-3 py-2"><Link href={sortHref("sale")} className={sortCls}>Sale{arrow("sale")}</Link></th>
                    <th className="px-3 py-2 text-right"><Link href={sortHref("lot")} className={sortCls}>Lot{arrow("lot")}</Link></th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right"><Link href={sortHref("est")} className={sortCls}>Estimate{arrow("est")}</Link></th>
                    <th className="px-3 py-2 text-right"><Link href={sortHref("hammer")} className={sortCls}>Hammer{arrow("hammer")}</Link></th>
                    <th className="px-3 py-2 text-center whitespace-nowrap" title="Whether this lot's photo has been copied into the Hub">Photo in Hub</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className={`border-t border-gray-100 dark:border-gray-800/70 align-top ${i % 2 ? "bg-white dark:bg-[#141416]/40" : ""}`}>
                      <td className="px-2 py-2 w-16">
                        {r.photo ? <ZoomPhoto thumb={r.photo} full={r.photoFull} /> : <div className="h-14 w-14 rounded-md bg-gray-100 dark:bg-gray-800/60" />}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">
                        {fmtDate(r.auctionDate)}
                        {r.auctionDate && r.auctionDate > todayLondon && <div className="mt-1 inline-block rounded bg-sky-100 dark:bg-sky-900/40 px-1.5 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300" title="This sale hasn't been held yet">Upcoming</div>}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[220px]">{r.auctionName || `Sale ${r.auctionCode}`}<div className="text-xs text-gray-400">{r.auctionCode}</div></td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                        {r.lotNo ?? "—"}
                        <div className="text-xs text-gray-400 font-mono" title="BC's unique ID">{r.uniqueId}</div>
                        {r.siteLink && <a href={`https://www.vectis.co.uk/${r.siteLink}`} target="_blank" rel="noreferrer" className="block text-xs font-sans text-violet-600 dark:text-violet-400 hover:underline" title="Open this lot on vectis.co.uk">vectis.co.uk ↗</a>}
                      </td>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100 whitespace-pre-line">
                        {/* The website's text was stored as HTML; cleaned here too in case a row hasn't been tidied yet (lib/html-text.ts). */}
                        {r.longDesc ? htmlToText(r.longDesc) : r.shortDesc}
                        {!r.longDesc && <span className="ml-2 text-xs text-gray-400" title="BC's short description — the full one appears once the website pull reaches this sale">short</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-600 dark:text-gray-400">{r.estimateLow == null && r.estimateHigh == null ? "—" : `${fmtGBP(r.estimateLow)} – ${fmtGBP(r.estimateHigh)}`}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                        {r.hammerPrice == null
                          ? <span className="font-normal text-gray-400">{r.auctionDate && r.auctionDate > todayLondon ? "—" : "unsold"}</span>
                          : fmtGBP(r.hammerPrice)}
                        {r.siteHammerPrice != null && r.siteHammerPrice !== r.hammerPrice && <div className="text-xs font-normal text-amber-600 dark:text-amber-400" title="The website shows a different hammer price for this lot">site {fmtGBP(r.siteHammerPrice)}</div>}
                      </td>
                      {/* Our own copy in R2 (photoKey) = downloaded. The website's path alone means it is still only on vectis.co.uk. */}
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        {r.photoKey
                          ? <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400" title="Photo copied into the Hub">✓</span>
                          : r.sitePhoto
                            ? <span className="text-xs text-amber-600 dark:text-amber-400" title="Photo is on the website but not copied into the Hub yet">website only</span>
                            : <span className="text-gray-400" title="No photo found for this lot">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center gap-2 text-sm">
                {page > 1 && <Link href={link(page - 1)} className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500">← Previous</Link>}
                <span className="text-gray-500">page {page} of {pages}</span>
                {page < pages && <Link href={link(page + 1)} className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500">Next →</Link>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
