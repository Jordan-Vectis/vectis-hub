import Link from "next/link"
import { format } from "date-fns"
import { listResultSales } from "./results/data"

// The "View Results" tab of the auction calendar: every sale that has happened, from the Hub's sale
// database (Databases → Sales), newest first, with the cover picture the website shows. Each one
// opens /auctions/results/[siteId] — its lots with photos, estimates and hammer prices.

const gbDate = (d: Date) => format(d, "EEEE d MMMM yyyy").toUpperCase()

export default async function ResultsList({ search, page }: { search?: string; page?: string }) {
  let data: Awaited<ReturnType<typeof listResultSales>>
  try {
    data = await listResultSales({ search, page: parseInt(page ?? "1", 10) || 1 })
  } catch (e) {
    // Say so plainly — a results tab that just reads "no past auctions" would hide a database that isn't there.
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 text-lg">Auction results aren&apos;t available here yet.</p>
        <p className="text-gray-300 text-xs mt-2">{String((e as { message?: string })?.message ?? "")}</p>
      </div>
    )
  }

  if (data.rows.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 text-lg">
          {search ? `No past auctions match “${search}”.` : "No past auctions found."}
        </p>
      </div>
    )
  }

  const pageHref = (p: number) => {
    const sp = new URLSearchParams({ tab: "past" })
    if (search) sp.set("search", search)
    if (p > 1) sp.set("page", String(p))
    return `/auctions?${sp.toString()}`
  }

  return (
    <>
      <p className="text-xs text-gray-400 mb-3">
        {data.total.toLocaleString("en-GB")} past auctions{search ? ` matching “${search}”` : ""} · page {data.page} of {data.pages}
      </p>

      <div className="flex flex-col gap-0 border border-gray-200">
        {data.rows.map(sale => {
          const href = `/auctions/results/${sale.siteId}`
          const aDate = sale.saleDate ? new Date(sale.saleDate) : null
          return (
            <div key={sale.siteId} className="flex border-b border-gray-200 bg-white hover:bg-gray-50 transition-colors">
              {/* Cover picture */}
              <Link href={href} className="relative shrink-0 bg-gray-100 overflow-hidden" style={{ width: "240px", minHeight: "160px" }}>
                {sale.photo ? (
                  <img src={sale.photo} alt={sale.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="absolute inset-0 bg-[#32348A]/5 flex items-center justify-center">
                    <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </Link>

              {/* Info */}
              <div className="flex-1 px-6 py-5 flex flex-col justify-between min-w-0">
                <div className="mb-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#2AB4A6]">AUCTION RESULTS</span>
                </div>
                <div className="mb-3">
                  <Link href={href}>
                    <h2 className="text-[#32348A] font-black text-xl leading-tight hover:underline mb-1">{sale.title}</h2>
                  </Link>
                  {aDate && (
                    <p className="text-gray-500 text-sm uppercase font-medium tracking-wide">{gbDate(aDate)}</p>
                  )}
                  <p className="text-gray-400 text-xs mt-1">
                    {sale.lots > 0 ? `${sale.lots.toLocaleString("en-GB")} lots` : "Lot count not held"}
                    {sale.code ? ` · Sale ${sale.code}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={href}
                    className="bg-[#32348A] hover:bg-[#28296e] text-white text-xs font-black uppercase tracking-widest px-4 py-2 transition-colors"
                  >
                    VIEW RESULTS
                  </Link>
                </div>
              </div>

              {/* Right date block */}
              {aDate && (
                <div className="shrink-0 w-28 border-l border-gray-200 flex flex-col items-center justify-center py-5 px-2 bg-gray-50">
                  <span className="text-[#32348A] font-black text-5xl leading-none">{format(aDate, "d")}</span>
                  <span className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-1">{format(aDate, "EEEE")}</span>
                  <span className="text-gray-400 text-[10px] uppercase tracking-wider mt-0.5">{format(aDate, "MMMM yyyy")}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {data.pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8 flex-wrap">
          {data.page > 1 && <PageLink href={pageHref(data.page - 1)} label="← Prev" />}
          {Array.from({ length: data.pages }, (_, i) => i + 1)
            .filter(p => Math.abs(p - data.page) <= 2 || p === 1 || p === data.pages)
            .map(p => <PageLink key={p} href={pageHref(p)} label={String(p)} active={p === data.page} />)}
          {data.page < data.pages && <PageLink href={pageHref(data.page + 1)} label="Next →" />}
        </div>
      )}
    </>
  )
}

function PageLink({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`min-w-[2.5rem] text-center px-3 py-2 text-sm font-semibold border transition-colors ${
        active ? "bg-[#32348A] text-white border-[#32348A]" : "bg-white text-[#32348A] border-gray-300 hover:border-[#32348A]"
      }`}
    >
      {label}
    </Link>
  )
}
