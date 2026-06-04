import BidJS from "@bidlogixteam/bidjs-sdk"
import type { UpcomingAuctionModel } from "@bidlogixteam/bidjs-sdk/dist/public/home/home.types"
import Link from "next/link"
import Image from "next/image"
import { format } from "date-fns"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "BidJS Live Auctions",
  robots: { index: false },
}

async function getBidjsAuctions(): Promise<UpcomingAuctionModel[]> {
  const bidjs = new BidJS({
    clientId:     "lewes-demo",
    region:       "eu-west-2",
    host:         "lewes-staging",
    isProduction: false,
    language:     "en-GB",
  })
  const home = await bidjs.public.home.v1.get()
  return home.models.HomePageModel.upcomingModel.upcomingAuctions
}

export default async function BidJSAuctionsPage() {
  let auctions: UpcomingAuctionModel[] = []
  let error: string | null = null

  try {
    auctions = await getBidjsAuctions()
  } catch (e: any) {
    error = e?.message ?? "Failed to load BidJS auctions"
  }

  return (
    <div>
      {/* Platform switcher */}
      <div className="bg-[#1e3058] border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mr-2">Auction Platform:</span>
          <Link
            href="/auctions"
            className="text-xs font-bold uppercase tracking-widest text-gray-300 hover:text-white px-3 py-1.5 rounded transition-colors"
          >
            Vectis Catalogue
          </Link>
          <span className="text-xs font-black uppercase tracking-widest text-white bg-[#2AB4A6] px-3 py-1.5 rounded">
            BidJS Live Bidding
          </span>
        </div>
      </div>

      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-black text-[#32348A] uppercase tracking-tight mb-1">
              BidJS Live Auctions
            </h1>
            <p className="text-gray-400 text-sm">
              Powered by BidJS &mdash; sandbox environment
            </p>
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest border border-amber-400 text-amber-600 px-2 py-1 rounded">
            Sandbox
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {error ? (
          <div className="text-center py-20">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : auctions.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">No upcoming BidJS auctions at the moment.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0 border border-gray-200">
            {auctions.map((auction) => {
              const thumb = auction.firstItem?.attachmentModel?.thumbSrc
                ?? auction.firstItem?.attachmentModel?.attachmentUrl
                ?? null
              const startDate = auction.auctionStartTime
                ? new Date(auction.auctionStartTime)
                : null

              return (
                <div
                  key={auction.auctionUuid}
                  className="flex border-b border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                >
                  {/* Image */}
                  <div
                    className="relative shrink-0 bg-gray-100 overflow-hidden"
                    style={{ width: "240px", minHeight: "160px" }}
                  >
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={auction.title}
                        fill
                        unoptimized
                        className="object-cover hover:scale-105 transition-transform duration-300"
                        sizes="240px"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-[#32348A]/5 flex items-center justify-center">
                        <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 px-6 py-5 flex flex-col justify-between min-w-0">
                    <div className="mb-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-[#2AB4A6]">
                        {auction.typeMessage ?? "Auction"}
                      </span>
                    </div>

                    <div className="mb-3">
                      <h2 className="text-[#32348A] font-black text-xl leading-tight mb-1">
                        {auction.title}
                      </h2>
                      {startDate && (
                        <p className="text-gray-500 text-sm uppercase font-medium tracking-wide">
                          {format(startDate, "EEEE d MMMM yyyy HH:mm").toUpperCase()}
                        </p>
                      )}
                      <p className="text-gray-400 text-xs mt-1">
                        {auction.numberOfItems ?? auction.itemCount} lots
                        {auction.timedType && " · Timed"}
                        {auction.webcastType && " · Webcast"}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <a
                        href={`https://examples-lewes-staging.eu-west-2.staging.bidjs.com/5/index.html?clientId=lewes-demo#!/auction/${auction.auctionUuid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-[#32348A] hover:bg-[#28296e] text-white text-xs font-black uppercase tracking-widest px-4 py-2 transition-colors"
                      >
                        View &amp; Bid
                      </a>
                    </div>
                  </div>

                  {/* Date block */}
                  {startDate && (
                    <div className="shrink-0 w-28 border-l border-gray-200 flex flex-col items-center justify-center py-5 px-2 bg-gray-50">
                      <span className="text-[#32348A] font-black text-5xl leading-none">
                        {format(startDate, "d")}
                      </span>
                      <span className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-1">
                        {format(startDate, "EEEE")}
                      </span>
                      <span className="text-gray-400 text-[10px] uppercase tracking-wider mt-0.5">
                        {format(startDate, "MMMM yyyy")}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
