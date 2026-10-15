import Link from "next/link"
import { redirect } from "next/navigation"
import { getCustomerSession } from "@/lib/customer-auth"
import { prisma } from "@/lib/prisma"
import { dateShort } from "../../site-dates"

// The site layout's title template adds " | Vectis Auctions" itself.
export const metadata = { title: "My sales" }

type ChipTone = "navy" | "red" | "grey"

// A receipt's state as a chip: "open" is still being worked (red, like an active bid), "sold"
// navy, and the finished states a grey outline — the same three chips the bids page uses.
const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  open:      { label: "Open",      tone: "red" },
  sold:      { label: "Sold",      tone: "navy" },
  complete:  { label: "Complete",  tone: "grey" },
  cancelled: { label: "Cancelled", tone: "grey" },
}

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  if (tone === "grey") {
    return <span className="inline-block vs-caps !text-xs px-3 py-1 border border-[var(--vs-line)] bg-white text-[var(--vs-muted)] whitespace-nowrap">{children}</span>
  }
  return <span className={`vs-badge !text-xs !px-3 !py-1 whitespace-nowrap${tone === "red" ? " vs-badge-red" : ""}`}>{children}</span>
}

const gbp = (n: number) => `£${n.toLocaleString("en-GB")}`

export default async function MySalesPage() {
  const session = await getCustomerSession()
  if (!session) redirect("/portal/login")

  // Load receipts linked to the customer's contact
  const receipts = session.contactId
    ? await prisma.warehouseReceipt.findMany({
        where: { contactId: session.contactId },
        orderBy: { createdAt: "desc" },
        include: {
          containers: {
            include: { movements: { orderBy: { movedAt: "desc" }, take: 1 } },
          },
        },
      })
    : []

  // Load auction lots where the receipt field matches any of their receipt IDs
  const receiptIds = receipts.map(r => r.id)
  const auctionLots = receiptIds.length > 0
    ? await prisma.catalogueLot.findMany({
        where: { receipt: { in: receiptIds } },
        orderBy: { createdAt: "desc" },
        include: { auction: { select: { code: true, name: true, auctionDate: true, published: true } } },
      })
    : []

  // Group lots by receipt
  const lotsByReceipt: Record<string, typeof auctionLots> = {}
  for (const lot of auctionLots) {
    if (!lot.receipt) continue
    if (!lotsByReceipt[lot.receipt]) lotsByReceipt[lot.receipt] = []
    lotsByReceipt[lot.receipt].push(lot)
  }

  return (
    <div>
      <h1 className="vs-h2 vs-rule mb-3">My sales</h1>
      <p className="text-[var(--vs-muted)] mb-8">The items you have consigned with us for auction, receipt by receipt.</p>

      {receipts.length === 0 ? (
        <div className="vs-card-flat p-8 sm:p-10 text-center">
          <p className="vs-h4 mb-2">No consignments on your account yet</p>
          <p className="text-[var(--vs-muted)] max-w-md mx-auto mb-6">
            If you have recently sent items to us they may not be linked to your account yet — please{" "}
            <Link href="/contact" className="vs-text-link">contact us</Link>.
          </p>
          <Link href="/sell-with-us" className="vs-btn vs-btn-outline">Sell with us</Link>
        </div>
      ) : (
        <div className="space-y-6">
          {receipts.map(receipt => {
            const status = STATUS[receipt.status] ?? { label: receipt.status, tone: "grey" as const }
            const lots = lotsByReceipt[receipt.id] ?? []
            const titleId = `receipt-${receipt.id}`

            return (
              <section key={receipt.id} aria-labelledby={titleId} className="vs-card-flat">
                {/* Receipt header: the number, its state, and the figures. */}
                <div className="vs-band border-b border-[var(--vs-line)] px-5 sm:px-6 py-4 flex flex-wrap items-start gap-x-8 gap-y-3">
                  <div className="min-w-0 mr-auto">
                    <p className="vs-price-label">Receipt</p>
                    <h2 id={titleId} className="vs-h4 flex flex-wrap items-center gap-3">
                      {receipt.id}
                      <Chip tone={status.tone}>{status.label}</Chip>
                    </h2>
                  </div>
                  <dl className="flex flex-wrap gap-x-8 gap-y-2">
                    <div>
                      <dt className="vs-price-label">Received</dt>
                      <dd className="text-sm font-medium">{dateShort(receipt.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="vs-price-label">Commission</dt>
                      <dd className="text-sm font-medium">{receipt.commissionRate}%</dd>
                    </div>
                    <div>
                      <dt className="vs-price-label">Items</dt>
                      <dd className="text-sm font-medium">{receipt.containers.length}</dd>
                    </div>
                  </dl>
                </div>

                {/* What came in. */}
                {receipt.containers.length > 0 && (
                  <div className="px-5 sm:px-6 py-5">
                    <h3 className="vs-caps text-[var(--vs-muted)] mb-2">Items received</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left">
                            <th scope="col" className="vs-price-label font-medium py-2 pr-4">Item</th>
                            <th scope="col" className="vs-price-label font-medium py-2 pr-4">Type</th>
                            <th scope="col" className="vs-price-label font-medium py-2 text-right">Location</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receipt.containers.map(container => {
                            const lastLocation = container.movements[0]?.locationCode ?? null
                            return (
                              <tr key={container.id} className="border-t border-[var(--vs-line)]">
                                <td className="py-2.5 pr-4">
                                  <span className="font-medium">{container.description}</span>
                                  {container.category && <span className="text-[var(--vs-muted)] ml-2">{container.category}</span>}
                                </td>
                                <td className="py-2.5 pr-4 whitespace-nowrap text-[var(--vs-muted)] uppercase">{container.type}</td>
                                <td className="py-2.5 whitespace-nowrap text-right text-[var(--vs-muted)]">{lastLocation ?? "—"}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* The lots made from it. A lot links to its page only once the sale is published. */}
                {lots.length > 0 && (
                  <div className="px-5 sm:px-6 py-5 border-t border-[var(--vs-line)]">
                    <h3 className="vs-caps text-[var(--vs-muted)] mb-2">In auction</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead>
                          <tr className="text-left">
                            <th scope="col" className="vs-price-label font-medium py-2 pr-4">Lot</th>
                            <th scope="col" className="vs-price-label font-medium py-2 pr-4">Auction</th>
                            <th scope="col" className="vs-price-label font-medium py-2 text-right">Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lots.map(lot => {
                            const sold = lot.status === "SOLD"
                            const lotNo = lot.barcode ?? lot.receiptUniqueId ?? lot.id.slice(-6)
                            const href = lot.auction.published ? `/auctions/${lot.auction.code}/lot/${lot.id}` : null
                            return (
                              <tr key={lot.id} className="border-t border-[var(--vs-line)] align-top">
                                <td className="py-2.5 pr-4">
                                  <p className="vs-caps text-[var(--vs-navy)]">Lot {lotNo}</p>
                                  {href
                                    ? <Link href={href} className="font-medium hover:underline line-clamp-2">{lot.title}</Link>
                                    : <p className="font-medium line-clamp-2">{lot.title}</p>}
                                </td>
                                <td className="py-2.5 pr-4">
                                  <p className="font-medium">{lot.auction.name}</p>
                                  {lot.auction.auctionDate && <p className="text-[var(--vs-muted)]">{dateShort(lot.auction.auctionDate)}</p>}
                                </td>
                                <td className="py-2.5 text-right whitespace-nowrap">
                                  {sold && lot.hammerPrice ? (
                                    <>
                                      <p className="vs-price-label">Sold for</p>
                                      <p className="vs-price">{gbp(lot.hammerPrice)}</p>
                                    </>
                                  ) : lot.estimateLow ? (
                                    <>
                                      <p className="vs-price-label">Estimate</p>
                                      <p className="font-medium">{gbp(lot.estimateLow)}{lot.estimateHigh ? ` – ${gbp(lot.estimateHigh)}` : "+"}</p>
                                    </>
                                  ) : (
                                    <p className="text-[var(--vs-muted)]">—</p>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {receipt.notes && (
                  <div className="px-5 sm:px-6 py-4 border-t border-[var(--vs-line)]">
                    <p className="vs-price-label">Notes</p>
                    <p className="text-sm">{receipt.notes}</p>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
