import { notFound } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import ZoomPhoto from "@/components/zoom-photo"
import { getResultSale, getResultLot, type LotNeighbour, type ResultSale } from "../../../data"

// One lot from a past sale on the test website — the page a results-grid card opens. Its own
// design (Jordan, 2026-09-23: "don't copy the design though"): the photo large with the Hub's zoom
// viewer, the result up front, then the description and the key facts, with previous / next lot.

export const dynamic = "force-dynamic"

const gbp = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 })

function estimateText(low: number | null, high: number | null): string | null {
  if (low && high) return `£${gbp(low)} – £${gbp(high)}`
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
  const sold = lot.hammer != null
  const saleDate = sale.saleDate ? format(new Date(sale.saleDate), "EEEE d MMMM yyyy") : null

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* ── Top bar: back, which sale, previous / next ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={saleHref} className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-[#32348A] hover:text-[#DB0606] transition-colors">
            <span aria-hidden="true">←</span> Back to results
          </Link>
          <span className="hidden sm:inline text-gray-300">|</span>
          <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
            <Link href={saleHref} className="text-sm font-bold text-gray-700 hover:text-[#32348A] truncate">{sale.title}</Link>
            {saleDate && <span className="text-[11px] text-gray-400 uppercase tracking-wide">{saleDate}</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <NeighbourLink n={lot.prev} dir="prev" saleHref={saleHref} />
            <NeighbourLink n={lot.next} dir="next" saleHref={saleHref} />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ── Photo ── */}
        <div className="lg:col-span-7">
          <div className="bg-white border border-gray-200 p-3">
            <div className="bg-gray-100 flex items-center justify-center" style={{ minHeight: "320px" }}>
              {lot.photo ? (
                <ZoomPhoto thumb={lot.photo} full={lot.photoFull} className="max-h-[640px] max-w-full object-contain bg-gray-100" />
              ) : (
                <div className="py-24 text-center text-gray-400">
                  <svg className="w-14 h-14 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">No photo is held for this lot.</p>
                </div>
              )}
            </div>
            {lot.photo && (
              <p className="text-[11px] text-gray-400 text-center mt-2 uppercase tracking-widest">Tap the picture to zoom</p>
            )}
          </div>
        </div>

        {/* ── Details ── */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          <div>
            <p className="text-xs font-black text-[#DB0606] tracking-[0.25em] uppercase">Lot {lot.lot ?? "—"}</p>
            <h1 className="text-2xl sm:text-3xl font-black text-[#32348A] leading-tight mt-1">{title}</h1>
          </div>

          {/* The result, up front */}
          <div className={`border-2 p-5 ${sold ? "border-[#32348A] bg-white" : "border-gray-300 bg-gray-100"}`}>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500 mb-2">Result</p>
            {sold ? (
              <>
                <p className="text-4xl font-black text-[#32348A] leading-none">£{gbp(lot.hammer!)}</p>
                <p className="text-xs text-gray-500 mt-2">Hammer price{saleDate ? `, ${saleDate}` : ""}. Excludes buyer&apos;s premium.</p>
              </>
            ) : (
              <>
                <p className="text-3xl font-black text-gray-500 leading-none uppercase tracking-wide">Unsold</p>
                <p className="text-xs text-gray-500 mt-2">This lot did not sell on the day.</p>
              </>
            )}
            {estimate && (
              <p className="mt-4 pt-4 border-t border-gray-200 text-sm text-gray-700">
                <span className="font-black text-[#32348A] uppercase tracking-wider text-xs mr-2">Estimate</span>{estimate}
              </p>
            )}
          </div>

          {/* Key information */}
          <div className="bg-white border border-gray-200 p-5">
            <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-[#DB0606] mb-3">Key information</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <Fact label="Lot">{lot.lot ?? "—"}</Fact>
              <Fact label="Sale"><Link href={saleHref} className="text-[#32348A] hover:underline">{sale.title}</Link></Fact>
              {saleDate && <Fact label="Sale date">{saleDate}</Fact>}
              {sale.code && <Fact label="Sale code">{sale.code}</Fact>}
              {lot.category && <Fact label="Category">{lot.category}</Fact>}
              {lot.subcategory && <Fact label="Sub-category">{lot.subcategory}</Fact>}
              {isBcSale(sale) && <Fact label="Lot ID"><span className="font-mono text-xs">{lot.id}</span></Fact>}
            </dl>
          </div>

          <div className="flex items-center justify-between gap-3">
            <NeighbourLink n={lot.prev} dir="prev" saleHref={saleHref} wide />
            <NeighbourLink n={lot.next} dir="next" saleHref={saleHref} wide />
          </div>
        </div>
      </div>

      {/* ── Below the lot: the full description and the small print, and a nudge to sell ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 flex flex-col gap-4">
          <section className="bg-white border border-gray-200 p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#DB0606]">Lot {lot.lot ?? "—"}</p>
            <h2 className="text-xl font-black text-[#32348A] mb-4">Full lot description</h2>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">
              {lot.description || <span className="text-gray-400">No description is held for this lot.</span>}
            </p>
            <div className="mt-6 pt-5 border-t border-gray-200 text-xs text-gray-500 leading-relaxed space-y-3">
              <p>{DISCLAIMER}</p>
              <p className="font-bold text-gray-600">By bidding on any lot, you agree to any and all of these terms.</p>
            </div>
          </section>

          <Accordion kicker="Auction fees" title="Fees & VAT">
            <p>Buyer&apos;s Premium for each lot will be 22.5% plus VAT (27%).</p>
            <p>Payment for lots can be made by credit or debit card (we accept all major cards), by bank transfer, or by cheque provided we have a bank guarantee or alternative arrangements have been agreed.</p>
            <h4 className="text-base font-black text-[#32348A] uppercase tracking-wide pt-2">Buyer&apos;s premium for live online bidding via the-saleroom</h4>
            <p className="font-bold text-gray-800">Purchasers will be charged a total premium of 32.94% on the hammer price inclusive of VAT. This will include a charge made by the-saleroom which will be shown separately on your invoice.</p>
            <p>There is no additional charge for bidding via the Vectis Live website.</p>
            <p>If you notice an error with our catalogue descriptions please don&apos;t hesitate to contact us. In the unlikely event the catalogue description does not match the image provided, please contact us. If you notice during or after an auction, please note that we will always sell a lot based on the description rather than the image.</p>
            <p>
              If you have any queries please contact us on{" "}
              <a href="tel:+441642750616" className="text-[#32348A] font-semibold hover:underline">+44 (0) 1642 750616</a> or email{" "}
              <a href="mailto:admin@vectis.co.uk" className="text-[#32348A] font-semibold hover:underline">admin@vectis.co.uk</a>.
            </p>
          </Accordion>

          <Accordion kicker="Post auction" title="Shipping and postage">
            <p>UK postage starts from £14.95 for small items and £24.95+ for larger lots, with surcharges for additional items.</p>
            <p>International shipping varies by Parcel Force destination zone (zones 6–9 for Europe; quotes provided for the rest of the world).</p>
            <p>Average shipping time is 14 days, though peak periods may extend to 28 days.</p>
            <p>
              <Link href="/faq" className="text-[#32348A] font-semibold hover:underline">See the FAQs for the full post and packing details →</Link>
            </p>
          </Accordion>

          <Link
            href="/faq"
            className="self-start border-2 border-[#32348A] text-[#32348A] hover:bg-[#32348A] hover:text-white text-xs font-black uppercase tracking-widest px-6 py-3 transition-colors"
          >
            View FAQs
          </Link>
        </div>

        <aside className="lg:col-span-5">
          <div className="bg-white border border-gray-200 overflow-hidden">
            {sale.photo ? (
              <img src={sale.photo} alt="" className="w-full h-56 object-cover" />
            ) : (
              <div className="h-40 bg-gradient-to-br from-[#2AB4A6] to-[#32348A]" />
            )}
            <div className="bg-[#32348A] text-white p-6">
              <h3 className="text-2xl font-black mb-2">Got one to sell?</h3>
              <p className="text-sm text-gray-200 leading-relaxed mb-5">
                Contact our Collections Team, who will guide you through the process. We sell over 98% of all items consigned to our auctions.
              </p>
              <Link
                href="/sell-with-us"
                className="inline-flex items-center gap-2 bg-white text-[#32348A] text-xs font-black uppercase tracking-widest px-5 py-3 hover:bg-[#2AB4A6] hover:text-white transition-colors"
              >
                Get started <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </aside>
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

// A fold-out section, no JavaScript: a native <details> styled like the rest of the page.
function Accordion({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <details className="group bg-white border border-gray-200">
      <summary className="list-none cursor-pointer select-none px-6 py-4 flex items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#DB0606]">{kicker}</p>
          <h3 className="text-lg font-black text-[#32348A]">{title}</h3>
        </div>
        <svg className="w-5 h-5 shrink-0 text-[#32348A] transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-6 pb-6 text-sm text-gray-700 leading-relaxed space-y-3">{children}</div>
    </details>
  )
}

// A BC sale has a code and no old-system auction id; only there is the lot id (R008728-194) worth showing.
const isBcSale = (sale: ResultSale) => sale.auctionId == null

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-gray-500 font-semibold">{label}</dt>
      <dd className="text-gray-800 min-w-0 break-words">{children}</dd>
    </>
  )
}

function NeighbourLink({ n, dir, saleHref, wide }: { n: LotNeighbour | null; dir: "prev" | "next"; saleHref: string; wide?: boolean }) {
  const label = n ? (dir === "prev" ? `← Lot ${n.lot ?? ""}` : `Lot ${n.lot ?? ""} →`) : (dir === "prev" ? "← First lot" : "Last lot →")
  const cls = `${wide ? "flex-1 py-3" : "py-1.5"} text-center text-xs font-black uppercase tracking-widest px-4 border-2 transition-colors`
  if (!n) return <span className={`${cls} border-gray-200 text-gray-300 cursor-default`}>{label}</span>
  return (
    <Link href={`${saleHref}/lot/${encodeURIComponent(n.id)}`} className={`${cls} border-[#32348A] text-[#32348A] hover:bg-[#32348A] hover:text-white`}>
      {label}
    </Link>
  )
}
