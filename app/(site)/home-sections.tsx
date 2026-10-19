import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { lotPhotoUrl } from "@/lib/photo-url"
import HomeHero, { type DbSlide, type SidePictures } from "./home-hero"
import { sitePicture } from "./departments/data"
import { getCustomerSession } from "@/lib/customer-auth"
import { getSignedImageUrl } from "@/lib/r2"
import { getSiteStats } from "./site-stats"
import { parseSlideStyle } from "./hero-style"
import { listRecentResults, listUpcomingSales } from "./auctions/results/data"
import UpcomingCarousel, { type UpcomingCard } from "./upcoming-carousel"
import { articlePicture, gbDate, teaser, type Article } from "./news-stories/news/shared"
import { saleDateLine, saleDateLong } from "./site-dates"

// The home page's sections, each a server component that fetches its own data — used by the
// built-in home page AND by the page editor's live blocks (page-editor/live.tsx), so there is one
// copy of each. The order and look follow vectis.co.uk's home page (2026-10-14): the banner, the
// introduction, upcoming auctions, sell at auction, past auctions, latest news.

export const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Auction", DIECAST: "Diecast", TRAINS: "Trains",
  VINYL: "Vinyl & Music", TV_FILM: "TV & Film", MATCHBOX: "Matchbox",
  COMICS: "Comics & Books", BEARS: "Teddy Bears", DOLLS: "Dolls & Toys",
}

function isPast(auctionDate: Date | null, finished: boolean, complete: boolean): boolean {
  if (finished || complete) return true
  if (!auctionDate) return false
  return new Date(auctionDate.getTime() + 24 * 60 * 60 * 1000) < new Date()
}

/** The banner: the Banner Manager's slides — or, until it holds one, the next sales as featured slides. */
export async function HeroSection() {
  const session = await getCustomerSession()

  let dbSlides: DbSlide[] = []
  try {
    const cols = { id: true, title: true, subtitle: true, cta: true, ctaHref: true, imageKey: true } as const
    let rows: { id: string; title: string; subtitle: string; cta: string; ctaHref: string; imageKey: string | null; imageFocus: string | null; style: unknown }[]
    try {
      rows = await prisma.heroSlide.findMany({ where: { active: true }, orderBy: { order: "asc" }, select: { ...cols, imageFocus: true, style: true } })
    } catch {
      // imageFocus and style arrive with Run Migrations (2026-09-24); until then the slides are read without them.
      rows = (await prisma.heroSlide.findMany({ where: { active: true }, orderBy: { order: "asc" }, select: cols })).map(r => ({ ...r, imageFocus: null, style: null }))
    }
    // A signed address for each picture — the public photo proxy never served the banner keys (2026-09-24).
    dbSlides = await Promise.all(rows.map(async s => ({
      id: s.id, title: s.title, subtitle: s.subtitle, cta: s.cta, ctaHref: s.ctaHref, imageFocus: s.imageFocus,
      imageUrl: s.imageKey ? await getSignedImageUrl(s.imageKey, 3600).catch(() => null) : null,
      style: s.style ? parseSlideStyle(s.style) : null,
    })))
  } catch {
    // Table may not exist yet in this environment — the featured sales (or the built-in slides) stand in.
  }

  // The banner rotates through the next sales with their cover pictures, exactly as vectis.co.uk's
  // does ("FEATURED · Star Wars Bonanza! · Thursday 15th October 2026 09:30 · VIEW LOTS"); any
  // slide made in the Banner Manager follows them in the rotation (Jack, 2026-10-15: "usually it's
  // a moving banner").
  const upcoming = await listUpcomingSales(12)
  const featured: DbSlide[] = upcoming.map(s => ({
    id: `sale-${s.siteId}`,
    title: s.title,
    subtitle: saleDateLong(s.saleDate),
    cta: s.lotCount > 0 ? "View lots" : "Coming soon",
    ctaHref: `/auctions/results/${s.siteId}`,
    imageUrl: s.photo,
    imageFocus: "center",
    style: parseSlideStyle({ kicker: "Featured" }),
  }))
  dbSlides = [...featured, ...dbSlides]

  // The pictures behind the two boxes beside the slider come from the collected department pages
  // (Star Wars for selling, music for buying, as the real site shows), else the first two
  // departments with a picture; a department-less environment gets a plain band.
  const sidePictures: SidePictures = { sell: null, buy: null }
  try {
    const rows = await prisma.$queryRaw<{ slug: string; tileKey: string | null; heroKey: string | null; tilePath: string | null; heroPath: string | null }[]>`
      SELECT "slug", "tileKey", "heroKey", "tilePath", "heroPath" FROM "SiteDepartment"
      WHERE COALESCE("tileKey", "heroKey", "tilePath", "heroPath") IS NOT NULL ORDER BY "order", "name"`
    const pick = (want: string[]) => rows.find(r => want.some(w => r.slug.includes(w)))
    const sell = pick(["star-wars-auctions", "action-figure"]) ?? rows[0]
    const buy = pick(["vinyl", "music"]) ?? rows.find(r => r !== sell)
    // The index TILE pictures, not the page banners: the banners are the pale "Collections Wanted"
    // strips, which came out washed out behind the cards (sandbox, 2026-10-15); the tiles are the
    // vivid square photos.
    const url = async (r?: { tileKey: string | null; heroKey: string | null; tilePath: string | null; heroPath: string | null }) =>
      r ? sitePicture(r.tileKey ?? r.heroKey, r.tilePath ?? r.heroPath) : null
    sidePictures.sell = await url(sell)
    sidePictures.buy = await url(buy)
  } catch { /* no departments collected here yet */ }

  const liveAuction = await prisma.liveAuction.findFirst({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    include: { auction: { include: { lots: { orderBy: { createdAt: "asc" } } } } },
  }).catch(() => null)
  const initialLive = liveAuction
    ? {
        auctionId: liveAuction.auction.id,
        auctionCode: liveAuction.auction.code,
        auctionName: liveAuction.auction.name,
        currentLotIndex: liveAuction.currentLotIndex,
        status: liveAuction.status,
        lots: liveAuction.auction.lots.map(l => ({
          id: l.id,
          barcode: l.barcode ?? "",
          title: l.title,
          imageUrls: l.imageUrls,
          estimateLow: l.estimateLow,
          estimateHigh: l.estimateHigh,
        })),
      }
    : null

  return <HomeHero initialLive={initialLive} dbSlides={dbSlides} sidePictures={sidePictures} isLoggedIn={!!session} />
}

