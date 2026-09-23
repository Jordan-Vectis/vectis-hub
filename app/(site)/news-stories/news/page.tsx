import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { articlePicture, StoryCard, PageLink, type Article } from "./shared"

// News & Stories on the test website, read from Databases → News (every article on vectis.co.uk,
// collected on an office machine). Its own design, not the live site's: a header with search and
// a category pick, the featured stories, then every story newest first, 24 a page.

export const dynamic = "force-dynamic"
export const metadata = {
  title: "News & Stories",
  description: "Sold prices, stories and news from the world's leading toy and collectables auction house.",
}

const PAGE = 24

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ search?: string; category?: string; page?: string }> }) {
  const { search, category, page } = await searchParams
  const q = (search ?? "").trim()
  const cat = (category ?? "").trim()
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1)
  const filtering = !!(q || cat)

  let rows: (Article & { photo: string | null })[] = [], total = 0, cats: { category: string; n: number }[] = []
  let featured: (Article & { photo: string | null })[] = []
  let unavailable: string | null = null
  try {
    const conds: Prisma.Sql[] = [Prisma.sql`1 = 1`]
    if (q) conds.push(Prisma.sql`(a."title" ILIKE ${"%" + q + "%"} OR a."fullText" ILIKE ${"%" + q + "%"})`)
    if (cat) conds.push(Prisma.sql`a."category" = ${cat}`)
    const where = Prisma.join(conds, " AND ")
    const cols = Prisma.sql`a."id", a."alias", a."title", a."category", a."tags", a."featured", a."publishedAt", a."introText", a."fullText", a."imagePath", a."imageKey", a."bodyHtml"`
    const [r, t, cs, f] = await Promise.all([
      prisma.$queryRaw<Article[]>`SELECT ${cols} FROM "SiteNewsArticle" a WHERE ${where} ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT ${PAGE} OFFSET ${(currentPage - 1) * PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "SiteNewsArticle" a WHERE ${where}`,
      prisma.$queryRaw<{ category: string; n: bigint }[]>`SELECT a."category", count(*)::bigint AS n FROM "SiteNewsArticle" a WHERE a."category" IS NOT NULL GROUP BY a."category" ORDER BY a."category"`,
      !filtering && currentPage === 1
        ? prisma.$queryRaw<Article[]>`SELECT ${cols} FROM "SiteNewsArticle" a WHERE a."featured" ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT 3`
        : Promise.resolve([] as Article[]),
    ])
    total = Number(t[0]?.n ?? 0)
    cats = cs.map(c => ({ category: c.category, n: Number(c.n) }))
    rows = await Promise.all(r.map(async a => ({ ...a, photo: await articlePicture(a) })))
    featured = await Promise.all(f.map(async a => ({ ...a, photo: await articlePicture(a) })))
  } catch (e) {
    unavailable = String((e as { message?: string })?.message ?? "")
  }
  const pages = Math.max(1, Math.ceil(total / PAGE))

  const pageHref = (p: number) => {
    const sp = new URLSearchParams()
    if (q) sp.set("search", q)
    if (cat) sp.set("category", cat)
    if (p > 1) sp.set("page", String(p))
    const s = sp.toString()
    return s ? `/news-stories/news?${s}` : "/news-stories/news"
  }

  return (
    <div>
      {/* ── Page header ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">From the saleroom</p>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-[#32348A] uppercase tracking-tight">News &amp; Stories</h1>
              <p className="text-gray-500 text-sm mt-1">Sold prices, stories and news from the world&apos;s leading toy and collectables auction house.</p>
            </div>
            <form method="GET" action="/news-stories/news" className="flex flex-wrap items-center gap-2">
              <div className="flex items-center border border-gray-300 bg-white overflow-hidden">
                <span className="px-3 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                </span>
                <input name="search" defaultValue={q} placeholder="Search the news…" className="py-2 pr-3 text-sm focus:outline-none w-52" />
              </div>
              <select name="category" defaultValue={cat} className="border border-gray-300 px-3 py-2 text-sm focus:outline-none" aria-label="Category">
                <option value="">All categories</option>
                {cats.map(c => <option key={c.category} value={c.category}>{c.category}</option>)}
              </select>
              <button type="submit" className="bg-[#32348A] text-white text-xs font-bold uppercase tracking-widest px-5 py-2.5 hover:bg-[#28296e] transition-colors">GO</button>
              {filtering && <Link href="/news-stories/news" className="text-xs text-gray-400 hover:text-[#32348A] underline">Clear</Link>}
            </form>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-12">
        {unavailable ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">The news isn&apos;t available here yet.</p>
            <p className="text-gray-300 text-xs mt-2">{unavailable}</p>
          </div>
        ) : (
          <>
            {featured.length > 0 && (
              <section>
                <div className="mb-5">
                  <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">Don&apos;t miss</p>
                  <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">Featured stories</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {featured.map(a => <StoryCard key={a.id} a={a} big />)}
                </div>
              </section>
            )}

            <section>
              <div className="flex flex-wrap items-end justify-between gap-2 mb-5">
                <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">
                  {cat ? cat : q ? `Stories matching “${q}”` : "Latest stories"}
                </h2>
                <p className="text-xs text-gray-400">{total.toLocaleString("en-GB")} {total === 1 ? "story" : "stories"} · page {currentPage} of {pages}</p>
              </div>
              {rows.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 text-lg">{filtering ? "No stories match." : "No stories yet."}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {rows.map(a => <StoryCard key={a.id} a={a} />)}
                </div>
              )}
              {pages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-10 flex-wrap">
                  {currentPage > 1 && <PageLink href={pageHref(currentPage - 1)} label="← Prev" />}
                  {Array.from({ length: pages }, (_, i) => i + 1)
                    .filter(p => Math.abs(p - currentPage) <= 2 || p === 1 || p === pages)
                    .map(p => <PageLink key={p} href={pageHref(p)} label={String(p)} active={p === currentPage} />)}
                  {currentPage < pages && <PageLink href={pageHref(currentPage + 1)} label="Next →" />}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
