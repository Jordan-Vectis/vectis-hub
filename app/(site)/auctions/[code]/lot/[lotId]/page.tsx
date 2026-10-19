import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { lotPhotoUrl } from "@/lib/photo-url"
import { getCustomerSession } from "@/lib/customer-auth"
import type { Metadata } from "next"
import ZoomPhoto from "@/components/zoom-photo"
import LotBidPanel from "./lot-bid-panel"
import { dateShort, saleDateLong } from "../../../../site-dates"

// One lot of a Hub sale on the test website. Laid out as vectis.co.uk lays out a lot (2026-10-14):
// the photo large on the left with the Hub's zoom viewer (every extra photo opens in it too), the
// lot number, title, estimate / result and the commission-bid panel on the right with the key
// facts and previous / next, then the description, the fees and shipping fold-outs, and an
// invitation to sell.

const gbp = (n: number) => n.toLocaleString("en-GB")

function estimateText(low: number | null, high: number | null): string | null {
  if (low && high) return `£${gbp(low)} - £${gbp(high)}`
  if (low) return `£${gbp(low)}+`
  if (high) return `up to £${gbp(high)}`
  return null
}

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
    title: lot ? `Lot ${lot.barcode ?? lot.receiptUniqueId ?? ""} — ${lot.title}` : "Lot",
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
  const hasBid = (lot.currentBid ?? 0) > 0
  const estimate = estimateText(lot.estimateLow, lot.estimateHigh)
  const saleHref = `/auctions/${auction.code}`
  const photos = lot.imageUrls.map(k => lotPhotoUrl(k, true)).filter((u): u is string => !!u)
  const saleDate = auction.auctionDate ? saleDateLong(auction.auctionDate) : null

  return (
    <div className="vs-page">
      <div className="vs-container">
        {/* ── Back, previous / next ── */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href={saleHref} className="vs-link vs-link-back vs-link-sm">Back to catalogue</Link>
          <div className="sm:ml-auto flex items-center gap-2">
            <NeighbourLink lot={prevLot} dir="prev" saleHref={saleHref} />
            <span className="text-sm text-[var(--vs-muted)] px-1">{currentIdx + 1} / {allLotIds.length}</span>
            <NeighbourLink lot={nextLot} dir="next" saleHref={saleHref} />
          </div>
        </div>

        {/* One grid with two columns on a desktop, so each column runs on without a gap. On a phone
            the column wrappers dissolve (contents) and order-N puts the price and the bid panel
            straight after the photo. */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-10 items-start">

          {/* ── Left: the photos, then the description and the small print ── */}
          <div className="contents lg:flex lg:flex-col lg:gap-6 lg:col-span-7">
            <div className="order-1 vs-card-flat p-3">
              <div className="bg-white flex items-center justify-center min-h-[280px] sm:min-h-[360px]">
                {photos[0] ? (
                  <ZoomPhoto thumb={photos[0]} full={photos[0]} className="max-h-[640px] max-w-full object-contain bg-white" />
                ) : (
                  <p className="py-24 text-center text-sm text-[var(--vs-muted)]">No photo is held for this lot yet.</p>
                )}
              </div>
              {photos.length > 1 && (
                <div className="flex gap-2 mt-3 overflow-x-auto pb-1" aria-label="More photos of this lot">
                  {photos.slice(1).map((url, i) => (
                    <div key={i} className="w-16 h-16 shrink-0 border border-[var(--vs-line)] bg-white">
                      <ZoomPhoto thumb={url} full={url} className="w-16 h-16 object-contain" />
                    </div>
                  ))}
                </div>
              )}
              {photos[0] && <p className="vs-caps text-xs text-[var(--vs-muted)] text-center mt-3">Tap a picture to zoom</p>}
            </div>

            {(lot.description || lot.keyPoints) && (
              <section className="order-3">
                <h2 className="vs-h4 mb-3">Lot description</h2>
                {/* The AI description when there is one, else the cataloguer's key points. */}
                <div className="vs-prose">
                  <p className="whitespace-pre-wrap">{lot.description || lot.keyPoints}</p>
                </div>
              </section>
            )}

            <FoldOut className="order-4" title="Fees & VAT">
              <p>Buyer&apos;s Premium for each lot will be 22.5% plus VAT (27%).</p>
              <p>Payment for lots can be made by credit or debit card (we accept all major cards), by bank transfer, or by cheque provided we have a bank guarantee or alternative arrangements have been agreed.</p>
              <h4>Buyer&apos;s premium for live online bidding via the-saleroom</h4>
              <p><strong>Purchasers will be charged a total premium of 32.94% on the hammer price inclusive of VAT. This will include a charge made by the-saleroom which will be shown separately on your invoice.</strong></p>
              <p>There is no additional charge for bidding via the Vectis Live website.</p>
              <p>If you notice an error with our catalogue descriptions please don&apos;t hesitate to contact us. In the unlikely event the catalogue description does not match the image provided, please contact us. If you notice during or after an auction, please note that we will always sell a lot based on the description rather than the image.</p>
              <p>
                If you have any queries please contact us on <a href="tel:+441642750616">+44 (0) 1642 750616</a> or email{" "}
                <a href="mailto:admin@vectis.co.uk">admin@vectis.co.uk</a>.
              </p>
            </FoldOut>

            <FoldOut className="order-5" title="Shipping and postage">
              <p>Whether you&apos;re buying a Star Wars figure or a Matchbox car – we can have your lots securely delivered anywhere in the world.</p>
              <p>Our in-house shipping service means we can safely and quickly dispatch your auction lots straight to your front door.</p>
              <p>Our website displays the shipping cost on each individual lot, with discounts for combined postage.</p>
              <p>We endeavour to deliver your parcels as fast as possible (average shipping 14 days), however in peak times please note that shipping may take up to 28 days.</p>

              <h4>UK postage prices (plus VAT)</h4>
              <PriceTable rows={[
                ["Small", "£15.95", "+ £2.50 per additional small lot"],
                ["Medium", "£20.95", "+ £5.50 per additional medium lot"],
                ["Large", "£25.95", "+ £20.50 per additional large lot"],
                ["Extra large", "Quote or pick up only", ""],
              ]} />
              <p>
                <strong>For example:</strong> 1 × medium (£20.95) and 3 × small (£2.50 + £2.50 + £2.50)<br />
                £20.95 + £2.50 + £2.50 + £2.50 = £28.45 plus VAT
              </p>

              <h4>European postage costs</h4>
              <p>Shipping is automatically calculated for addresses within Parcel Force zones 6, 7, 8 and 9.</p>
              <p>
                <strong>Zone 6</strong> Netherlands, Belgium, Luxembourg, Ireland ·{" "}
                <strong>Zone 7</strong> France, Germany, Denmark ·{" "}
                <strong>Zone 8</strong> Italy, Spain, Portugal, Greece
              </p>
              <PriceTable rows={[
                ["Small", "£34.95", "+ £4.95 per additional small lot"],
                ["Medium", "£49.95", "+ £9.95 per additional medium lot"],
                ["Large", "£64.95", "+ £19.95 per additional large lot"],
                ["Extra large", "Please contact us for a quote or collection option", ""],
              ]} />
              <p><strong>Zone 9</strong> Rest of Europe — select zone 9 in the drop-down to see the list of countries.</p>
              <PriceTable rows={[
                ["Small", "£34.95", "+ £9.95 per additional small lot"],
                ["Medium", "£66.95", "+ £14.95 per additional medium lot"],
                ["Large", "£89.95", "+ £19.95 per additional large lot"],
                ["Extra large", "Please contact us for a quote or collection option", ""],
              ]} />

              <h4>Rest of the world postage costs</h4>
              <p>For all other countries outside of these zones (e.g. USA, Canada, Japan, Australia) please contact us for a shipping quote.</p>
              <p>Any parcels shipped to the United States may be subject to customs duty charges ranging from 10% to 50%.</p>
              <p>
                <a href="mailto:dispatch@vectis.co.uk">dispatch@vectis.co.uk</a> or contact <a href="tel:+441642750616">(+44) 01642 750 616</a>
              </p>
              <p><strong>PLEASE NOTE: Due to the automatic postal charges we are no longer able to combine shipping costs over multiple sale dates.</strong></p>
            </FoldOut>

            <div className="order-6">
              <Link href="/faq" className="vs-btn vs-btn-outline">View FAQs</Link>
            </div>
          </div>

          {/* ── Right: the lot's headline, price and bid panel, the facts, then a nudge to sell ── */}
          <div className="contents lg:flex lg:flex-col lg:gap-6 lg:col-span-5">
            <div className="order-2 flex flex-col gap-6">
              <div>
                <p className="vs-kicker mb-2">Lot {lotLabel}</p>
                <h1 className="vs-h2 vs-h2-light">{lot.title}</h1>
                <p className="mt-3 text-sm text-[var(--vs-muted)]">
                  <Link href={saleHref} className="vs-text-link">{auction.name}</Link>
                  {saleDate && <> · {saleDate}</>}
                  {isLive && <span className="vs-badge vs-badge-red text-xs ml-3">Live now</span>}
                </p>
              </div>

              {/* The price up front: the result once sold, else the current bid and the estimate. */}
              <div className="vs-card-flat p-5">
                {sold ? (
                  <>
                    <p className="vs-price-label">Hammer price</p>
                    <p className="text-[36px] leading-none font-semibold text-[var(--vs-navy)] mt-1">{lot.hammerPrice ? `£${gbp(lot.hammerPrice)}` : "Sold"}</p>
                    <p className="text-sm text-[var(--vs-muted)] mt-2">Excludes buyer&apos;s premium.</p>
                  </>
                ) : isAuctionFinished ? (
                  <>
                    <p className="vs-price-label">Result</p>
                    <p className="text-[28px] leading-none font-semibold text-[var(--vs-muted)] mt-1">Unsold</p>
                    <p className="text-sm text-[var(--vs-muted)] mt-2">This lot did not sell on the day.</p>
                  </>
                ) : (
                  <>
                    {hasBid ? (
                      <>
                        <p className="vs-price-label">Current bid</p>
                        <p className="text-[36px] leading-none font-semibold text-[var(--vs-navy)] mt-1">£{gbp(lot.currentBid!)}</p>
                      </>
                    ) : (
                      <>
                        <p className="vs-price-label">Estimate</p>
                        <p className="text-[28px] leading-none font-semibold text-[var(--vs-navy)] mt-1">{estimate ?? "To be confirmed"}</p>
                      </>
                    )}
                  </>
                )}
                {estimate && (sold || isAuctionFinished || hasBid) && (
                  <p className="mt-4 pt-4 border-t border-[var(--vs-line)] text-sm text-[var(--vs-muted)]">Estimate: {estimate}</p>
                )}
                {isAuctionFinished && !sold && (
                  <p className="mt-4 pt-4 border-t border-[var(--vs-line)] text-sm text-[var(--vs-muted)]">Online bidding is now closed for this auction.</p>
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

              {/* Key information */}
              <div>
                <h2 className="vs-h4 mb-3">Key information</h2>
                <dl className="text-sm border-t border-[var(--vs-line)]">
                  <Fact label="Lot">{lotLabel}</Fact>
                  <Fact label="Sale"><Link href={saleHref} className="vs-text-link">{auction.name}</Link></Fact>
                  {auction.auctionDate && <Fact label="Sale date">{dateShort(auction.auctionDate)}</Fact>}
                  <Fact label="Sale code">{auction.code}</Fact>
                  {lot.condition && <Fact label="Condition">{lot.condition}</Fact>}
                  {lot.category && <Fact label="Category">{lot.category}</Fact>}
                  {lot.brand && <Fact label="Brand">{lot.brand}</Fact>}
                </dl>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <NeighbourLink lot={prevLot} dir="prev" saleHref={saleHref} wide />
                <NeighbourLink lot={nextLot} dir="next" saleHref={saleHref} wide />
              </div>
            </div>

            {/* Got one to sell? */}
            <div className="order-7 bg-[var(--vs-navy)] text-white p-6 sm:p-8">
              <h3 className="vs-h3 !text-white mb-3">Got one to sell?</h3>
              <p className="text-white/85 mb-6">
                Contact our Collections Team, who will guide you through the process. We sell over 98% of all items consigned to our auctions.
              </p>
              <Link href="/sell-with-us" className="vs-btn vs-btn-white">Get started</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// A fold-out section, no JavaScript: a native <details> with the title and a chevron that turns when open.
function FoldOut({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <details className={`group vs-card-flat ${className ?? ""}`}>
      <summary className="cursor-pointer select-none px-5 py-4 flex items-center justify-between gap-4">
        <span className="vs-h4">{title}</span>
        <svg className="w-5 h-5 shrink-0 text-[var(--vs-navy)] transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="vs-prose px-5 pb-5 text-sm">{children}</div>
    </details>
  )
}

// Size / price / per-additional-lot rows for the postage charges (styled by vs-prose's table rules).
function PriceTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <table className="w-full">
      <tbody>
        {rows.map(([size, price, extra]) => (
          <tr key={size}>
            <th scope="row" className="w-28">{size}</th>
            <td className="whitespace-nowrap">{price}</td>
            <td>{extra}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-x-4 py-2.5 border-b border-[var(--vs-line)]">
      <dt className="text-[var(--vs-muted)]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function NeighbourLink({ lot, dir, saleHref, wide }: {
  lot: { id: string; barcode: string | null; receiptUniqueId: string | null } | null
  dir: "prev" | "next"; saleHref: string; wide?: boolean
}) {
  const label = lot ? (dir === "prev" ? "Previous lot" : "Next lot") : (dir === "prev" ? "First lot" : "Last lot")
  const cls = `vs-btn vs-btn-outline vs-btn-sm ${wide ? "vs-btn-block" : ""}`
  if (!lot) return <span className={cls} aria-disabled="true">{label}</span>
  const id = lot.barcode ?? lot.receiptUniqueId ?? ""
  return (
    <Link href={`${saleHref}/lot/${lot.id}`} className={cls} title={id ? `Lot ${id}` : undefined}>
      {dir === "prev" && <span aria-hidden="true">‹</span>}
      {label}
      {dir === "next" && <span aria-hidden="true">›</span>}
    </Link>
  )
}
