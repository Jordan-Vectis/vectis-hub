import type { ReactNode } from "react"
import type { CustomerRow } from "@/lib/actions/goods-in"
import { box, label, mono } from "../_components/ui"
import { addressLines, fullName } from "./shared"

// The customer as the counter sees them once picked: who they are, where they live, how to reach
// them, their vendor number and how often they've booked in before. Server-safe (no hooks), so the
// customer step and Check & book in show the same card. Their fees aren't on it: check-in never asks
// about fees, and Check & book in shows the terms the receipt will use as one line beside it.
// The card lays itself out to its own width (it is half the screen on Check & book in).

export default function CustomerCard({ c, vendorSeries, children, heading }: {
  c: CustomerRow
  /** Whether the vendor-number series is set up (null = couldn't tell). Decides what "no vendor number" says. */
  vendorSeries: boolean | null
  /** Buttons shown along the bottom (Change, Edit details). */
  children?: ReactNode
  heading?: ReactNode
}) {
  const address = addressLines(c)
  const reach = [c.mobile && `Mobile ${c.mobile}`, c.phone && `Tel. ${c.phone}`].filter(Boolean) as string[]

  return (
    <div className={`${box} @container p-4 sm:p-5`}>
      {heading}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight text-gray-900 dark:text-white break-words">{fullName(c)}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {c.receipts === 0 ? "First time booking in with the Hub" : `${c.receipts} ${c.receipts === 1 ? "receipt" : "receipts"} so far`}
          </p>
        </div>
        <div className="@sm:text-right">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Vendor no.</p>
          {c.vendorNo
            ? <p className={`${mono} text-lg font-bold leading-tight text-indigo-700 dark:text-indigo-300`}>{c.vendorNo}</p>
            : <p className="text-sm text-gray-700 dark:text-gray-300">
                None yet{vendorSeries ? " — one is given when you book in" : vendorSeries === false ? " — the receipt will carry none" : ""}
              </p>}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-gray-100 dark:border-gray-800 pt-4 text-sm @lg:grid-cols-2 @3xl:grid-cols-3">
        <div className="min-w-0">
          <dt className={label}>Address</dt>
          <dd className="text-gray-800 dark:text-gray-200">
            {address.length ? address.map((l, i) => <span key={i} className="block break-words">{l}</span>) : <span className="text-gray-500 dark:text-gray-400">None on their record</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={label}>Email</dt>
          <dd className="text-gray-800 dark:text-gray-200 break-all">
            {c.email ?? <span className="break-normal text-gray-500 dark:text-gray-400">None — the receipt can be printed, or emailed to an address you type in</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={label}>Mobile / telephone</dt>
          <dd className="text-gray-800 dark:text-gray-200">
            {reach.length ? reach.map(l => <span key={l} className="block">{l}</span>) : <span className="text-gray-500 dark:text-gray-400">None on their record</span>}
          </dd>
        </div>
      </dl>

      {c.notes && (
        <p className="mt-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 whitespace-pre-line break-words">
          <span className="font-semibold">Note on their record:</span> {c.notes}
        </p>
      )}

      {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}
