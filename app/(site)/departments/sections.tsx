import Link from "next/link"
import { format } from "date-fns"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import { articlePicture, gbDate, StoryCard, type Article } from "../news-stories/news/shared"
import { getDepartment, highlightPicture, listDepartments, ourLotLinks } from "./data"

// The department pages' sections, each a server component that fetches its own data — used by the
// built-in /departments pages AND by the page editor's live blocks (page-editor/live.tsx), so there
// is one copy of each (2026-09-24). Moved here unchanged from the pages.

type NewsRow = Pick<Article, "id" | "alias" | "title" | "category" | "tags" | "featured" | "publishedAt" | "imagePath" | "imageKey" | "introText" | "fullText">
type SaleRow = { siteId: number; title: string; saleDate: Date | null; lots: number; heroUrl: string | null; heroKey: string | null }

const fmtSale = (d: Date | null) => (d ? format(d, "EEEE d MMMM yyyy") : "")

/** The departments index: a header, then one tile per department. */
export async function DepartmentsIndex({ kicker = "Specialist teams", heading = "Departments", intro = "" }: { kicker?: string; heading?: string; intro?: string }) {
  const departments = await listDepartments()
  return (
    <div>
      <div className="bg-white border-b border-gray-200">
        <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 py-8">
          {kicker && <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">{kicker}</p>}
          <h1 className="text-3xl font-black text-[#32348A] uppercase tracking-tight">{heading}</h1>
          {intro && <p className="text-gray-500 text-sm mt-1 max-w-3xl">{intro}</p>}
        </div>
      </div>

      <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 py-10">
        {departments.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">The departments aren&apos;t available here yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {departments.map(d => (
              <Link key={d.slug} href={`/departments/${d.slug}`} className="group bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-[#32348A]/40 transition-all flex flex-col">
                <div className="relative bg-gray-100 aspect-[16/11] overflow-hidden">
                  {d.tile ? (
                    <img src={d.tile} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-[#2AB4A6] to-[#32348A]" />
                  )}
                </div>
                <div className="p-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-black text-[#32348A] uppercase tracking-wider leading-snug">{d.name}</h2>
                  <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-[#DB0606]">Explore <span aria-hidden="true">→</span></span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** A department's hand-picked past lots, linked to our own results pages where we hold them. */
export async function DeptHighlights({ slug, kicker = "From the archive", heading = "Highlighted lots" }: { slug: string; kicker?: string; heading?: string }) {
  const d = slug ? await getDepartment(slug).catch(() => null) : null
  const highlights = d?.highlights ?? []
  if (!d || highlights.length === 0) return <div className="hidden" />
  const [pictures, lotLinks] = await Promise.all([
    Promise.all(highlights.map(h => highlightPicture(h, d.highlightKeys ?? []))),
    ourLotLinks(highlights),
  ])
  return (
    <section className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 pb-10">
      <div className="mb-5">
        {kicker && <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">{kicker}</p>}
        <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">{heading}</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-5">
        {highlights.map((h, i) => {
          const siteLotId = Number((h.link ?? "").match(/[?&]el=(\d+)/)?.[1])
          const ours = lotLinks.get(siteLotId)
          const body = (
            <>
              <div className="relative bg-gray-100 aspect-square overflow-hidden">
                {pictures[i]
                  ? <img src={pictures[i]!} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  : <div className="absolute inset-0 bg-[#32348A]/5" />}
              </div>
              <div className="p-3 flex flex-col flex-1">
                <p className="text-sm font-bold text-gray-800 leading-snug line-clamp-2 mb-2 group-hover:text-[#32348A]">{h.title}</p>
                {h.hammer && <p className="text-lg font-black text-[#32348A] leading-none mb-2">Hammer {h.hammer}</p>}
                {h.meta && <p className="text-[11px] text-gray-500 leading-snug line-clamp-3">{h.meta}</p>}
                <span className="mt-auto pt-3 text-[10px] font-black uppercase tracking-widest text-[#32348A]">{ours ? "View lot →" : "On vectis.co.uk ↗"}</span>
              </div>
            </>
          )
          const cls = "group bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-[#32348A]/40 transition-all flex flex-col"
          return ours
            ? <Link key={i} href={ours} className={cls}>{body}</Link>
            : h.link
              ? <a key={i} href={h.link} target="_blank" rel="noreferrer" className={cls}>{body}</a>
              : <div key={i} className={cls}>{body}</div>
        })}
      </div>
    </section>
  )
}

/** A department's finished sales — the ones its page on the website listed, plus any whose title carries one of its keywords. */
export async function DeptPastAuctions({ slug, kicker = "Results", heading = "Past auctions", count = 8 }: { slug: string; kicker?: string; heading?: string; count?: number }) {
  const d = slug ? await getDepartment(slug).catch(() => null) : null
  if (!d) return <div className="hidden" />
  const patterns = (d.saleKeywords ?? []).map(k => `%${k}%`)
  const limit = Math.max(1, Math.min(24, Number(count) || 8))
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
    <section className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 pb-14">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-5">
        <div>
          {kicker && <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">{kicker}</p>}
          <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">{heading}</h2>
        </div>
        <Link href="/auctions?tab=past" className="text-[11px] font-bold uppercase tracking-wider text-[#32348A] hover:underline">See the full calendar →</Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {sales.map(s => (
          <Link key={s.siteId} href={`/auctions/results/${s.siteId}`} className="group bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-[#32348A]/40 transition-all flex flex-col">
            <div className="relative bg-gray-100 aspect-[16/10] overflow-hidden">
              {s.photo && <img src={s.photo} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-contain" />}
            </div>
            <div className="p-3">
              <p className="text-sm font-black text-[#32348A] leading-snug line-clamp-2 group-hover:underline">{s.title}</p>
              <p className="text-[11px] text-gray-400 uppercase tracking-wide mt-1">{fmtSale(s.saleDate)}</p>
              <span className="block mt-2 text-[10px] font-black uppercase tracking-widest text-[#32348A]">View results →</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

/**
 * The newest News & Stories — all of them, one category's (a tag — the site's categories are its
 * tags), or a department's (its news category, else its keywords against the titles). As a compact
 * list in a white box (the department pages' look) or as cards.
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
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-4">
          <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">{heading}</h2>
          <Link href={moreHref} className="text-[11px] font-bold uppercase tracking-wider text-[#32348A] hover:underline">See more →</Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {news.map(a => <StoryCard key={a.id} a={a as Article & { photo: string | null }} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 p-5">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-[#DB0606]">{heading}</h3>
        <Link href={moreHref} className="text-[11px] font-bold uppercase tracking-wider text-[#32348A] hover:underline">See more →</Link>
      </div>
      <ul className="divide-y divide-gray-100">
        {news.map(a => (
          <li key={a.id}>
            <Link href={`/news-stories/news/${encodeURIComponent(a.alias)}`} className="group flex gap-3 py-3">
              <div className="w-24 aspect-[16/10] shrink-0 bg-gray-100 overflow-hidden">
                {a.photo && <img src={a.photo} alt="" loading="lazy" className="w-full h-full object-cover" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-[#32348A] leading-snug line-clamp-2 group-hover:underline">{a.title}</p>
                {a.publishedAt && <p className="text-[11px] text-gray-400 uppercase tracking-wide mt-1">{gbDate(a.publishedAt)}</p>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
