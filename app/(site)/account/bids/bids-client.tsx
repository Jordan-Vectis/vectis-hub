"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { lotPhotoUrl } from "@/lib/photo-url"
import { dateShort } from "../../site-dates"

// The customer's commission bids: one fold-out per sale (the newest open), each lot a hairline
// row — picture, title, lot number and estimate, the figures, and a chip for where it stands.
// Dates are formatted in Europe/London here too: the server renders this first, in UTC, so a
// bare toLocaleString would print one time there and another once the browser took over.

type LotBid = {
  bidId: string
  lotId: string
  lotBarcode: string | null
  lotTitle: string
  imageUrl: string | null
  lotStatus: string
  currentBid: number | null
  hammerPrice: number | null
  estimateLow: number | null
  estimateHigh: number | null
  maxBid: number
  placedAt: string
  updatedAt: string
}

type AuctionGroup = {
  auctionId: string
  auctionCode: string
  auctionName: string
  auctionDate: string | null
  isFinished: boolean
  bids: LotBid[]
}

const gbp = (n: number) => `£${n.toLocaleString("en-GB")}`

/** "5 Oct 2026, 14:32" in London time. */
const whenLondon = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))

type ChipTone = "navy" | "red" | "grey"

/** A status chip: won = navy badge, active = red badge, over = a grey outline. */
function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  if (tone === "grey") {
    return <span className="inline-block vs-caps !text-xs px-3 py-1 border border-[var(--vs-line)] bg-white text-[var(--vs-muted)] whitespace-nowrap">{children}</span>
  }
  return <span className={`vs-badge !text-xs !px-3 !py-1 whitespace-nowrap${tone === "red" ? " vs-badge-red" : ""}`}>{children}</span>
}

export default function BidsClient({ groups }: { groups: AuctionGroup[] }) {
  // The newest sale starts open, the rest folded.
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.length > 0 ? [groups[0].auctionId] : []))

  const toggle = (id: string) => {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <div className="vs-card-flat p-8 sm:p-10 text-center">
        <p className="vs-h4 mb-2">No bids placed yet</p>
        <p className="text-[var(--vs-muted)] max-w-md mx-auto mb-6">
          Browse the upcoming auctions and leave a commission bid on the lots you would like.
        </p>
        <Link href="/auctions" className="vs-btn">Browse auctions</Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map(group => {
        const isOpen = open.has(group.auctionId)
        const panelId = `bids-${group.auctionId}`
        const totalBid = group.bids.reduce((s, b) => s + b.maxBid, 0)
        const wonCount = group.bids.filter(b => b.lotStatus === "SOLD" && b.hammerPrice !== null).length
        const activeBids = group.bids.filter(b => b.lotStatus !== "SOLD").length

        return (
          <section key={group.auctionId} className="vs-card-flat">
            <h2 className="m-0">
              <button
                type="button"
                onClick={() => toggle(group.auctionId)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className="w-full flex items-center gap-4 px-4 sm:px-5 py-4 text-left hover:bg-[var(--vs-bg)] transition-colors"
              >
                <svg
                  className={`w-4 h-4 shrink-0 text-[var(--vs-navy)] transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block vs-h4 leading-tight">{group.auctionName}</span>
                  <span className="block text-sm text-[var(--vs-muted)] mt-1">
                    {group.auctionDate ? dateShort(new Date(group.auctionDate)) : "Date to be confirmed"}
                    {" · "}{group.bids.length} {group.bids.length === 1 ? "lot" : "lots"}
                  </span>
                </span>
                <span className="hidden sm:flex items-center gap-3 shrink-0">
                  {wonCount > 0 && <Chip tone="navy">{wonCount} won</Chip>}
                  {activeBids > 0 && !group.isFinished && <Chip tone="red">{activeBids} active</Chip>}
                  {group.isFinished && wonCount === 0 && <Chip tone="grey">Ended</Chip>}
                  <span className="text-right ml-2">
                    <span className="block vs-price-label">Total bid</span>
                    <span className="block vs-price">{gbp(totalBid)}</span>
                  </span>
                </span>
              </button>
            </h2>

            {isOpen && (
              <ul id={panelId} className="border-t border-[var(--vs-line)]">
                {group.bids.map(bid => {
                  const img = lotPhotoUrl(bid.imageUrl, true)
                  const href = `/auctions/${group.auctionCode}/lot/${bid.lotId}`
                  const sold = bid.lotStatus === "SOLD"
                  const won = sold && bid.hammerPrice !== null
                  const current = bid.currentBid
                  const showCurrent = current !== null && current > 0 && !won
                  const atLimit = current !== null && current >= bid.maxBid

                  return (
                    <li key={bid.bidId} className="border-b border-[var(--vs-line)] last:border-b-0 px-4 sm:px-5 py-4">
                      <div className="grid grid-cols-[64px_minmax(0,1fr)] sm:grid-cols-[72px_minmax(0,1fr)_auto] gap-x-4 gap-y-3 items-center">
                        <Link href={href} tabIndex={-1} aria-hidden="true" className="block w-16 h-16 sm:w-[72px] sm:h-[72px] bg-[var(--vs-bg)] border border-[var(--vs-line)] overflow-hidden">
                          {img && <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" />}
                        </Link>

                        <div className="min-w-0">
                          <Link href={href} className="font-medium text-black hover:underline line-clamp-2">{bid.lotTitle}</Link>
                          <p className="text-sm text-[var(--vs-muted)] mt-0.5">
                            {bid.lotBarcode ? `Lot ${bid.lotBarcode}` : "Lot number to follow"}
                            {bid.estimateLow !== null && bid.estimateHigh !== null && (
                              <> · Estimate {gbp(bid.estimateLow)} – {gbp(bid.estimateHigh)}</>
                            )}
                          </p>
                          <p className="text-xs text-[var(--vs-muted)] mt-0.5">
                            Bid placed {whenLondon(bid.placedAt)}
                            {bid.updatedAt !== bid.placedAt && <> · Updated {whenLondon(bid.updatedAt)}</>}
                          </p>
                        </div>

                        <div className="col-span-2 sm:col-span-1 flex flex-wrap items-center justify-between sm:justify-end gap-x-6 gap-y-2 sm:text-right">
                          {showCurrent && (
                            <div>
                              <p className="vs-price-label">Current bid</p>
                              <p className={`vs-price${atLimit ? " !text-[var(--vs-red)]" : ""}`}>{gbp(current)}</p>
                              {atLimit && <p className="vs-kicker !text-xs">At your limit</p>}
                            </div>
                          )}
                          <div>
                            <p className="vs-price-label">{won ? "Hammer price" : "Your max bid"}</p>
                            <p className="vs-price">{gbp(won && bid.hammerPrice !== null ? bid.hammerPrice : bid.maxBid)}</p>
                          </div>
                          <div className="sm:min-w-[88px] sm:text-right">
                            {won ? <Chip tone="navy">Won</Chip>
                              : sold ? <Chip tone="grey">Not won</Chip>
                              : group.isFinished ? <Chip tone="grey">Ended</Chip>
                              : <Chip tone="red">Active</Chip>}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
