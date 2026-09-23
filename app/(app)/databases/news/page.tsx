import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import NewsTools from "./news-tools"

// Databases → News: every News & Stories article on vectis.co.uk — title, full text, category,
// tags, date and cover picture. Jordan, 2026-09-23: "how can we scrape the news articles off the
// site along with the images?" — for the test website's News & Stories pages.
//
// Where the rows come from: the site's news is a Joomla blog with a JSON feed that carries the full
// text; scripts/collect-news.mjs pulls it on an office machine (the website refuses the Hub's
// server) and downloads each cover picture into a folder. The file is loaded here and the pictures
// are uploaded straight into R2 from that folder (📥 Update the news). Until a picture is in the
// Hub the card shows the website's own file. Server-rendered, 48 a page.
const PAGE = 48
const SITE = "https://www.vectis.co.uk/"
type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "no date")

type Row = {
  id: number; alias: string; title: string; sefLink: string | null; category: string | null; tags: string[]
  featured: boolean; hits: number; publishedAt: Date | null; imagePath: string | null; imageKey: string | null; photo?: string | null
}
type Stats = { n: number; withPicture: number; inHub: number; featured: number; from: Date | null; to: Date | null }
type Cat = { category: string; n: number }

export default async function NewsDatabasePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"
  const sp = await searchParams
  const q = one(sp.q).trim(), cat = one(sp.cat).trim(), year = one(sp.year).trim(), photo = one(sp.photo).trim(), order = one(sp.order).trim()
  const page = Math.max(1, parseInt(one(sp.page)) || 1)
  const FILTERS = ["q", "cat", "year", "photo"] as const
  const anyFilter = FILTERS.some(k => one(sp[k]).trim())

  const conds: Prisma.Sql[] = [Prisma.sql`1 = 1`]
  if (q) conds.push(Prisma.sql`(a."title" ILIKE ${"%" + q + "%"} OR a."fullText" ILIKE ${"%" + q + "%"} OR a."id"::text = ${q})`)
  if (cat) conds.push(Prisma.sql`a."category" = ${cat}`)
  if (/^\d{4}$/.test(year)) conds.push(Prisma.sql`EXTRACT(YEAR FROM a."publishedAt") = ${Number(year)}`)
  if (photo === "yes") conds.push(Prisma.sql`a."imagePath" IS NOT NULL`)
  if (photo === "no") conds.push(Prisma.sql`a."imagePath" IS NULL`)
  if (photo === "hub") conds.push(Prisma.sql`a."imageKey" IS NOT NULL`)
  if (photo === "website") conds.push(Prisma.sql`a."imagePath" IS NOT NULL AND a."imageKey" IS NULL`)
  const where = Prisma.join(conds, " AND ")
  // ⚠ A fixed map, never the query string — this goes into raw SQL.
  const ORDERS: Record<string, Prisma.Sql> = {
    date_desc: Prisma.sql`a."publishedAt" DESC NULLS LAST, a."id" DESC`,
    date_asc:  Prisma.sql`a."publishedAt" ASC NULLS LAST, a."id" ASC`,
    hits_desc: Prisma.sql`a."hits" DESC, a."publishedAt" DESC NULLS LAST`,
  }
  const orderBy = ORDERS[order] ?? ORDERS.date_desc

  let rows: Row[] = [], total = 0, stats: Stats | null = null, cats: Cat[] = [], years: number[] = [], tableError: string | null = null
  let missing: { id: number; file: string }[] = []
  try {
    const [r, t, agg, cs, ys] = await Promise.all([
      prisma.$queryRaw<Row[]>`
        SELECT a."id", a."alias", a."title", a."sefLink", a."category", a."tags", a."featured", a."hits", a."publishedAt", a."imagePath", a."imageKey"
        FROM "SiteNewsArticle" a WHERE ${where} ORDER BY ${orderBy} LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "SiteNewsArticle" a WHERE ${where}`,
      prisma.$queryRaw<{ n: bigint; withpicture: bigint; inhub: bigint; featured: bigint; from: Date | null; to: Date | null }[]>`
        SELECT count(*)::bigint AS n, count(a."imagePath")::bigint AS withpicture, count(a."imageKey")::bigint AS inhub,
               count(*) FILTER (WHERE a."featured")::bigint AS featured, min(a."publishedAt") AS "from", max(a."publishedAt") AS "to"
        FROM "SiteNewsArticle" a`,
      prisma.$queryRaw<{ category: string; n: bigint }[]>`SELECT a."category", count(*)::bigint AS n FROM "SiteNewsArticle" a WHERE a."category" IS NOT NULL GROUP BY a."category" ORDER BY a."category"`,
      prisma.$queryRaw<{ y: number }[]>`SELECT DISTINCT EXTRACT(YEAR FROM "publishedAt")::int AS y FROM "SiteNewsArticle" WHERE "publishedAt" IS NOT NULL ORDER BY y DESC`,
    ])
    rows = r; total = Number(t[0]?.n ?? 0)
    const a = agg[0]
    stats = { n: Number(a?.n ?? 0), withPicture: Number(a?.withpicture ?? 0), inHub: Number(a?.inhub ?? 0), featured: Number(a?.featured ?? 0), from: a?.from ?? null, to: a?.to ?? null }
    cats = cs.map(c => ({ category: c.category, n: Number(c.n) }))
    years = ys.map(x => Number(x.y)).filter(Number.isFinite)
    if (isAdmin) {
      // Which pictures the upload step still needs — the file name the collector gave each one.
      const m = await prisma.$queryRaw<{ id: number; imagePath: string }[]>`SELECT a."id", a."imagePath" FROM "SiteNewsArticle" a WHERE a."imagePath" IS NOT NULL AND a."imageKey" IS NULL ORDER BY a."id"`
      missing = m.map(x => ({ id: x.id, file: `${x.id}${(x.imagePath.split("?")[0].match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase()}` }))
    }
  } catch (e: any) {
    const msg = String(e?.message ?? "")
    tableError = /does not exist|relation/i.test(msg) ? "The news table isn't there yet — press Run Migrations on this environment first." : (msg || "Couldn't read the articles")
  }
  const pages = Math.max(1, Math.ceil(total / PAGE))
  await Promise.all(rows.map(async r => {
    r.photo = r.imageKey ? await getSignedImageUrl(r.imageKey, 3600).catch(() => null) : r.imagePath ? SITE + r.imagePath : null
  }))

  const carry = () => { const u = new URLSearchParams(); for (const k of FILTERS) { const v = one(sp[k]).trim(); if (v) u.set(k, v) } if (order) u.set("order", order); return u }
  const link = (p: number) => { const u = carry(); u.set("page", String(p)); return `/databases/news?${u}` }
  const input = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-violet-500"
  const tile = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] px-4 py-3"
  const big = "text-2xl font-bold text-gray-900 dark:text-white tabular-nums", lbl = "text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400", sub = "text-xs text-gray-500 dark:text-gray-400 mt-0.5"
  const pct = (x: number, of: number) => (of ? Math.round((x / of) * 100) : 0)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0D0D0F] text-gray-900 dark:text-gray-100">
      <div className="px-4 py-6 space-y-5">
        <div>
          <Link href="/databases" className="text-sm text-gray-500 hover:text-gray-300">← Databases</Link>
          <h1 className="text-xl font-bold mt-1">News</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Every News &amp; Stories article on vectis.co.uk — title, full text, category, tags, date and cover picture — collected on an office machine. The test website&apos;s News &amp; Stories pages read from here.</p>
        </div>

        {stats && stats.n > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={tile}><div className={lbl}>Articles</div><div className={big}>{stats.n.toLocaleString()}</div>
              <div className={sub}>{fmtDate(stats.from)} → {fmtDate(stats.to)} · {stats.featured.toLocaleString()} featured</div></div>
            <div className={tile}><div className={lbl}>Categories</div><div className={big}>{cats.length}</div>
              <div className={sub}>{cats.slice(0, 4).map(c => c.category).join(" · ")}{cats.length > 4 ? " · …" : ""}</div></div>
            <div className={tile}><div className={lbl}>With a cover picture</div><div className={big}>{stats.withPicture.toLocaleString()} <span className="text-base font-semibold text-gray-500">({pct(stats.withPicture, stats.n)}%)</span></div>
              <div className={sub}>{(stats.n - stats.withPicture).toLocaleString()} have none on the website either</div></div>
            <div className={tile}><div className={lbl}>Pictures in the Hub</div><div className={big}>{stats.inHub.toLocaleString()} <span className="text-base font-semibold text-gray-500">({pct(stats.inHub, stats.withPicture)}%)</span></div>
              <div className={sub}>{stats.withPicture - stats.inHub > 0 ? `${(stats.withPicture - stats.inHub).toLocaleString()} still only on the website` : "every collected picture is in the Hub"}</div>
              <div className="mt-2 h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${pct(stats.inHub, stats.withPicture)}%` }} /></div></div>
          </div>
        )}

        {isAdmin && !tableError && <NewsTools missing={missing} held={stats?.n ?? 0} />}

        <form method="get" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input name="q" defaultValue={q} placeholder="Search the articles — a word in the title or the text" className={input} />
            <button type="submit" className="min-h-[44px] px-5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Search</button>
            <Link href="/databases/news" className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500 text-sm text-gray-700 dark:text-gray-300">Clear</Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select name="cat" defaultValue={cat} className={input} aria-label="Category">
              <option value="">Any category</option>
              {cats.map(c => <option key={c.category} value={c.category}>{c.category} ({c.n.toLocaleString()})</option>)}
            </select>
            <select name="year" defaultValue={year} className={input} aria-label="Year">
              <option value="">Any year</option>
              {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
            <select name="photo" defaultValue={photo} className={input} aria-label="Cover picture">
              <option value="">Any picture</option>
              <option value="hub">Picture in the Hub</option>
              <option value="website">Picture still only on the website</option>
              <option value="no">No picture at all</option>
            </select>
            <select name="order" defaultValue={order || "date_desc"} className={input} aria-label="Order">
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="hits_desc">Most read on the website</option>
            </select>
          </div>
        </form>

        {tableError ? (
          <p className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">⚠ {tableError}</p>
        ) : total === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">{anyFilter ? "No article matches those filters." : "No articles here yet — run the collector on an office machine and load its file with 📥 Update the news."}</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">{total.toLocaleString()} {total === 1 ? "article" : "articles"}{anyFilter ? " match" : ""} · page {page} of {pages}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {rows.map(r => (
                <div key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] overflow-hidden flex flex-col">
                  <a href={r.sefLink ? SITE + r.sefLink : SITE + "news-stories/news"} target="_blank" rel="noreferrer" className="block aspect-[16/9] bg-gray-100 dark:bg-gray-800/60" title="Open this article on vectis.co.uk">
                    {r.photo
                      ? <img src={r.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
                      : <div className="h-full w-full flex items-center justify-center text-xs text-gray-400">no picture</div>}
                  </a>
                  <div className="p-3 space-y-1 flex-1 flex flex-col">
                    <div className="text-[11px] uppercase tracking-wider text-violet-600 dark:text-violet-400 font-semibold">{r.category ?? "Uncategorised"}{r.featured ? " · featured" : ""}</div>
                    <div className="font-semibold text-gray-900 dark:text-white leading-snug line-clamp-2" title={r.title}>{r.title}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{fmtDate(r.publishedAt)} · {r.hits.toLocaleString()} reads on the website</div>
                    {r.tags.length > 0 && <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1" title={r.tags.join(", ")}>{r.tags.join(" · ")}</div>}
                    <div className="mt-auto pt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <Link href={`/news-stories/news/${encodeURIComponent(r.alias)}`} className="text-violet-600 dark:text-violet-400 hover:underline">On the test site →</Link>
                      {r.sefLink && <a href={SITE + r.sefLink} target="_blank" rel="noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">vectis.co.uk ↗</a>}
                      {r.photo && r.imageKey && <span className="text-gray-400" title={`Our copy: ${r.imageKey}`}>in the Hub</span>}
                      {r.photo && !r.imageKey && <span className="text-gray-400" title="Shown from the website until its picture is uploaded">website only</span>}
                    </div>
                  </div>
                </div>
              ))}
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
