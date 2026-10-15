import { notFound } from "next/navigation"
import Link from "next/link"
import ZoomPhoto from "@/components/zoom-photo"
import { getResultSale, getResultLot, getResultSummary, saleHasHappened, type LotNeighbour, type ResultSale } from "../../../data"
import { dateShort, saleDateLong } from "../../../../../site-dates"

// One lot of a sale on the test website — the page a lot card opens. Laid out as vectis.co.uk
// lays out a lot (2026-10-14): the photo large on the left with the Hub's zoom viewer, the lot
// number, title and the result (or, before the sale, the estimate and a way to log in and bid)
// on the right with the key facts and previous / next, then the full description, the fees and
// shipping fold-outs, and an invitation to sell.

export const dynamic = "force-dynamic"

const gbp = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 })

function estimateText(low: number | null, high: number | null): string | null {
  if (low && high) return `£${gbp(low)} - £${gbp(high)}`
  if (low) return `£${gbp(low)}+`
  if (high) return `up to £${gbp(high)}`
  return null
}

// The first 120 characters of the description, cut at a word — never at a full stop, the same rule
// as the Hub's own lot titles ("Mixed group. A group of…" must not become "Mixed group").
function headline(description: string): string {
  const t = description.replace(/\s+/g, " ").trim()
  if (!t) return "Lot"
  if (t.length <= 120) return t
  const cut = t.slice(0, 120)
  const space = cut.lastIndexOf(" ")
  return (space > 60 ? cut.slice(0, space) : cut).replace(/[,;:\-–]$/, "") + "…"
}

function parseSiteId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null
}

async function load(siteIdRaw: string, lotId: string) {
  const siteId = parseSiteId(siteIdRaw)
  if (siteId == null) return null
  const sale = await getResultSale(siteId)
  if (!sale) return null
  const lot = await getResultLot(sale, decodeURIComponent(lotId))
  if (!lot) return null
  return { sale, lot }
}

export async function generateMetadata({ params }: { params: Promise<{ siteId: string; lotId: string }> }) {
  const { siteId, lotId } = await params
  const data = await load(siteId, lotId).catch(() => null)
  return { title: data ? `Lot ${data.lot.lot ?? ""} — ${headline(data.lot.description)}` : "Lot" }
}

