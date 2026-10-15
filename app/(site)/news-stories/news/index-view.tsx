import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { articlePicture, StoryCard, PageLink, type Article } from "./shared"

// The News & Stories listing on the test website, read from Databases → News (every article on vectis.co.uk,
// collected on an office machine), laid out as the live site lays it out (2026-10-14): the title and a
// line under it, a search box with a category pick and GO, the featured stories as three cards, then
// every story newest first, 24 a page.

const PAGE = 24
// One copy, used by the built-in /news-stories/news page and by the page editor's "News & Stories"
// live block (2026-09-24). Moved here unchanged from page.tsx.

export type NewsParams = { search?: string; category?: string; page?: string }

/** The page numbers to offer: the first, the last, and two either side of the current one; null = a gap. */
function pageNumbers(current: number, pages: number): (number | null)[] {
  const keep = Array.from({ length: pages }, (_, i) => i + 1).filter(p => Math.abs(p - current) <= 2 || p === 1 || p === pages)
  const out: (number | null)[] = []
  keep.forEach((p, i) => {
    if (i > 0 && p - keep[i - 1] > 1) out.push(null)
    out.push(p)
  })
  return out
}

export default async function NewsIndex({ sp, kicker = "From the saleroom", title = "News & Stories", intro = "Sold prices, stories and news from the world's leading toy and collectables auction house." }: { sp: NewsParams; kicker?: string; title?: string; intro?: string }) {
  const { search, category, page } = sp
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
    if (cat) conds.push(Prisma.sql`${cat} = ANY(a."tags")`)   // the site's categories are its tags
    const where = Prisma.join(conds, " AND ")
    const cols = Prisma.sql`a."id", a."alias", a."title", a."category", a."tags", a."featured", a."publishedAt", a."introText", a."fullText", a."imagePath", a."imageKey", a."bodyHtml"`
    const [r, t, cs, f] = await Promise.all([
      prisma.$queryRaw<Article[]>`SELECT ${cols} FROM "SiteNewsArticle" a WHERE ${where} ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT ${PAGE} OFFSET ${(currentPage - 1) * PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "SiteNewsArticle" a WHERE ${where}`,
      prisma.$queryRaw<{ category: string; n: bigint }[]>`SELECT t AS category, count(*)::bigint AS n FROM "SiteNewsArticle" a, unnest(a."tags") AS t GROUP BY t ORDER BY t`,
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
  // A ?page= past the last one (an old link, a typo): there are stories, just none this far along.
  const pastEnd = rows.length === 0 && total > 0

  const pageHref = (p: number) => {
    const sp = new URLSearchParams()
    if (q) sp.set("search", q)
    if (cat) sp.set("category", cat)
    if (p > 1) sp.set("page", String(p))
    const s = sp.toString()
    return s ? `/news-stories/news?${s}` : "/news-stories/news"
  }

  const listHeading = cat ? cat : q ? `Stories matching “${q}”` : "Latest stories"

  return (
    <div className="vs-page bg-white">
      <div className="vs-container">
        {/* ── The page header: back link, centred title, a line under it ── */}
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>
        <header className="text-center max-w-[760px] mx-auto">
          {kicker && <p className="vs-kicker mb-2">{kicker}</p>}
          <h1 className="vs-h1 mb-3">{title}</h1>
          {intro && <p className="vs-lead text-[var(--vs-muted)]">{intro}</p>}
        </header>

        {/* ── Search, category, GO — a GET form, so a search is a link that can be shared ── */}
        <form method="GET" action="/news-stories/news" role="search" className="mt-8 max-w-[760px] mx-auto flex flex-col sm:flex-row gap-3">
          <div className="flex-1 min-w-0">
            <label htmlFor="news-search" className="sr-only">Search the news</label>
            <input id="news-search" type="search" name="search" defaultValue={q} placeholder="Search the news" className="vs-input" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 min-w-0 sm:w-56">
              <label htmlFor="news-category" className="sr-only">Category</label>
              <select id="news-category" name="category" defaultValue={cat} className="vs-select">
                <option value="">All categories</option>
                {cats.map(c => <option key={c.category} value={c.category}>{c.category} ({c.n})</option>)}
              </select>
            </div>
            {/* 42px tall to sit level with the vs-input / vs-select beside it. */}
            <button type="submit" className="vs-btn h-[42px]">Go</button>
          </div>
        </form>
        {filtering && (
          <p className="text-center mt-4">
            <Link href="/news-stories/news" className="vs-link vs-link-sm vs-link-plain">Clear the search</Link>
          </p>
        )}

        {unavailable ? (
          <div className="text-center py-20">
            <p className="vs-lead text-[var(--vs-muted)]">The news isn&apos;t available here yet.</p>
            {/* The site sits behind the Hub login, so the reason is for the staff member looking at it. */}
            <p className="text-xs text-[var(--vs-muted)] mt-2">{unavailable}</p>
          </div>
        ) : (
          <>
            {/* ── Featured stories — only on the first, unfiltered page, as on vectis.co.uk ── */}
            {featured.length > 0 && (
              <section className="mt-12 lg:mt-16" aria-labelledby="news-featured">
                <h2 id="news-featured" className="vs-h2 text-center mb-8">Featured stories</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {featured.map(a => <StoryCard key={a.id} a={a} big />)}
                </div>
              </section>
            )}

            {/* ── Every story, newest first ── */}
            <section className="mt-12 lg:mt-16" aria-labelledby="news-list">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mb-8">
                <h2 id="news-list" className="vs-h2 vs-h2-light">{listHeading}</h2>
                <p className="text-sm text-[var(--vs-muted)]">
                  {total.toLocaleString("en-GB")} {total === 1 ? "story" : "stories"}{pages > 1 && ` · page ${Math.min(currentPage, pages)} of ${pages}`}
                </p>
              </div>
              {rows.length === 0 ? (
                <div className="text-center py-16">
                  {pastEnd ? (
                    <>
                      <p className="vs-lead text-[var(--vs-muted)]">There is no page {currentPage} — the stories end at page {pages}.</p>
                      <p className="mt-4"><Link href={pageHref(pages)} className="vs-link vs-link-sm">Go to the last page</Link></p>
                    </>
                  ) : (
                    <>
                      <p className="vs-lead text-[var(--vs-muted)]">{filtering ? "No stories match." : "No stories yet."}</p>
                      {filtering && <p className="mt-4"><Link href="/news-stories/news" className="vs-link vs-link-sm">See every story</Link></p>}
                    </>
                  )}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {rows.map(a => <StoryCard key={a.id} a={a} />)}
                </div>
              )}
              {pages > 1 && !pastEnd && (
                <nav className="vs-pages mt-12" aria-label="Pages of stories">
                  {currentPage > 1 && <PageLink href={pageHref(currentPage - 1)} label="Previous" />}
                  {pageNumbers(currentPage, pages).map((p, i) => p === null
                    ? <span key={`gap-${i}`} className="px-1 text-[var(--vs-muted)]" aria-hidden="true">…</span>
                    : <PageLink key={p} href={pageHref(p)} label={String(p)} active={p === currentPage} />)}
                  {currentPage < pages && <PageLink href={pageHref(currentPage + 1)} label="Next" />}
                </nav>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
