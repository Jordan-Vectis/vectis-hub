import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import { BC_FIRST_SITE_SALE } from "@/lib/bc-web-collector"
import SalesTools from "./sales-tools"

// Databases → Sales: every sale the website knows — ABC and Business Central alike — with its
// cover picture (the "hero" the website shows on the auction calendar), title, date, code and
// lot count. Jordan, 2026-09-22: "On our current website we have the hero (preview image for the
// entire auction) is it possible to get them as well? … Why don't we make a new tab for them in
// databases?"
//
// Where the rows come from: ArchiveSale, written by the website walk (older sales) and by the
// office collector's files loaded on the BC Database page (which now record each sale's title,
// date and hero as well as its lots). The picture shows the Hub's own R2 copy once "Copy sale
// pictures" has run, else the website's original on Amazon S3 — which, unlike the lot feed, the
// Hub's server CAN fetch. Server-rendered, 60 a page.
const PAGE = 60
type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "date unknown")

type Row = { siteId: number; auctionId: number | null; title: string; saleDate: Date | null; lots: number; finished: boolean; code: string | null; heroUrl: string | null; heroKey: string | null; photo?: string | null }
type Stats = { n: number; withHero: number; copied: number; bc: number; abc: number; from: Date | null; to: Date | null }

export default async function SalesDatabasePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"
  const sp = await searchParams
  const q = one(sp.q).trim(), year = one(sp.year).trim(), era = one(sp.era).trim(), photo = one(sp.photo).trim(), order = one(sp.order).trim()
  const page = Math.max(1, parseInt(one(sp.page)) || 1)
  const FILTERS = ["q", "year", "era", "photo"] as const
  const anyFilter = FILTERS.some(k => one(sp[k]).trim())

  const conds: Prisma.Sql[] = [Prisma.sql`1 = 1`]
  if (q) conds.push(Prisma.sql`(s."title" ILIKE ${"%" + q + "%"} OR s."code" ILIKE ${"%" + q + "%"} OR s."siteId"::text = ${q})`)
  if (/^\d{4}$/.test(year)) conds.push(Prisma.sql`EXTRACT(YEAR FROM s."saleDate") = ${Number(year)}`)
  if (era === "bc") conds.push(Prisma.sql`s."siteId" >= ${BC_FIRST_SITE_SALE}`)
  if (era === "abc") conds.push(Prisma.sql`s."siteId" < ${BC_FIRST_SITE_SALE}`)
  if (photo === "yes") conds.push(Prisma.sql`s."heroUrl" IS NOT NULL`)
  if (photo === "no") conds.push(Prisma.sql`s."heroUrl" IS NULL`)
  const where = Prisma.join(conds, " AND ")
  // ⚠ A fixed map, never the query string — this goes into raw SQL.
  const ORDERS: Record<string, Prisma.Sql> = {
    date_desc: Prisma.sql`s."saleDate" DESC NULLS LAST, s."siteId" DESC`,
    date_asc:  Prisma.sql`s."saleDate" ASC NULLS LAST, s."siteId" ASC`,
    lots_desc: Prisma.sql`s."lots" DESC, s."saleDate" DESC NULLS LAST`,
    id_desc:   Prisma.sql`s."siteId" DESC`,
  }
  const orderBy = ORDERS[order] ?? ORDERS.date_desc

  let rows: Row[] = [], total = 0, stats: Stats | null = null, years: number[] = [], tableError: string | null = null, needMigration = false
  try {
    const [r, t, agg, ys] = await Promise.all([
      prisma.$queryRaw<Row[]>`
        SELECT s."siteId", s."auctionId", s."title", s."saleDate", s."lots", s."finished", s."code", s."heroUrl", s."heroKey"
        FROM "ArchiveSale" s WHERE ${where} ORDER BY ${orderBy} LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "ArchiveSale" s WHERE ${where}`,
      prisma.$queryRaw<{ n: bigint; withhero: bigint; copied: bigint; bc: bigint; from: Date | null; to: Date | null }[]>`
        SELECT count(*)::bigint AS n, count(s."heroUrl")::bigint AS withhero, count(s."heroKey")::bigint AS copied,
               count(*) FILTER (WHERE s."siteId" >= ${BC_FIRST_SITE_SALE})::bigint AS bc, min(s."saleDate") AS "from", max(s."saleDate") AS "to"
        FROM "ArchiveSale" s`,
      prisma.$queryRaw<{ y: number }[]>`SELECT DISTINCT EXTRACT(YEAR FROM "saleDate")::int AS y FROM "ArchiveSale" WHERE "saleDate" IS NOT NULL ORDER BY y DESC`,
    ])
    rows = r; total = Number(t[0]?.n ?? 0)
    const a = agg[0]; const n = Number(a?.n ?? 0), bc = Number(a?.bc ?? 0)
    stats = { n, withHero: Number(a?.withhero ?? 0), copied: Number(a?.copied ?? 0), bc, abc: n - bc, from: a?.from ?? null, to: a?.to ?? null }
    years = ys.map(x => Number(x.y)).filter(Number.isFinite)
  } catch (e: any) {
    const msg = String(e?.message ?? "")
    if (/heroUrl|heroKey|"code"/i.test(msg)) {
      // The picture columns arrive with Run Migrations; until then the sales still list, without pictures.
      needMigration = true
      try {
        const [r, t] = await Promise.all([
          prisma.$queryRaw<Row[]>`SELECT s."siteId", s."auctionId", s."title", s."saleDate", s."lots", s."finished", NULL::text AS "code", NULL::text AS "heroUrl", NULL::text AS "heroKey" FROM "ArchiveSale" s ORDER BY s."saleDate" DESC NULLS LAST, s."siteId" DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
          prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "ArchiveSale" s`,
        ])
        rows = r; total = Number(t[0]?.n ?? 0)
      } catch (e2: any) { tableError = e2?.message ?? "Couldn't read the sales" }
    } else {
      tableError = /does not exist|relation/i.test(msg) ? "The sales table isn't there yet — Run Migrations on this environment first." : (msg || "Couldn't read the sales")
    }
  }
  const pages = Math.max(1, Math.ceil(total / PAGE))
  await Promise.all(rows.map(async r => {
    r.photo = r.heroKey ? await getSignedImageUrl(r.heroKey, 3600).catch(() => null) : r.heroUrl ? SITE_IMAGES + r.heroUrl : null
  }))
  const toCopy = stats ? stats.withHero - stats.copied : 0

  const carry = () => { const u = new URLSearchParams(); for (const k of FILTERS) { const v = one(sp[k]).trim(); if (v) u.set(k, v) } if (order) u.set("order", order); return u }
  const link = (p: number) => { const u = carry(); u.set("page", String(p)); return `/databases/sales?${u}` }
  const input = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-violet-500"
  const tile = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] px-4 py-3"
  const big = "text-2xl font-bold text-gray-900 dark:text-white tabular-nums", lbl = "text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400", sub = "text-xs text-gray-500 dark:text-gray-400 mt-0.5"
  const pct = (x: number) => stats?.n ? Math.round((x / stats.n) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0D0D0F] text-gray-900 dark:text-gray-100">
      <div className="px-4 py-6 space-y-5">
        <div>
          <Link href="/databases" className="text-sm text-gray-500 hover:text-gray-300">← Databases</Link>
          <h1 className="text-xl font-bold mt-1">Sales</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Every sale on vectis.co.uk — ABC and Business Central — with its cover picture, date, code and lot count. The pictures are the ones the website shows on its auction calendar.</p>
        </div>

        {stats && stats.n > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={tile}><div className={lbl}>Sales</div><div className={big}>{stats.n.toLocaleString()}</div>
              <div className={sub}>{fmtDate(stats.from)} → {fmtDate(stats.to)}</div></div>
            <div className={tile}><div className={lbl}>Business Central · ABC</div><div className={big}>{stats.bc.toLocaleString()} <span className="text-base font-semibold text-gray-500">· {stats.abc.toLocaleString()}</span></div>
              <div className={sub}>BC sales start at website sale {BC_FIRST_SITE_SALE}</div></div>
            <div className={tile}><div className={lbl}>With a picture</div><div className={big}>{stats.withHero.toLocaleString()} <span className="text-base font-semibold text-gray-500">({pct(stats.withHero)}%)</span></div>
              <div className={sub}>{(stats.n - stats.withHero).toLocaleString()} not collected yet — they arrive with the lot collection</div></div>
            <div className={tile}><div className={lbl}>Pictures copied into the Hub</div><div className={big}>{stats.copied.toLocaleString()} <span className="text-base font-semibold text-gray-500">({stats.withHero ? Math.round((stats.copied / stats.withHero) * 100) : 0}%)</span></div>
              <div className={sub}>{toCopy > 0 ? `${toCopy.toLocaleString()} still only on the website` : "every collected picture is in the Hub"}</div>
              <div className="mt-2 h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${stats.withHero ? Math.round((stats.copied / stats.withHero) * 100) : 0}%` }} /></div></div>
          </div>
        )}

        {needMigration && (
          <p className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">The sale-picture columns aren&apos;t on this environment yet — press Run Migrations on the Admin page. The sales still list below, without pictures.</p>
        )}

        {isAdmin && !needMigration && <SalesTools toCopy={toCopy} withHero={stats?.withHero ?? 0} />}

        <form method="get" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input name="q" defaultValue={q} placeholder="Search a sale — name, code (F111) or website sale number" className={input} />
            <button type="submit" className="min-h-[44px] px-5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Search</button>
            <Link href="/databases/sales" className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500 text-sm text-gray-700 dark:text-gray-300">Clear</Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select name="year" defaultValue={year} className={input} aria-label="Year">
              <option value="">Any year</option>
              {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
            <select name="era" defaultValue={era} className={input} aria-label="Which system">
              <option value="">ABC and Business Central</option>
              <option value="bc">Business Central only</option>
              <option value="abc">ABC only</option>
            </select>
            <select name="photo" defaultValue={photo} className={input} aria-label="Whether the sale has a picture">
              <option value="">Any picture</option>
              <option value="yes">Has a picture</option>
              <option value="no">No picture yet</option>
            </select>
            <select name="order" defaultValue={order || "date_desc"} className={input} aria-label="Order">
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="lots_desc">Most lots first</option>
              <option value="id_desc">Website sale number</option>
            </select>
          </div>
        </form>

        {tableError ? (
          <p className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">⚠ {tableError}</p>
        ) : total === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">{anyFilter ? "No sale matches those filters." : "No sales here yet — they arrive when lot files are loaded on the BC Database page, or when the website walk runs."}</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">{total.toLocaleString()} {total === 1 ? "sale" : "sales"}{anyFilter ? " match" : ""} · page {page} of {pages}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {rows.map(r => {
                const isBc = r.siteId >= BC_FIRST_SITE_SALE
                const lotsHref = isBc
                  ? (r.code ? `/databases/bc?sale=${encodeURIComponent(r.code)}` : null)
                  : `/databases/archive?sale=${encodeURIComponent(r.title)}`
                return (
                  <div key={r.siteId} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] overflow-hidden flex flex-col">
                    <a href={`https://www.vectis.co.uk/bidding/0-x-${r.siteId}`} target="_blank" rel="noreferrer" className="block aspect-[16/10] bg-gray-100 dark:bg-gray-800/60" title="Open this sale on vectis.co.uk">
                      {r.photo
                        ? <img src={r.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
                        : <div className="h-full w-full flex items-center justify-center text-xs text-gray-400">no picture yet</div>}
                    </a>
                    <div className="p-3 space-y-1 flex-1 flex flex-col">
                      <div className="font-semibold text-gray-900 dark:text-white leading-snug line-clamp-2" title={r.title}>{r.title}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">{fmtDate(r.saleDate)}{r.lots ? ` · ${r.lots.toLocaleString()} lots` : ""}{r.finished ? "" : " · not finished"}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {isBc ? (r.code ?? "BC") : `ABC${r.auctionId ? ` · auction ${r.auctionId}` : ""}`} · site {r.siteId}
                      </div>
                      <div className="mt-auto pt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {lotsHref && <Link href={lotsHref} className="text-violet-600 dark:text-violet-400 hover:underline">The lots →</Link>}
                        <a href={`https://www.vectis.co.uk/bidding/0-x-${r.siteId}`} target="_blank" rel="noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">vectis.co.uk ↗</a>
                        {r.photo && r.heroKey && <span className="text-gray-400" title={`Our copy: ${r.heroKey}`}>in the Hub</span>}
                        {r.photo && !r.heroKey && <span className="text-gray-400" title="Shown from the website's own storage until Copy sale pictures runs">website only</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
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
