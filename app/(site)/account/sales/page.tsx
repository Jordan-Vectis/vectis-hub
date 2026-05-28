import { getCustomerSession } from "@/lib/customer-auth"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { redirect } from "next/navigation"

export const metadata = { title: "My Sales — Vectis" }

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  open:      { label: "Open",      colour: "bg-blue-100 text-blue-700" },
  sold:      { label: "Sold",      colour: "bg-green-100 text-green-700" },
  complete:  { label: "Complete",  colour: "bg-gray-100 text-gray-600" },
  cancelled: { label: "Cancelled", colour: "bg-red-100 text-red-700" },
}

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
      <h1 className="text-2xl font-bold text-gray-900 mb-2">My Sales</h1>
      <p className="text-sm text-gray-500 mb-8">
        Items you have consigned with us for auction.
      </p>

      {receipts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
          <p className="text-gray-500 font-medium">No consignment records found.</p>
          <p className="text-sm text-gray-400 mt-2">
            If you have recently sent items to us, they may not yet be linked to your account. Please contact us.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {receipts.map(receipt => {
            const status = STATUS_LABELS[receipt.status] ?? { label: receipt.status, colour: "bg-gray-100 text-gray-600" }
            const lots = lotsByReceipt[receipt.id] ?? []

            return (
              <div key={receipt.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* Receipt header */}
                <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Receipt</p>
                    <p className="font-mono font-semibold text-gray-900 text-sm">{receipt.id}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.colour}`}>
                      {status.label}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Received</p>
                    <p className="text-sm font-medium text-gray-700">
                      {format(new Date(receipt.createdAt), "d MMM yyyy")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Commission</p>
                    <p className="text-sm font-medium text-gray-700">{receipt.commissionRate}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Items</p>
                    <p className="text-sm font-medium text-gray-700">{receipt.containers.length}</p>
                  </div>
                </div>

                {/* Containers */}
                {receipt.containers.length > 0 && (
                  <div className="px-6 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Items received</p>
                    <div className="space-y-2">
                      {receipt.containers.map(container => {
                        const lastLocation = container.movements[0]?.locationCode ?? null
                        return (
                          <div key={container.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                            <div>
                              <span className="font-medium text-gray-800">{container.description}</span>
                              {container.category && (
                                <span className="text-gray-400 ml-2 text-xs">{container.category}</span>
                              )}
                            </div>
                            <div className="text-right text-xs text-gray-400">
                              <span className="uppercase text-gray-500">{container.type}</span>
                              {lastLocation && (
                                <span className="ml-2 text-[#2AB4A6]">@ {lastLocation}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Auction lots */}
                {lots.length > 0 && (
                  <div className="px-6 pb-5 border-t border-gray-100 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">In auction</p>
                    <div className="space-y-2">
                      {lots.map(lot => {
                        const sold = lot.status === "SOLD"
                        return (
                          <div key={lot.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-xs text-[#2AB4A6] font-bold">Lot {lot.barcode ?? lot.receiptUniqueId ?? lot.id.slice(-6)}</span>
                              <span className="text-gray-800 font-medium truncate max-w-xs">{lot.title}</span>
                            </div>
                            <div className="flex items-center gap-4 text-right shrink-0">
                              <div>
                                <p className="text-xs text-gray-400">Auction</p>
                                <p className="font-medium text-gray-700 text-xs">{lot.auction.name}</p>
                                {lot.auction.auctionDate && (
                                  <p className="text-xs text-gray-400">
                                    {format(new Date(lot.auction.auctionDate), "d MMM yyyy")}
                                  </p>
                                )}
                              </div>
                              <div>
                                {sold && lot.hammerPrice ? (
                                  <div>
                                    <p className="text-xs text-gray-400">Sold for</p>
                                    <p className="font-bold text-green-700">
                                      £{lot.hammerPrice.toLocaleString("en-GB")}
                                    </p>
                                  </div>
                                ) : lot.estimateLow ? (
                                  <div>
                                    <p className="text-xs text-gray-400">Estimate</p>
                                    <p className="font-medium text-gray-700">
                                      £{lot.estimateLow.toLocaleString("en-GB")}
                                      {lot.estimateHigh ? `–£${lot.estimateHigh.toLocaleString("en-GB")}` : "+"}
                                    </p>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {receipt.notes && (
                  <div className="px-6 pb-4 border-t border-gray-100 pt-3">
                    <p className="text-xs text-gray-400 mb-1">Notes</p>
                    <p className="text-sm text-gray-600">{receipt.notes}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
