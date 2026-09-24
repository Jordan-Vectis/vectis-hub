import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { lotPhotoUrl } from "@/lib/photo-url"
import HomeHero from "./home-hero"
import { getCustomerSession } from "@/lib/customer-auth"
import { getSignedImageUrl } from "@/lib/r2"
import { getSiteStats } from "./site-stats"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Vectis Auctions — World's No.1 Diecast Specialist",
  description:
    "Vectis Auctions is the world's leading specialist auction house for diecast, tinplate and collectable toys. Browse upcoming auctions, bid live, or sell your collection.",
  openGraph: {
    title: "Vectis Auctions — World's No.1 Diecast Specialist",
    description:
      "The world's leading specialist auction house for diecast, tinplate and collectable toys. Bid live or sell your collection.",
    url: "https://www.vectis.co.uk",
    siteName: "Vectis Auctions",
    type: "website",
  },
}

export const dynamic = "force-dynamic"

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Auction", DIECAST: "Diecast", TRAINS: "Trains",
  VINYL: "Vinyl & Music", TV_FILM: "TV & Film", MATCHBOX: "Matchbox",
  COMICS: "Comics & Books", BEARS: "Teddy Bears", DOLLS: "Dolls & Toys",
}

function isPast(auctionDate: Date | null, finished: boolean, complete: boolean): boolean {
  if (finished || complete) return true
  if (!auctionDate) return false
  return new Date(auctionDate.getTime() + 24 * 60 * 60 * 1000) < new Date()
}

