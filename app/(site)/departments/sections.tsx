import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import { articlePicture, StoryCard, type Article } from "../news-stories/news/shared"
import { dateShort, saleDateLine } from "../site-dates"
import { getDepartment, highlightPicture, listDepartments, ourLotLinks } from "./data"

// The department pages' sections, each a server component that fetches its own data — used by the
// built-in /departments pages AND by the page editor's live blocks (page-editor/live.tsx), so there
// is one copy of each (2026-09-24). Restyled to the house look (site.css) on 2026-10-14 to match
// vectis.co.uk's department pages. A live block renders bare, so every section carries its own
// vs-section + vs-container, exactly as home-sections.tsx does.

type NewsRow = Pick<Article, "id" | "alias" | "title" | "category" | "tags" | "featured" | "publishedAt" | "imagePath" | "imageKey" | "introText" | "fullText">
type SaleRow = { siteId: number; title: string; saleDate: Date | null; lots: number; heroUrl: string | null; heroKey: string | null }

/** The departments index as vectis.co.uk lays it out: the centred title and intro, then one tile per department. */
export async function DepartmentsIndex({ kicker = "", heading = "Departments", intro = "" }: { kicker?: string; heading?: string; intro?: string }) {
  const departments = await listDepartments()
  return (
    <div className="vs-page bg-white">
      <div className="vs-container">
        {/* py-3 -my-3 on the text links: a 44px touch target (the iPads) without moving the text. */}
        <Link href="/" className="vs-link vs-link-back vs-link-sm py-3 -my-3">Back to home</Link>
        <div className="text-center max-w-[860px] mx-auto mt-6 mb-10">
          {kicker && <p className="vs-kicker mb-2">{kicker}</p>}
          <h1 className="vs-h1">{heading}</h1>
          {intro && <p className="vs-lead text-[var(--vs-muted)] mt-4">{intro}</p>}
        </div>

        {departments.length === 0 ? (
          <p className="text-center py-16 text-[var(--vs-muted)]">The departments aren&apos;t available here yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {departments.map(d => (
              <Link key={d.slug} href={`/departments/${d.slug}`} className="vs-tile">
                {d.tile && <img src={d.tile} alt="" loading="lazy" />}
                <span className="vs-tile-label">
                  <span className="vs-tile-name">{d.name}</span>
                  <span className="vs-tile-cta">Explore</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** A department's hand-picked past lots — square cards with the title and hammer price — linked to our own results pages where we hold them. */
export async function DeptHighlights({ slug, kicker = "", heading = "Highlighted Lots" }: { slug: string; kicker?: string; heading?: string }) {
  const d = slug ? await getDepartment(slug).catch(() => null) : null
  const highlights = d?.highlights ?? []
  if (!d || highlights.length === 0) return <div className="hidden" />
  const [pictures, lotLinks] = await Promise.all([
    Promise.all(highlights.map(h => highlightPicture(h, d.highlightKeys ?? []))),
    ourLotLinks(highlights),
  ])
  // Six across only when there are six to show — four otherwise, so a short row never sits in a gap.
  const wide = highlights.length >= 6 ? "xl:grid-cols-6" : ""
  return (
    <section className="vs-section bg-white border-t border-[var(--vs-line)]">
      <div className="vs-container">
        <div className="text-center mb-8">
          {kicker && <p className="vs-kicker mb-2">{kicker}</p>}
          <h2 className="vs-h2">{heading}</h2>
        </div>
        <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 ${wide} gap-4 lg:gap-6`}>
          {highlights.map((h, i) => {
            const siteLotId = Number((h.link ?? "").match(/[?&]el=(\d+)/)?.[1])
            const ours = lotLinks.get(siteLotId)
            const body = (
              <>
                <div className="bg-white aspect-square overflow-hidden border-b border-[var(--vs-line)]">
                  {pictures[i]
                    ? <img src={pictures[i]!} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
                    : <div className="w-full h-full bg-[var(--vs-bg)]" />}
                </div>
                <div className="p-3 sm:p-4 flex flex-col flex-1">
                  <h3 className="text-base font-medium leading-snug line-clamp-2 group-hover:underline">{h.title}</h3>
                  {/* The collector stores the hammer with its pound sign ("£1,200"). */}
                  {h.hammer && <p className="vs-price mt-2">Hammer Price: {h.hammer}</p>}
                  {h.meta && <p className="text-sm text-[var(--vs-muted)] mt-1 line-clamp-2">{h.meta}</p>}
                  {(ours || h.link) && <span className="vs-link vs-link-sm mt-auto pt-3">{ours ? "View lot" : "View on vectis.co.uk"}</span>}
                </div>
              </>
            )
            const cls = "vs-card-flat group flex flex-col"
            return ours
              ? <Link key={i} href={ours} className={cls}>{body}</Link>
              : h.link
                ? <a key={i} href={h.link} target="_blank" rel="noreferrer" className={cls}>{body}</a>
                : <div key={i} className={cls}>{body}</div>
          })}
        </div>
      </div>
    </section>
  )
}

/** A department's finished sales — the ones its page on the website listed, plus any whose title carries one of its keywords — as the home page shows past auctions. */
export async function DeptPastAuctions({ slug, kicker = "", heading = "Past Auctions", count = 4 }: { slug: string; kicker?: string; heading?: string; count?: number }) {
  const d = slug ? await getDepartment(slug).catch(() => null) : null
  if (!d) return <div className="hidden" />
  const patterns = (d.saleKeywords ?? []).map(k => `%${k}%`)
  const limit = Math.max(1, Math.min(24, Number(count) || 4))
  let sales: (SaleRow & { photo: string | null })[] = []
  try {
    const ids = d.siteSaleIds ?? []
    const byId = ids.length ? Prisma.sql`s."siteId" = ANY(ARRAY(SELECT (jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::int))` : Prisma.sql`false`
    const byWord = patterns.length ? Prisma.join(patterns.map(p => Prisma.sql`s."title" ILIKE ${p}`), " OR ") : Prisma.sql`false`
    // Only sales that have happened (the day after the sale date, as the calendar's results tab counts them).
    const rows = await prisma.$queryRaw<SaleRow[]>`
      SELECT s."siteId", s."title", s."saleDate", s."lots", s."heroUrl", s."heroKey" FROM "ArchiveSale" s
      WHERE (${byId} OR ${byWord})
        AND ((s."saleDate" IS NOT NULL AND s."saleDate" < now() - interval '1 day') OR (s."saleDate" IS NULL AND s."finished"))
      ORDER BY s."saleDate" DESC NULLS LAST, s."siteId" DESC LIMIT ${limit}`
    sales = await Promise.all(rows.map(async s => ({
      ...s,
      photo: s.heroKey ? await getSignedImageUrl(s.heroKey, 3600).catch(() => null) : s.heroUrl ? SITE_IMAGES + s.heroUrl : null,
    })))
  } catch { sales = [] }
  if (sales.length === 0) return <div className="hidden" />
  return (
    <section className="vs-section bg-white border-t border-[var(--vs-line)]">
      <div className="vs-container">
        <div className="text-center mb-8">
          {kicker && <p className="vs-kicker mb-2">{kicker}</p>}
          <h2 className="vs-h2 mb-2">{heading}</h2>
          <Link href="/auctions?tab=past" className="vs-link py-3 -my-3">See full calendar</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
          {sales.map(s => (
            <Link key={s.siteId} href={`/auctions/results/${s.siteId}`} className="group block">
              {/* The site's cover files are square — shown whole on white, as the home page's Past Auctions shows them. */}
              <div className="bg-white aspect-square overflow-hidden border border-[var(--vs-line)]">
                {s.photo
                  ? <img src={s.photo} alt="" loading="lazy" className="w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-500" />
                  : <div className="w-full h-full bg-[var(--vs-bg)]" />}
              </div>
              <h3 className="vs-h4 mt-3 leading-snug group-hover:underline">{s.title}</h3>
              {s.saleDate && <p className="text-sm text-[var(--vs-muted)] mt-1">{saleDateLine(s.saleDate)}</p>}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * The newest News & Stories — all of them, one category's (a tag — the site's categories are its
 * tags), or a department's (its news category, else its keywords against the titles). As a band of
 * story cards (the department pages' look) or as a compact list in a white box for a side column.
 */
export async function NewsList({ department = "", category = "", heading = "Latest news", count = 3, layout = "list" }: { department?: string; category?: string; heading?: string; count?: number; layout?: string }) {
  const limit = Math.max(1, Math.min(24, Number(count) || 3))
  let where: Prisma.Sql = Prisma.sql`true`
  let moreHref = "/news-stories/news"
  if (department) {
    const d = await getDepartment(department).catch(() => null)
    if (!d) return <div className="hidden" />
    const patterns = (d.saleKeywords ?? []).map(k => `%${k}%`)
    where = d.newsCategory
      ? Prisma.sql`${d.newsCategory} = ANY(a."tags")`
      : patterns.length ? Prisma.join(patterns.map(p => Prisma.sql`a."title" ILIKE ${p}`), " OR ") : Prisma.sql`false`
    if (d.newsCategory) moreHref = `/news-stories/news?category=${encodeURIComponent(d.newsCategory)}`
  } else if (category.trim()) {
    where = Prisma.sql`${category.trim()} = ANY(a."tags")`
    moreHref = `/news-stories/news?category=${encodeURIComponent(category.trim())}`
  }
  let news: (NewsRow & { photo: string | null })[] = []
  try {
    const rows = await prisma.$queryRaw<NewsRow[]>`
      SELECT a."id", a."alias", a."title", a."category", a."tags", a."featured", a."publishedAt", a."imagePath", a."imageKey", a."introText", a."fullText"
      FROM "SiteNewsArticle" a WHERE ${where} ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT ${limit}`
    news = await Promise.all(rows.map(async a => ({ ...a, photo: await articlePicture(a) })))
  } catch { news = [] }
  if (news.length === 0) return <div className="hidden" />

  if (layout === "cards") {
    return (
      <section className="vs-section vs-band">
        <div className="vs-container">
          <div className="text-center mb-8">
            <h2 className="vs-h2 mb-2">{heading}</h2>
            <Link href={moreHref} className="vs-link py-3 -my-3">See more</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {news.map(a => <StoryCard key={a.id} a={a as Article & { photo: string | null }} />)}
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="vs-card-flat p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="vs-h4">{heading}</h3>
        <Link href={moreHref} className="vs-link vs-link-sm shrink-0 py-3 -my-3">See more</Link>
      </div>
      <ul className="divide-y divide-[var(--vs-line)]">
        {news.map(a => (
          <li key={a.id}>
            <Link href={`/news-stories/news/${encodeURIComponent(a.alias)}`} className="group flex items-center gap-4 py-3 min-h-[44px]">
              <div className="w-24 aspect-[16/10] shrink-0 bg-[var(--vs-bg)] overflow-hidden">
                {a.photo && <img src={a.photo} alt="" loading="lazy" className="w-full h-full object-cover" />}
              </div>
              <div className="min-w-0">
                {a.publishedAt && <p className="vs-kicker mb-1">{dateShort(a.publishedAt)}</p>}
                <p className="font-medium leading-snug line-clamp-2 group-hover:underline">{a.title}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
