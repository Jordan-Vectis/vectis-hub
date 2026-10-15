import type { ReactNode } from "react"
import type { CustomerRow } from "@/lib/actions/goods-in"
import { box, label, mono } from "../_components/ui"
import { TERM_FIELDS, addressLines, customerTerm, fullName, termText } from "./shared"

// The customer as the counter sees them once picked: who they are, where they live, how to reach
// them, their vendor number and how often they've booked in before. Server-safe (no hooks), so the
// check step and the success panel can show the same card.

export default function CustomerCard({ c, vendorSeries, children, heading }: {
  c: CustomerRow
  /** Whether the vendor-number series is set up (null = couldn't tell). Decides what "no vendor number" says. */
  vendorSeries: boolean | null
  /** Buttons shown along the bottom (Change, Edit details). */
  children?: ReactNode
  heading?: ReactNode
}) {
  const address = addressLines(c)
  const own = TERM_FIELDS.filter(f => customerTerm(c, f.key) != null)
  const reach = [c.mobile && `Mobile ${c.mobile}`, c.phone && `Tel. ${c.phone}`].filter(Boolean) as string[]

  return (
    <div className={`${box} p-4 sm:p-5`}>
      {heading}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-xl font-bold text-gray-900 dark:text-white break-words">{fullName(c)}</p>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {c.receipts === 0 ? "First time booking in with the Hub" : `${c.receipts} ${c.receipts === 1 ? "receipt" : "receipts"} so far`}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Vendor no.</p>
          {c.vendorNo
            ? <p className={`${mono} text-lg font-bold text-indigo-700 dark:text-indigo-300`}>{c.vendorNo}</p>
            : <p className="text-sm text-gray-700 dark:text-gray-300">
                None yet{vendorSeries ? " — one is given when you book in" : vendorSeries === false ? " — the receipt will carry none" : ""}
              </p>}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 @2xl:grid-cols-3 text-sm">
        <div className="min-w-0">
          <dt className={label}>Address</dt>
          <dd className="text-gray-800 dark:text-gray-200">
            {address.length ? address.map((l, i) => <span key={i} className="block break-words">{l}</span>) : <span className="text-gray-500 dark:text-gray-400">None on their record</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={label}>Email</dt>
          <dd className="text-gray-800 dark:text-gray-200 break-all">
            {c.email ?? <span className="text-gray-500 dark:text-gray-400">None — the receipt can be printed, or emailed to an address you type in</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={label}>Mobile / telephone</dt>
          <dd className="text-gray-800 dark:text-gray-200">
            {reach.length ? reach.map(l => <span key={l} className="block">{l}</span>) : <span className="text-gray-500 dark:text-gray-400">None on their record</span>}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
        <span className="font-semibold">Usual terms:</span>{" "}
        {own.length
          ? own.map(f => `${f.label.toLowerCase()} ${termText(f.key, customerTerm(c, f.key)!)}`).join(" · ") + (own.length < 4 ? " (the rest standard)" : "")
          : "the standard terms"}
      </p>

      {c.notes && (
        <p className="mt-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 whitespace-pre-line">
          <span className="font-semibold">Note on their record:</span> {c.notes}
        </p>
      )}

      {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}