/** "Vectis the world's leading toy and collectables specialist" — the introduction under the banner. */
export function IntroSection() {
  return (
    <section className="vs-section bg-white">
      <div className="vs-container">
        <h1 className="vs-h1 mb-6">Vectis the world&apos;s leading toy and collectables specialist</h1>
        <div className="vs-prose max-w-[1100px]">
          <p>
            Vectis is the largest Specialist Collectables Auction House in the world processing over 70,000 lots per
            year. With over 50 members of staff we process, pack and ship items all over the world. Our team of
            collectable toy experts have a wealth of knowledge in all genres of collectables from Star Wars to Barbie,
            Trains to Military Figures, Matchbox to Vinyl, Sports Memorabilia to Pokemon and a whole lot more.
          </p>
          <p>
            Vectis are the experts when it comes to auctioning your valuable collection and with over 30 years of
            experience our Marketing Team and huge customer database we will endeavour to get the best possible
            price for your collectables.
          </p>
          <h3>Why use Vectis?</h3>
          <ul>
            {WHY_USE_VECTIS.map(line => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}

export const WHY_USE_VECTIS = [
  "World record prices, higher than any other auction house",
  "We will pack and ship all your items to a global audience",
  "Our team of experts cover all collectable genres",
  "Protection against internet fraudsters",
  "We will handle any returns or buyer queries",
  "One-off commission – no extra lotting fees, photography or marketing fees",
  "No collection too small or large",
  "Over 30 years' experience in the collectable toy industry",
]

/**
 * The next sales as a row of cards: the website's sale list (with the lots BC has catalogued) and
 * any published Hub sale not in it. Shows nothing when none is coming up.
 */
export async function UpcomingSection({ kicker = "", heading = "Upcoming Auctions", count = 12 }: { kicker?: string; heading?: string; count?: number }) {
  const limit = Math.max(1, Math.min(24, Number(count) || 12))
  const session = await getCustomerSession().catch(() => null)
  const [sales, hub] = await Promise.all([
    listUpcomingSales(limit),
    prisma.catalogueAuction.findMany({
      where: { published: true },
      orderBy: { auctionDate: "asc" },
      include: { _count: { select: { lots: true } }, lots: { take: 1, where: { imageUrls: { isEmpty: false } }, select: { imageUrls: true } } },
    }).catch(() => []),
  ])
  const cards: UpcomingCard[] = sales.map(s => ({
    key: `site-${s.siteId}`,
    title: s.title,
    dateIso: s.saleDate ? s.saleDate.toISOString() : null,
    photo: s.photo,
    href: `/auctions/results/${s.siteId}`,
    lots: s.lotCount,
    status: s.lotCount > 0 ? "live" : "soon",
  }))
  const codes = new Set(sales.map(s => (s.code ?? "").toUpperCase()).filter(Boolean))
  for (const a of hub) {
    if (isPast(a.auctionDate, a.finished, a.complete) || codes.has(a.code.toUpperCase())) continue
    cards.push({
      key: `hub-${a.id}`,
      title: a.name,
      dateIso: a.auctionDate ? a.auctionDate.toISOString() : null,
      photo: lotPhotoUrl(a.lots[0]?.imageUrls[0], true) ?? null,
      href: `/auctions/${a.code}`,
      lots: a._count.lots,
      status: a._count.lots > 0 ? "live" : "soon",
    })
  }
  cards.sort((a, b) => (a.dateIso ?? "9").localeCompare(b.dateIso ?? "9"))
  if (cards.length === 0) return <div className="hidden" />

  return (
    <section className="vs-section bg-white border-t border-[var(--vs-line)]">
      <div className="vs-container">
        <UpcomingCarousel cards={cards.slice(0, limit)} heading={heading} kicker={kicker} loggedIn={!!session} />
      </div>
    </section>
  )
}

/** "Sell at Auction" — the tour video beside a short invitation, as on vectis.co.uk. */
export async function SellAtAuctionSection() {
  // The virtual-tour video is the one every department page on vectis.co.uk embeds; it arrives
  // with the collected department pages, so it is read from there rather than typed in here.
  let video: string | null = null
  try {
    const rows = await prisma.$queryRaw<{ sideHtml: string }[]>`SELECT "sideHtml" FROM "SiteDepartment" WHERE "sideHtml" ILIKE '%player.vimeo.com/video/%' OR "sideHtml" ILIKE '%youtube.com/embed/%' ORDER BY "order" LIMIT 1`
    const m = rows[0]?.sideHtml.match(/src="(https:\/\/(?:player\.vimeo\.com\/video\/\d+|www\.youtube\.com\/embed\/[A-Za-z0-9_-]{6,})[^"]*)"/)
    video = m?.[1] ?? null
  } catch { video = null }

  return (
    <section className="vs-section vs-band">
      <div className="vs-container">
        <div className={`grid gap-8 lg:gap-12 items-center ${video ? "lg:grid-cols-2" : ""}`}>
          {video && (
            <div className="bg-black aspect-video">
              <iframe src={video} title="Take a quick virtual tour through our auction house" className="w-full h-full border-0" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen loading="lazy" />
            </div>
          )}
          <div>
            <h2 className="vs-h2 vs-h2-light mb-4">Sell at Auction</h2>
            <p className="mb-5 max-w-[560px]">
              It&apos;s easy to sell your collectable items with us. Simply click on the Get Started button below and
              complete the form or contact us directly on <a href="tel:+441642750616" className="vs-text-link">(+44) 01642 750 616</a>.
              Our experts will review your items and support you to achieve the best possible price for your collectables.
            </p>
            <Link href="/sell-with-us" className="vs-link">Get started</Link>
          </div>
        </div>
      </div>
    </section>
  )
}

/** "Past Auctions" — the four newest results, each opening its lots and hammer prices. */
export async function PastAuctionsSection({ heading = "Past Auctions", count = 4 }: { heading?: string; count?: number }) {
  const sales = await listRecentResults(Math.max(1, Math.min(12, Number(count) || 4)))
  if (sales.length === 0) return <div className="hidden" />
  return (
    <section className="vs-section bg-white">
      <div className="vs-container">
        <div className="text-center mb-8">
          <h2 className="vs-h2 mb-2">{heading}</h2>
          <Link href="/auctions?tab=past" className="vs-link">See full calendar</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
          {sales.map(s => (
            <Link key={s.siteId} href={`/auctions/results/${s.siteId}`} className="group block">
              {/* The site's cover files are square — shown whole on white, exactly as vectis.co.uk's archive shows them. */}
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

type NewsRow = Pick<Article, "id" | "alias" | "title" | "category" | "tags" | "featured" | "publishedAt" | "imagePath" | "imageKey" | "introText" | "fullText" | "bodyHtml">

/** "Latest news" — the three newest stories: one large, two beside it, as on vectis.co.uk. */
export async function LatestNewsSection({ heading = "Latest news", count = 3 }: { heading?: string; count?: number }) {
  const limit = Math.max(1, Math.min(6, Number(count) || 3))
  let news: (NewsRow & { photo: string | null })[] = []
  try {
    const rows = await prisma.$queryRaw<NewsRow[]>`
      SELECT a."id", a."alias", a."title", a."category", a."tags", a."featured", a."publishedAt", a."imagePath", a."imageKey", a."introText", a."fullText", a."bodyHtml"
      FROM "SiteNewsArticle" a ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT ${limit}`
    news = await Promise.all(rows.map(async a => ({ ...a, photo: await articlePicture(a) })))
  } catch { news = [] }
  if (news.length === 0) return <div className="hidden" />
  const [first, ...rest] = news

  const Meta = ({ a }: { a: NewsRow }) => (
    <div className="relative">
      <span className="vs-badge absolute -top-11 right-0 text-xs">News</span>
      {a.publishedAt && <p className="vs-kicker mb-2">{gbDate(a.publishedAt)}</p>}
    </div>
  )

  return (
    <section className="vs-section vs-band">
      <div className="vs-container">
        <div className="flex items-end justify-between gap-4 mb-6">
          <h2 className="vs-h2 vs-h2-light text-[40px]">{heading}</h2>
          <Link href="/news-stories/news" className="vs-link vs-link-sm">See more</Link>
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <article className="vs-card flex flex-col">
            <Link href={`/news-stories/news/${encodeURIComponent(first.alias)}`} className="block bg-[var(--vs-bg)] aspect-[16/9] overflow-hidden">
              {first.photo && <img src={first.photo} alt="" loading="lazy" className="w-full h-full object-cover" />}
            </Link>
            <div className="p-7 pt-10 flex flex-col flex-1">
              <Meta a={first} />
              <h3 className="vs-h4 mb-4"><Link href={`/news-stories/news/${encodeURIComponent(first.alias)}`} className="hover:underline">{first.title}</Link></h3>
              <p className="text-sm text-[var(--vs-muted)] mb-5 line-clamp-3">{teaser(first)}</p>
              <Link href={`/news-stories/news/${encodeURIComponent(first.alias)}`} className="vs-link vs-link-sm mt-auto">Read more</Link>
            </div>
          </article>
          <div className="grid gap-6">
            {rest.map(a => (
              <article key={a.id} className="vs-card grid grid-cols-[40%_1fr]">
                <Link href={`/news-stories/news/${encodeURIComponent(a.alias)}`} className="block bg-[var(--vs-bg)] overflow-hidden min-h-[180px]">
                  {a.photo && <img src={a.photo} alt="" loading="lazy" className="w-full h-full object-cover" />}
                </Link>
                <div className="p-6 pt-10 flex flex-col">
                  <Meta a={a} />
                  <h3 className="vs-h4 text-lg mb-4"><Link href={`/news-stories/news/${encodeURIComponent(a.alias)}`} className="hover:underline">{a.title}</Link></h3>
                  <Link href={`/news-stories/news/${encodeURIComponent(a.alias)}`} className="vs-link vs-link-sm mt-auto">Read more</Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/** The stats band — the four figures, counted from the Hub's own tables (see site-stats.ts). */
export async function StatsSection() {
  // Always the same four — a count that isn't in yet shows as "—" rather than a made-up number or a gap.
  const stats = await getSiteStats()
  const big = (n: number) => (n >= 1_000_000 ? `${Math.floor(n / 100_000) / 10}M+` : n >= 1000 ? `${Math.floor(n / 1000)}k+` : String(n))
  const statItems = [
    { value: String(stats.years), label: "Years of experience" },
    { value: stats.lotsSold ? big(stats.lotsSold) : "—", label: "Lots sold" },
    { value: stats.auctionsLastYear ? (stats.auctionsLastYear >= 10 ? `${Math.floor(stats.auctionsLastYear / 10) * 10}+` : String(stats.auctionsLastYear)) : "—", label: "Auctions a year" },
    { value: stats.departments ? String(stats.departments) : "—", label: "Specialist departments" },
  ]
  return (
    <section className="bg-[var(--vs-navy)] text-white py-10">
      <div className="vs-container">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {statItems.map(s => (
            <div key={s.label}>
              <p className="text-[44px] leading-none font-semibold mb-2">{s.value}</p>
              <p className="vs-caps text-white/80 text-xs">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** The sale types as a strip of links into the calendar. */
export function SpecialismsSection({ kicker = "", heading = "Our Specialisms" }: { kicker?: string; heading?: string }) {
  return (
    <section className="vs-section vs-band">
      <div className="vs-container">
        <div className="text-center mb-8">
          {kicker && <p className="vs-kicker mb-2">{kicker}</p>}
          <h2 className="vs-h2">{heading}</h2>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-px bg-[var(--vs-line)] border border-[var(--vs-line)]">
          {Object.entries(TYPE_LABELS).map(([key, label]) => (
            <Link key={key} href={`/auctions?type=${encodeURIComponent(label)}`} className="bg-white hover:bg-[var(--vs-navy)] hover:text-white text-center py-5 px-2 transition-colors">
              <span className="vs-caps text-xs text-inherit">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

/** "Why Choose Vectis?" — three points (an editable Cards block in the editor). */
export function WhyVectisSection() {
  return (
    <section className="vs-section bg-white">
      <div className="vs-container">
        <div className="text-center mb-10">
          <h2 className="vs-h2">Why choose Vectis?</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {WHY_VECTIS.map(f => (
            <div key={f.title} className="text-center">
              <div className="w-16 h-16 bg-[var(--vs-bg)] rounded-full flex items-center justify-center mx-auto mb-5 text-[var(--vs-navy)]">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={f.icon} />
                </svg>
              </div>
              <h3 className="vs-h4 mb-3">{f.title}</h3>
              <p className="text-sm text-[var(--vs-muted)] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export const WHY_VECTIS = [
  {
    iconName: "badge",
    icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z",
    title: "Specialist expertise",
    desc: "Our team of dedicated specialists brings decades of knowledge across diecast, tinplate, trains, vinyl, and more.",
  },
  {
    iconName: "globe",
    icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064",
    title: "Global reach",
    desc: "Every sale is held live online, with buyers from around the world bidding — giving your collection the widest exposure and the best possible price.",
  },
  {
    iconName: "coin",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    title: "No hidden fees",
    desc: "Transparent commission rates with no surprise charges. Get a free, no-obligation valuation from our team.",
  },
]

/** "Ready to sell your collection?" — a call to action on navy. */
export function SellCtaSection() {
  return (
    <section className="bg-[var(--vs-navy)] text-white py-16">
      <div className="vs-container text-center">
        <h2 className="vs-h2 !text-white mb-4">Ready to sell your collection?</h2>
        <p className="text-white/85 mb-8 max-w-xl mx-auto">
          Our specialists will assess your items for free and guide you through the entire process — from valuation to payment.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/sell-with-us" className="vs-btn vs-btn-magenta vs-btn-lg">Get a free valuation</Link>
          <Link href="/portal/register" className="vs-btn vs-btn-white vs-btn-lg">Register to bid</Link>
        </div>
      </div>
    </section>
  )
}