export default async function ResultLotPage({ params }: { params: Promise<{ siteId: string; lotId: string }> }) {
  const { siteId, lotId } = await params
  const data = await load(siteId, lotId)
  if (!data) notFound()
  const { sale, lot } = data

  const saleHref = `/auctions/results/${sale.siteId}`
  const title = headline(lot.description)
  const estimate = estimateText(lot.estimateLow, lot.estimateHigh)
  // Before the day there is no result — the estimate stands, and the lot is not "unsold".
  const happened = saleHasHappened(sale)
  const sold = happened && lot.hammer != null
  // A sale can have happened without its hammer prices being in yet — then an unsold-looking lot
  // is simply waiting for its result, and must not be called unsold.
  const summary = happened && !sold ? await getResultSummary(sale).catch(() => null) : null
  const resultsIn = sold || (!!summary && summary.sold > 0)
  const saleDate = sale.saleDate ? saleDateLong(sale.saleDate) : null

  return (
    <div className="vs-page">
      <div className="vs-container">
        {/* ── Back, which sale, previous / next ── */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href={saleHref} className="vs-link vs-link-back vs-link-sm">{happened ? "Back to results" : "Back to lots"}</Link>
          <div className="sm:ml-auto flex items-center gap-2">
            <NeighbourLink n={lot.prev} dir="prev" saleHref={saleHref} />
            <NeighbourLink n={lot.next} dir="next" saleHref={saleHref} />
          </div>
        </div>

        {/* One grid with two columns on a desktop, so each column runs on without a gap (two stacked
            grids left a hole under the photo whenever the right column was the taller one). On a phone
            the column wrappers dissolve (contents) and order-N puts the result straight after the photo. */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-10 items-start">

          {/* ── Left: the photo, then the full description and the small print ── */}
          <div className="contents lg:flex lg:flex-col lg:gap-6 lg:col-span-7">
            <div className="order-1 vs-card-flat p-3">
              <div className="bg-white flex items-center justify-center min-h-[280px] sm:min-h-[360px]">
                {lot.photo ? (
                  <ZoomPhoto thumb={lot.photo} full={lot.photoFull} className="max-h-[640px] max-w-full object-contain bg-white" />
                ) : (
                  <p className="py-24 text-center text-sm text-[var(--vs-muted)]">No photo is held for this lot.</p>
                )}
              </div>
              {lot.photo && <p className="vs-caps text-xs text-[var(--vs-muted)] text-center mt-3">Tap the picture to zoom</p>}
            </div>

            <section className="order-3">
              <h2 className="vs-h4 mb-3">Lot description</h2>
              <div className="vs-prose">
                <p className="whitespace-pre-line">{lot.description || <span className="text-[var(--vs-muted)]">No description is held for this lot.</span>}</p>
              </div>
              <div className="mt-6 pt-5 border-t border-[var(--vs-line)] text-sm text-[var(--vs-muted)] leading-relaxed space-y-3">
                <p>{DISCLAIMER}</p>
                <p className="font-semibold text-[var(--vs-ink)]">By bidding on any lot, you agree to any and all of these terms.</p>
              </div>
            </section>

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

          {/* ── Right: the lot's headline, result and facts, then a nudge to sell ── */}
          <div className="contents lg:flex lg:flex-col lg:gap-6 lg:col-span-5">
            <div className="order-2 flex flex-col gap-6">
              <div>
                <p className="vs-kicker mb-2">Lot {lot.lot ?? "—"}</p>
                <h1 className="vs-h2 vs-h2-light">{title}</h1>
              </div>

              {/* The result up front — or, before the sale, the estimate and the way to bid. */}
              <div className="vs-card-flat p-5">
                {happened ? (
                  sold ? (
                    <>
                      <p className="vs-price-label">Hammer price</p>
                      <p className="text-[36px] leading-none font-semibold text-[var(--vs-navy)] mt-1">£{gbp(lot.hammer!)}</p>
                      <p className="text-sm text-[var(--vs-muted)] mt-2">Sold{saleDate ? ` on ${saleDate}` : ""}. Excludes buyer&apos;s premium.</p>
                    </>
                  ) : resultsIn ? (
                    <>
                      <p className="vs-price-label">Result</p>
                      <p className="text-[28px] leading-none font-semibold text-[var(--vs-muted)] mt-1">Unsold</p>
                      <p className="text-sm text-[var(--vs-muted)] mt-2">This lot did not sell on the day.</p>
                    </>
                  ) : (
                    <>
                      <p className="vs-price-label">Result</p>
                      <p className="text-[28px] leading-none font-semibold text-[var(--vs-muted)] mt-1">To follow</p>
                      <p className="text-sm text-[var(--vs-muted)] mt-2">The hammer prices for this sale are not in yet.</p>
                    </>
                  )
                ) : (
                  <>
                    <p className="vs-price-label">Estimate</p>
                    <p className="text-[28px] leading-none font-semibold text-[var(--vs-navy)] mt-1">{estimate ?? "To be confirmed"}</p>
                    {saleDate && <p className="text-sm text-[var(--vs-muted)] mt-2">Sale starts {saleDate}.</p>}
                    <Link href="/portal/login" className="vs-btn vs-btn-block mt-5">Login to bid</Link>
                  </>
                )}
                {happened && estimate && (
                  <p className="mt-4 pt-4 border-t border-[var(--vs-line)] text-sm text-[var(--vs-muted)]">Estimate: {estimate}</p>
                )}
              </div>

              {/* Key information */}
              <div>
                <h2 className="vs-h4 mb-3">Key information</h2>
                <dl className="text-sm border-t border-[var(--vs-line)]">
                  <Fact label="Lot">{lot.lot ?? "—"}</Fact>
                  <Fact label="Sale"><Link href={saleHref} className="vs-text-link">{sale.title}</Link></Fact>
                  {sale.saleDate && <Fact label="Sale date">{dateShort(sale.saleDate)}</Fact>}
                  {sale.code && <Fact label="Sale code">{sale.code}</Fact>}
                  {lot.category && <Fact label="Category">{lot.category}</Fact>}
                  {lot.subcategory && <Fact label="Sub-category">{lot.subcategory}</Fact>}
                  {isBcSale(sale) && <Fact label="Lot ID">{lot.id}</Fact>}
                </dl>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <NeighbourLink n={lot.prev} dir="prev" saleHref={saleHref} wide />
                <NeighbourLink n={lot.next} dir="next" saleHref={saleHref} wide />
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

// Vectis's own wording, as it reads under every lot on vectis.co.uk.
const DISCLAIMER =
  "We have endeavoured to describe all toys and collectables to the best of our ability – however THIS IS NOT A WARRANTY. " +
  "All toys and collectables are SOLD AS IS, all lots are accompanied by photographic images to enable you to determine the " +
  "condition of the lot. Refunds cannot be provided for lots whereby the buyer has failed to notice defects, faults or issues " +
  "which can be seen in the images or covered by the auction house grading system. Omission of information in the description " +
  "in no way indicates the item is without flaws, missing parts/items, damage, and age wear. All items are untested unless " +
  "otherwise stated. Specific condition questions are welcomed at least 24 hours prior to the start of the auction. If you " +
  "cannot ascertain the information to bid with certainty, please do not bid."

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

// A BC sale has a code and no old-system auction id; only there is the lot id (R008728-194) worth showing.
const isBcSale = (sale: ResultSale) => sale.auctionId == null

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-x-4 py-2.5 border-b border-[var(--vs-line)]">
      <dt className="text-[var(--vs-muted)]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function NeighbourLink({ n, dir, saleHref, wide }: { n: LotNeighbour | null; dir: "prev" | "next"; saleHref: string; wide?: boolean }) {
  const label = n ? (dir === "prev" ? `Previous lot` : `Next lot`) : (dir === "prev" ? "First lot" : "Last lot")
  const cls = `vs-btn vs-btn-outline vs-btn-sm ${wide ? "vs-btn-block" : ""}`
  if (!n) return <span className={cls} aria-disabled="true">{label}</span>
  return (
    <Link href={`${saleHref}/lot/${encodeURIComponent(n.id)}`} className={cls} title={`Lot ${n.lot ?? ""}`}>
      {dir === "prev" && <span aria-hidden="true">‹</span>}
      {label}{n.lot != null && <span className="font-normal normal-case tracking-normal"> {n.lot}</span>}
      {dir === "next" && <span aria-hidden="true">›</span>}
    </Link>
  )
}
