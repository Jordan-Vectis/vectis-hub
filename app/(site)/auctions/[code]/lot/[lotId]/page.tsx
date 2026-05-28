import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { lotPhotoUrl } from "@/lib/photo-url"
import { getCustomerSession } from "@/lib/customer-auth"
import type { Metadata } from "next"
import LotBidPanel from "./lot-bid-panel"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string; lotId: string }>
}): Promise<Metadata> {
  const { code, lotId } = await params
  const lot = await prisma.catalogueLot.findFirst({
    where: { id: lotId, auction: { code: code.toUpperCase(), published: true } },
    select: { title: true, barcode: true, receiptUniqueId: true },
  })
  return {
    title: lot ? `Lot ${lot.barcode ?? lot.receiptUniqueId ?? ""} — ${lot.title} — Vectis Auctions` : "Lot — Vectis",
  }
}

export default async function LotDetailPage({
  params,
}: {
  params: Promise<{ code: string; lotId: string }>
}) {
  const { code, lotId } = await params

  const auction = await prisma.catalogueAuction.findFirst({
    where: { code: code.toUpperCase(), published: true },
    include: {
      lots: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, receiptUniqueId: true } },
      liveAuction: true,
    },
  })
  if (!auction) notFound()

  const lot = await prisma.catalogueLot.findFirst({
    where: { id: lotId, auctionId: auction.id },
  })
  if (!lot) notFound()

  // Nav: find prev/next lots in ordered list
  const allLotIds = auction.lots.map(l => l.id)
  const currentIdx = allLotIds.indexOf(lotId)
  const prevLot = currentIdx > 0 ? auction.lots[currentIdx - 1] : null
  const nextLot = currentIdx < allLotIds.length - 1 ? auction.lots[currentIdx + 1] : null

  const isAuctionFinished = auction.finished || auction.complete
  const isLive = !!auction.liveAuction && ["ACTIVE", "PAUSED"].includes(auction.liveAuction.status)

  // Customer session + registration
  const customerSession = await getCustomerSession()
  const isLoggedIn = !!customerSession
  const isRegistered = customerSession
    ? !!(await prisma.bidderRegistration.findUnique({
        where: {
          auctionId_customerAccountId: {
            auctionId: auction.id,
            customerAccountId: customerSession.id,
          },
        },
      }))
    : false

  // Existing commission bid for this customer
  const existingBid = customerSession
    ? await prisma.commissionBid.findUnique({
        where: {
          lotId_customerAccountId: {
            lotId: lot.id,
            customerAccountId: customerSession.id,
          },
        },
        select: { maxBid: true },
      })
    : null

  const lotLabel = lot.barcode ?? lot.receiptUniqueId ?? "—"
  const sold = lot.status === "SOLD"

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Breadcrumb + Nav bar ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs text-gray-400 font-semibold uppercase tracking-wider">
            <Link href="/auctions" className="hover:text-[#32348A] transition-colors">Auctions</Link>
            <span>/</span>
            <Link href={`/auctions/${auction.code}`} className="hover:text-[#32348A] transition-colors truncate max-w-[180px]">
              {auction.name}
            </Link>
            <span>/</span>
            <span className="text-[#32348A]">Lot {lotLabel}</span>
          </nav>

          {/* Lot navigation arrows */}
          <div className="flex items-center gap-2">
            {prevLot ? (
              <Link
                href={`/auctions/${auction.code}/lot/${prevLot.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-xs font-bold text-gray-600 hover:border-[#32348A] hover:text-[#32348A] transition-colors uppercase tracking-wider"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
                Prev
              </Link>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-xs font-bold text-gray-300 uppercase tracking-wider cursor-not-allowed">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
                Prev
              </span>
            )}

            <span className="text-xs text-gray-400 font-semibold px-2">
              {currentIdx + 1} / {allLotIds.length}
            </span>

            {nextLot ? (
              <Link
                href={`/auctions/${auction.code}/lot/${nextLot.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-xs font-bold text-gray-600 hover:border-[#32348A] hover:text-[#32348A] transition-colors uppercase tracking-wider"
              >
                Next
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-xs font-bold text-gray-300 uppercase tracking-wider cursor-not-allowed">
                Next
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* ── Left: Images ── */}
          <div className="lg:w-[55%] shrink-0">
            {/* Main image */}
            <div className="relative bg-white border border-gray-200 aspect-square overflow-hidden">
              {lot.imageUrls.length > 0 ? (
                <Image
                  src={lotPhotoUrl(lot.imageUrls[0], true)!}
                  alt={lot.title}
                  fill
                  className="object-contain p-4"
                  sizes="(max-width: 1024px) 100vw, 55vw"
                  priority
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                  <svg className="w-16 h-16 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}

              {/* Lot number badge */}
              <div className="absolute top-3 left-3 bg-[#32348A] text-white text-xs font-black px-3 py-1 tracking-wider uppercase">
                LOT {lotLabel}
              </div>

              {sold && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <span className="bg-red-600 text-white font-black text-2xl tracking-widest uppercase px-8 py-3 rotate-[-8deg]">SOLD</span>
                </div>
              )}
            </div>

            {/* Thumbnail strip */}
            {lot.imageUrls.length > 1 && (
              <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                {lot.imageUrls.map((url, i) => {
                  const thumb = lotPhotoUrl(url, true)
                  return (
                    <div key={i} className="relative w-16 h-16 shrink-0 border border-gray-200 bg-white overflow-hidden">
                      {thumb && (
                        <Image
                          src={thumb}
                          alt={`${lot.title} image ${i + 1}`}
                          fill
                          className="object-contain p-1"
                          sizes="64px"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Right: Details + Bid panel ── */}
          <div className="flex-1 min-w-0">
            {/* Auction label */}
            <div className="flex items-center gap-2 mb-3">
              <Link
                href={`/auctions/${auction.code}`}
                className="text-xs font-black uppercase tracking-widest text-[#2AB4A6] hover:underline"
              >
                {auction.name}
              </Link>
              {auction.auctionDate && (
                <span className="text-xs text-gray-400 font-medium">
                  · {format(new Date(auction.auctionDate), "d MMMM yyyy")}
                </span>
              )}
              {isLive && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-red-600 border border-red-400 px-2 py-0.5 ml-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  LIVE NOW
                </span>
              )}
            </div>

            {/* Title */}
            <h1 className="text-2xl sm:text-3xl font-black text-[#32348A] leading-tight mb-4">
              {lot.title}
            </h1>

            {/* Key details grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-6 border-t border-b border-gray-200 py-4">
              {lot.barcode && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Barcode</p>
                  <p className="text-sm font-bold text-[#32348A]">{lot.barcode}</p>
                </div>
              )}
              {lot.condition && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Condition</p>
                  <p className="text-sm font-semibold text-gray-700">{lot.condition}</p>
                </div>
              )}
              {lot.category && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Category</p>
                  <p className="text-sm font-semibold text-gray-700">{lot.category}</p>
                </div>
              )}
              {lot.brand && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Brand</p>
                  <p className="text-sm font-semibold text-gray-700">{lot.brand}</p>
                </div>
              )}
            </div>

            {/* Current bid + estimate */}
            <div className="mb-6 space-y-1">
              {lot.currentBid && lot.currentBid > 0 && !sold && (
                <p className="text-base font-bold text-gray-900">
                  Current Bid:{" "}
                  <span className="text-[#32348A]">£{lot.currentBid.toLocaleString("en-GB")}</span>
                </p>
              )}
              {sold && lot.hammerPrice ? (
                <p className="text-base font-bold text-gray-900">
                  Hammer Price:{" "}
                  <span className="text-[#32348A] text-2xl">£{lot.hammerPrice.toLocaleString("en-GB")}</span>
                </p>
              ) : (lot.estimateLow || lot.estimateHigh) ? (
                <p className="text-base font-bold text-gray-900">
                  Estimate:{" "}
                  <span className="text-gray-700">
                    {lot.estimateLow && lot.estimateHigh
                      ? `£${lot.estimateLow.toLocaleString("en-GB")} – £${lot.estimateHigh.toLocaleString("en-GB")}`
                      : lot.estimateLow
                      ? `£${lot.estimateLow.toLocaleString("en-GB")}+`
                      : `–£${lot.estimateHigh!.toLocaleString("en-GB")}`}
                  </span>
                </p>
              ) : (
                <p className="text-base text-gray-400">Estimate TBC</p>
              )}
            </div>

            {/* Bid panel (client component) */}
            {!isAuctionFinished && !sold && (
              <LotBidPanel
                lotId={lot.id}
                auctionId={auction.id}
                auctionCode={auction.code}
                auctionName={auction.name}
                isLoggedIn={isLoggedIn}
                isRegistered={isRegistered}
                existingMaxBid={existingBid?.maxBid ?? null}
                estimateLow={lot.estimateLow}
                isLive={isLive}
                currentBid={lot.currentBid}
              />
            )}

            {isAuctionFinished && (
              <div className="bg-gray-100 border border-gray-200 p-4 text-center">
                <p className="text-sm font-bold text-gray-500 uppercase tracking-wider">Auction Ended</p>
                <p className="text-xs text-gray-400 mt-1">Online bidding is now closed for this auction.</p>
              </div>
            )}

            {/* Description — show AI description if available, otherwise key points */}
            {(lot.description || lot.keyPoints) && (
              <div className="mt-6">
                <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3">Description</h2>
                <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap border-t border-gray-200 pt-4">
                  {lot.description || lot.keyPoints}
                </div>
              </div>
            )}

            {/* Back to catalogue link */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <Link
                href={`/auctions/${auction.code}`}
                className="inline-flex items-center gap-2 text-sm font-bold text-[#32348A] hover:underline uppercase tracking-wider"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Catalogue
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom lot navigation ── */}
      <div className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          {prevLot ? (
            <Link
              href={`/auctions/${auction.code}/lot/${prevLot.id}`}
              className="flex items-center gap-2 text-sm font-bold text-[#32348A] hover:underline uppercase tracking-wider"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
              Previous Lot
              <span className="text-gray-400 font-normal normal-case tracking-normal">
                — {prevLot.barcode ?? prevLot.receiptUniqueId ?? ""}
              </span>
            </Link>
          ) : <div />}

          <Link
            href={`/auctions/${auction.code}`}
            className="text-xs font-semibold text-gray-400 hover:text-[#32348A] transition-colors uppercase tracking-widest"
          >
            All Lots
          </Link>

          {nextLot ? (
            <Link
              href={`/auctions/${auction.code}/lot/${nextLot.id}`}
              className="flex items-center gap-2 text-sm font-bold text-[#32348A] hover:underline uppercase tracking-wider"
            >
              <span className="text-gray-400 font-normal normal-case tracking-normal">
                {nextLot.barcode ?? nextLot.receiptUniqueId ?? ""} —
              </span>
              Next Lot
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ) : <div />}
        </div>
      </div>
    </div>
  )
}
