import Link from "next/link"
import { mono, ukDateTime } from "../../_components/ui"
import type { LotView } from "./types"

// The lots made from a tote (or otherwise tied to this receipt): barcode, title, sale and shelf.
// Server-safe (no hooks) — used inside the totes table and on its own for lots with no tote.
// The barcode opens Goods In → Find; the sale opens the cataloguing tool, but only for sales the
// viewer's departments cover (RULES: departments gate which sales a cataloguer sees).
// Laid out by the width of the BOX it sits in (a container query), not the screen — it appears both
// inside a narrow tote card and full width.

export default function LotList({ lots }: { lots: LotView[] }) {
  if (lots.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">No lots made yet.</p>
  return (
    <div className="@container">
      <ul className="divide-y divide-gray-200 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40">
        {lots.map(l => (
          <li key={l.id} className="px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 @2xl:grid-cols-[8rem_minmax(0,1fr)_7rem_9rem] @2xl:items-center">
            <div className="order-1 @2xl:order-none">
              {l.barcode
                ? <Link href={`/tools/warehouse/find?q=${encodeURIComponent(l.barcode)}`} className={`${mono} text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:underline inline-flex items-center min-h-8`}>{l.barcode}</Link>
                : <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center min-h-8">No barcode yet</span>}
            </div>
            <p className="order-3 col-span-2 @2xl:order-none @2xl:col-span-1 text-sm text-gray-800 dark:text-gray-100 line-clamp-2" title={l.title}>
              {l.title || <span className="italic text-gray-500 dark:text-gray-400">Untitled</span>}
            </p>
            <div className="order-2 text-right @2xl:order-none @2xl:text-left text-sm">
              <span className="@2xl:hidden text-xs text-gray-500 dark:text-gray-400">Sale </span>
              {l.auctionCode && l.canOpenSale
                ? <Link href={`/tools/cataloguing/auctions/${encodeURIComponent(l.auctionId)}`} title={l.auctionName ?? undefined} className={`${mono} font-semibold text-indigo-700 dark:text-indigo-300 hover:underline inline-flex items-center min-h-8`}>{l.auctionCode}</Link>
                : <span className={`${mono} text-gray-700 dark:text-gray-200 inline-flex items-center min-h-8`} title={l.auctionName ?? undefined}>{l.auctionCode ?? "—"}</span>}
            </div>
            <div className="order-4 col-span-2 @2xl:order-none @2xl:col-span-1 text-sm">
              <span className="@2xl:hidden text-xs text-gray-500 dark:text-gray-400">Shelf </span>
              {l.shelf
                ? <span className={`${mono} font-semibold text-gray-900 dark:text-white`} title={l.shelvedAt ? `Shelved ${ukDateTime(l.shelvedAt)}` : undefined}>{l.shelf}</span>
                : <span className="text-gray-500 dark:text-gray-400">Not shelved</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
