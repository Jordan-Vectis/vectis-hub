"use client"

import type { CustomerRow } from "@/lib/actions/goods-in"
import CustomerForm from "../_components/customer-form"
import CustomerPicker from "../_components/customer-picker"
import { btn, mono } from "../_components/ui"
import CustomerCard from "./customer-card"
import { NOTE, fullName, linkBtn, type UnfinishedCheckIn } from "./shared"

// Step 1 — who is booking in. Find them (or add them) with the shared picker; once picked, their
// card shows with Change and Edit details. Adding or editing a customer saves their RECORD straight
// away (it's the same customer database the rest of the Hub uses). The receipt is saved — not
// booked in — from the goods step on; changing the customer here changes whose receipt it is.

export type CustomerMode = "view" | "change" | "edit"

const heading = "text-lg font-bold text-gray-900 dark:text-white outline-none"
const intro = "mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-3xl"

export default function CustomerStep({ customer, mode, setMode, onPick, vendorSeries, onAnother, existing = null, onCarryOnExisting, opening = false }: {
  customer: CustomerRow | null
  mode: CustomerMode
  setMode: (m: CustomerMode) => void
  onPick: (c: CustomerRow) => void
  vendorSeries: boolean | null
  /** Set while this check-in is saved but not booked in: start someone else's (this one is kept or thrown away first). */
  onAnother?: () => void
  /** A check-in for this customer that isn't booked in yet (not the one on screen) — offered once, so a second receipt isn't started by accident. */
  existing?: UnfinishedCheckIn | null
  onCarryOnExisting?: () => void
  /** That check-in is being opened. */
  opening?: boolean
}) {
  if (!customer || mode === "change") {
    return (
      <section aria-labelledby="gi-step-0-heading" className="space-y-4">
        <div>
          <h2 id="gi-step-0-heading" tabIndex={-1} className={heading}>Who is booking in?</h2>
          <p className={intro}>
            Search by name, postcode, email, phone or vendor number — or scan their vendor card. Not on the system yet? Press <b>New customer</b>.
          </p>
        </div>
        <CustomerPicker onPick={onPick} />
        {customer && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
            <span>Changing from <b className="text-gray-900 dark:text-white">{fullName(customer)}</b>.</span>
            <button type="button" className={btn} onClick={() => setMode("view")}>Keep {fullName(customer)}</button>
          </div>
        )}
      </section>
    )
  }

  if (mode === "edit") {
    return (
      <section aria-labelledby="gi-step-0-heading" className="space-y-4">
        <div>
          <h2 id="gi-step-0-heading" tabIndex={-1} className={heading}>Edit {fullName(customer)}&apos;s details</h2>
          <p className={intro}>
            Changes are saved to their customer record as soon as you press <b>Save changes</b>.
          </p>
        </div>
        <div className="max-w-4xl">
          <CustomerForm initial={customer} onSaved={onPick} onCancel={() => setMode("view")} />
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="gi-step-0-heading" className="space-y-4">
      <h2 id="gi-step-0-heading" tabIndex={-1} className={heading}>Who is booking in?</h2>
      <CustomerCard c={customer} vendorSeries={vendorSeries}>
        <button type="button" className={btn} onClick={() => setMode("change")}>Change customer</button>
        <button type="button" className={btn} onClick={() => setMode("edit")}>Edit details</button>
      </CustomerCard>
      {existing && onCarryOnExisting && (
        <div className={`${NOTE.warn} flex flex-wrap items-center gap-x-3 gap-y-2`}>
          <span className="min-w-0 flex-1 basis-64">
            {fullName(customer)} already has a check-in not booked in yet (<span className={`${mono} font-semibold`}>{existing.receiptId}</span>
            {existing.mine ? ", started by you" : existing.createdByName ? `, started by ${existing.createdByName}` : ""}).
          </span>
          <button type="button" className={btn} disabled={opening} onClick={onCarryOnExisting} aria-busy={opening}>
            {opening ? "Opening it…" : "Carry on with it"}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
        <p className="py-2.5">Right person? Press <b className="text-gray-900 dark:text-white">Next</b> to list what they&apos;ve brought.</p>
        {onAnother && (
          <p>
            Someone else waiting?{" "}
            <button type="button" className={linkBtn} onClick={onAnother}>Book in another customer</button>
          </p>
        )}
      </div>
    </section>
  )
}
