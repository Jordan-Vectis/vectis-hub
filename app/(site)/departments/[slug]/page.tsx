import { notFound } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import { articlePicture, cleanHtml, gbDate, type Article } from "../../news-stories/news/shared"
import { getDepartment, sitePicture, highlightPicture, ourLotLinks, withDeptPictures } from "../data"

// One department on the test website, from the page collected from vectis.co.uk: the banner, the
// "sell with us" copy, the hand-picked highlighted lots, plus — from our own databases — the
// department's latest news (by its news category, else its keywords) and its past auctions (the
// sales the site's page listed, plus any whose title matches the keywords). Its own design.

export const dynamic = "force-dynamic"

type NewsRow = Pick<Article, "id" | "alias" | "title" | "category" | "publishedAt" | "imagePath" | "imageKey">
type SaleRow = { siteId: number; title: string; saleDate: Date | null; lots: number; heroUrl: string | null; heroKey: string | null }

const fmtSale = (d: Date | null) => (d ? format(d, "EEEE d MMMM yyyy") : "")

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const d = await getDepartment(slug).catch(() => null)
  return { title: d ? (d.pageTitle ?? d.name) : "Departments" }
}

export default async function DepartmentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const d = await getDepartment(slug)
  if (!d) notFound()

  const hero = await sitePicture(d.heroKey, d.heroPath)
  const copy = d.copyHtml ? cleanHtml(await withDeptPictures(d.copyHtml, d)) : ""
  // The "Sell your collection" side box as the site has it — video, text, the prices-achieved
  // picture — with its GET STARTED pointing at our own sell-with-us page.
  const side = d.sideHtml
    ? cleanHtml(await withDeptPictures(d.sideHtml, d)).replace(/href="(?:https:\/\/www\.vectis\.co\.uk)?\/valuations[^"]*"(?: target="_blank" rel="noreferrer")?/gi, 'href="/sell-with-us"')
    : ""
  const copyHasHeading = /<h1\b/i.test(copy)
  const highlights = d.highlights ?? []
  const [pictures, lotLinks] = await Promise.all([
    Promise.all(highlights.map(h => highlightPicture(h, d.highlightKeys ?? []))),
    ourLotLinks(highlights),
  ])
  const patterns = (d.saleKeywords ?? []).map(k => `%${k}%`)

  // Latest news: the department's news category when it has one, else its keywords against the titles.
  let news: (NewsRow & { photo: string | null })[] = []
  try {
    const where = d.newsCategory
      ? Prisma.sql`a."category" = ${d.newsCategory}`
      : patterns.length ? Prisma.join(patterns.map(p => Prisma.sql`a."title" ILIKE ${p}`), " OR ") : Prisma.sql`false`
    const rows = await prisma.$queryRaw<NewsRow[]>`
      SELECT a."id", a."alias", a."title", a."category", a."publishedAt", a."imagePath", a."imageKey"
      FROM "SiteNewsArticle" a WHERE ${where} ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT 3`
    news = await Promise.all(rows.map(async a => ({ ...a, photo: await articlePicture(a) })))
  } catch { news = [] }

  // Past auctions: the sales the site's page listed, plus any whose title carries a keyword — that
  // have happened (the day after the sale date, as the auction calendar's results tab counts them).
  let sales: (SaleRow & { photo: string | null })[] = []
  try {
    const ids = d.siteSaleIds ?? []
    const byId = ids.length ? Prisma.sql`s."siteId" = ANY(ARRAY(SELECT (jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::int))` : Prisma.sql`false`
    const byWord = patterns.length ? Prisma.join(patterns.map(p => Prisma.sql`s."title" ILIKE ${p}`), " OR ") : Prisma.sql`false`
    const rows = await prisma.$queryRaw<SaleRow[]>`
      SELECT s."siteId", s."title", s."saleDate", s."lots", s."heroUrl", s."heroKey" FROM "ArchiveSale" s
      WHERE (${byId} OR ${byWord})
        AND ((s."saleDate" IS NOT NULL AND s."saleDate" < now() - interval '1 day') OR (s."saleDate" IS NULL AND s."finished"))
      ORDER BY s."saleDate" DESC NULLS LAST, s."siteId" DESC LIMIT 8`
    sales = await Promise.all(rows.map(async s => ({
      ...s,
      photo: s.heroKey ? await getSignedImageUrl(s.heroKey, 3600).catch(() => null) : s.heroUrl ? SITE_IMAGES + s.heroUrl : null,
    })))
  } catch { sales = [] }

  const title = d.pageTitle ?? d.name

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* ── Banner ── */}
      <div className="relative bg-[#32348A] overflow-hidden" style={{ height: "300px" }}>
        {hero ? (
          <img src={hero} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#32348A] to-[#4446a8]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
        <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 flex flex-col justify-end pb-8">
          <div className="flex items-center gap-2 text-xs text-gray-300 mb-3">
            <Link href="/departments" className="hover:text-white transition-colors uppercase tracking-wider font-semibold">Departments</Link>
            <span>/</span>
            <span className="text-white uppercase tracking-wider font-semibold">{d.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white">{title}</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ── The copy, as the site has it (its own heading, bold and italic runs, lists, pictures) ── */}
        <div className="lg:col-span-7 bg-white border border-gray-200 p-6 sm:p-8">
          {!copyHasHeading && d.heading && <h1 className="text-3xl font-black text-[#32348A] leading-tight mb-4">{d.heading}</h1>}
          {copy
            ? <div className="news-body" dangerouslySetInnerHTML={{ __html: copy }} />
            : <p className="text-gray-400">No text is held for this department yet.</p>}
        </div>

        {/* ── The "Sell your collection" side box + latest news ── */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {side ? (
            <div className="dept-side bg-[#32348A] text-white p-6" dangerouslySetInnerHTML={{ __html: side }} />
          ) : (
            <div className="bg-[#32348A] text-white p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#2AB4A6] mb-1">Selling</p>
              <h3 className="text-2xl font-black mb-2">Sell your collection with us</h3>
              <p className="text-sm text-gray-200 leading-relaxed mb-5">Looking to sell? From a single piece to a room of thousands, our Collections Team will guide you through the process — a free valuation, no lotting fees, and worldwide marketing at no extra cost.</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/sell-with-us" className="inline-flex items-center gap-2 bg-white text-[#32348A] text-xs font-black uppercase tracking-widest px-5 py-3 hover:bg-[#2AB4A6] hover:text-white transition-colors">Get started <span aria-hidden="true">→</span></Link>
                <span className="text-xs text-gray-300">or call <a href="tel:+441642750616" className="text-white font-semibold hover:underline">01642 750 616</a></span>
              </div>
            </div>
          )}

          {news.length > 0 && (
            <div className="bg-white border border-gray-200 p-5">
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-[#DB0606]">Latest news</h3>
                <Link href={d.newsCategory ? `/news-stories/news?category=${encodeURIComponent(d.newsCategory)}` : "/news-stories/news"} className="text-[11px] font-bold uppercase tracking-wider text-[#32348A] hover:underline">See more →</Link>
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
          )}
        </div>
      </div>

      {/* ── Highlighted lots ── */}
      {highlights.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-10">
          <div className="mb-5">
            <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">From the archive</p>
            <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">Highlighted lots</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
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
      )}

      {/* ── Past auctions ── */}
      {sales.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-14">
          <div className="flex flex-wrap items-end justify-between gap-2 mb-5">
            <div>
              <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">Results</p>
              <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">Past auctions</h2>
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
      )}
    </div>
  )
}