export default async function HomePage() {
  const session = await getCustomerSession()

  // Hero slides from DB (fall back to empty — hero has built-in defaults)
  let dbSlides: { id: string; title: string; subtitle: string; cta: string; ctaHref: string; imageKey: string | null; imageUrl: string | null; imageFocus: string | null }[] = []
  try {
    const cols = { id: true, title: true, subtitle: true, cta: true, ctaHref: true, imageKey: true } as const
    let rows: { id: string; title: string; subtitle: string; cta: string; ctaHref: string; imageKey: string | null; imageFocus: string | null }[]
    try {
      rows = await prisma.heroSlide.findMany({ where: { active: true }, orderBy: { order: "asc" }, select: { ...cols, imageFocus: true } })
    } catch {
      // imageFocus arrives with Run Migrations (2026-09-24); until then the slides are read without it.
      rows = (await prisma.heroSlide.findMany({ where: { active: true }, orderBy: { order: "asc" }, select: cols })).map(r => ({ ...r, imageFocus: null }))
    }
    // A signed address for each picture — the public photo proxy never served the banner keys (2026-09-24).
    dbSlides = await Promise.all(rows.map(async s => ({ ...s, imageUrl: s.imageKey ? await getSignedImageUrl(s.imageKey, 3600).catch(() => null) : null })))
  } catch {
    // Table may not exist yet in this environment — hero falls back to built-in slides
  }

  // The stats band's figures, counted from the Hub's own tables (cached; see site-stats.ts).
  const stats = await getSiteStats()
  const big = (n: number) => (n >= 1_000_000 ? `${Math.floor(n / 100_000) / 10}M+` : n >= 1000 ? `${Math.floor(n / 1000)}k+` : String(n))
  const statItems = [
    { value: String(stats.years), label: "Years of Experience" },
    stats.lotsSold ? { value: big(stats.lotsSold), label: "Lots Sold" } : null,
    stats.auctionsLastYear ? { value: stats.auctionsLastYear >= 10 ? `${Math.floor(stats.auctionsLastYear / 10) * 10}+` : String(stats.auctionsLastYear), label: "Auctions in the Last Year" } : null,
    stats.departments ? { value: String(stats.departments), label: "Specialist Departments" } : null,
  ].filter((s): s is { value: string; label: string } => s !== null)

  // Check for live auction
  const liveAuction = await prisma.liveAuction.findFirst({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    include: {
      auction: {
        include: { lots: { orderBy: { createdAt: "asc" } } },
      },
    },
  })

  // Upcoming auctions for the strip
  const allPublished = await prisma.catalogueAuction.findMany({
    where: { published: true },
    orderBy: { auctionDate: "asc" },
    include: {
      _count: { select: { lots: true } },
      lots: { take: 1, where: { imageUrls: { isEmpty: false } }, select: { imageUrls: true } },
    },
  })
  const upcoming = allPublished.filter(a => !isPast(a.auctionDate, a.finished, a.complete)).slice(0, 6)

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

  return (
    <div>
      {/* ── Hero ── */}
      <HomeHero initialLive={initialLive} dbSlides={dbSlides} isLoggedIn={!!session} />

      {/* ── Upcoming Auctions ── */}
      {upcoming.length > 0 && (
        <section className="bg-white border-b border-gray-200 py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-end justify-between mb-8">
              <div>
                <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">Don&apos;t Miss</p>
                <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">Upcoming Auctions</h2>
              </div>
              <Link
                href="/auctions"
                className="text-xs font-black text-[#32348A] uppercase tracking-wider hover:text-[#DB0606] transition-colors flex items-center gap-1"
              >
                VIEW ALL
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 border-l border-t border-gray-200">
              {upcoming.map(auction => {
                const img = lotPhotoUrl(auction.lots[0]?.imageUrls[0], true)
                const aDate = auction.auctionDate ? new Date(auction.auctionDate) : null
                const label = TYPE_LABELS[auction.auctionType] ?? auction.auctionType

                return (
                  <Link
                    key={auction.id}
                    href={`/auctions/${auction.code}`}
                    className="group border-r border-b border-gray-200 bg-white hover:bg-gray-50 transition-colors flex flex-col"
                  >
                    {/* Image */}
                    <div className="relative bg-[#32348A]/5 overflow-hidden" style={{ height: "200px" }}>
                      {img ? (
                        <Image
                          src={img}
                          alt={auction.name}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-500"
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-[#32348A]/10 to-[#2AB4A6]/10 flex items-center justify-center">
                          <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      {/* Type badge */}
                      <div className="absolute top-3 left-3 bg-[#DB0606] text-white text-[9px] font-black uppercase tracking-widest px-2 py-1">
                        {label}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="px-5 py-4 flex flex-col flex-1">
                      <h3 className="text-[#32348A] font-black text-base leading-tight group-hover:text-[#DB0606] transition-colors mb-2 line-clamp-2">
                        {auction.name}
                      </h3>
                      {aDate && (
                        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">
                          {format(aDate, "EEEE d MMMM yyyy")}
                        </p>
                      )}
                      <p className="text-gray-400 text-xs mt-1 mb-4">{auction._count.lots} lots</p>
                      <div className="mt-auto flex items-center justify-between">
                        <span className="text-[#32348A] text-xs font-black uppercase tracking-wider group-hover:text-[#DB0606] transition-colors">
                          VIEW CATALOGUE →
                        </span>
                        {aDate && (
                          <div className="text-right">
                            <span className="text-[#32348A] font-black text-2xl leading-none block">{format(aDate, "d")}</span>
                            <span className="text-gray-400 text-[9px] uppercase tracking-wider">{format(aDate, "MMM")}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Stats strip — real figures only; one that couldn't be counted is left off (2026-09-24) ── */}
      <section className="bg-[#32348A] py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap justify-center gap-x-16 gap-y-8 text-center">
            {statItems.map(s => (
              <div key={s.label} className="min-w-[160px]">
                <p className="text-[#DB0606] font-black text-4xl mb-1">{s.value}</p>
                <p className="text-gray-400 text-xs uppercase tracking-widest">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Vectis ── */}
      <section className="bg-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-2">The Vectis Difference</p>
            <h2 className="text-3xl font-black text-[#32348A] uppercase tracking-tight">Why Choose Vectis?</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                  </svg>
                ),
                title: "Specialist Expertise",
                desc: "Our team of dedicated specialists brings decades of knowledge across diecast, tinplate, trains, vinyl, and more.",
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                  </svg>
                ),
                title: "Global Reach",
                desc: "Every sale is held live online, with buyers from around the world bidding — giving your collection the widest exposure and the best possible price.",
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ),
                title: "No Hidden Fees",
                desc: "Transparent commission rates with no surprise charges. Get a free, no-obligation valuation from our team.",
              },
            ].map(f => (
              <div key={f.title} className="text-center group">
                <div className="w-16 h-16 bg-[#32348A]/5 rounded-full flex items-center justify-center mx-auto mb-5 text-[#32348A] group-hover:bg-[#DB0606]/10 group-hover:text-[#DB0606] transition-colors">
                  {f.icon}
                </div>
                <h3 className="text-[#32348A] font-black text-lg mb-3 uppercase tracking-tight">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sell with us CTA ── */}
      <section className="relative bg-[#32348A] overflow-hidden py-20">
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "32px 32px" }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-[#DB0606] text-xs font-black tracking-[0.3em] uppercase mb-4">Free Valuation</p>
          <h2 className="text-white font-black text-4xl uppercase tracking-tight mb-4">
            Ready to Sell Your Collection?
          </h2>
          <p className="text-gray-300 text-base mb-10 max-w-xl mx-auto leading-relaxed">
            Our specialists will assess your items for free and guide you through the entire process — from valuation to payment.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/submit"
              className="bg-[#DB0606] hover:bg-[#22928a] text-white font-black text-sm uppercase tracking-widest px-10 py-4 transition-colors"
            >
              GET A FREE VALUATION
            </Link>
            <Link
              href="/portal/register"
              className="border-2 border-white/30 hover:border-white text-white font-black text-sm uppercase tracking-widest px-10 py-4 transition-colors"
            >
              REGISTER TO BID
            </Link>
          </div>
        </div>
      </section>

      {/* ── Categories ── */}
      <section className="bg-gray-50 py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-2">Explore by Category</p>
            <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">Our Specialisms</h2>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-0 border-l border-t border-gray-200">
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <Link
                key={key}
                href={`/auctions?type=${encodeURIComponent(label)}`}
                className="border-r border-b border-gray-200 bg-white hover:bg-[#32348A] text-center py-5 px-2 group transition-colors"
              >
                <p className="text-[10px] font-black text-[#32348A] group-hover:text-white uppercase tracking-widest leading-tight transition-colors">
                  {label}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
