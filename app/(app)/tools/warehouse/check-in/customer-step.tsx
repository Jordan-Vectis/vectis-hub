"use client"

import type { CustomerRow } from "@/lib/actions/goods-in"
import CustomerForm from "../_components/customer-form"
import CustomerPicker from "../_components/customer-picker"
import { btn } from "../_components/ui"
import CustomerCard from "./customer-card"
import { fullName } from "./shared"

// Step 1 — who is booking in. Find them (or add them) with the shared picker; once picked, their
// card shows with Change and Edit details. Adding or editing a customer saves their RECORD straight
// away (it's the same customer database the rest of the Hub uses) — the receipt itself is still
// only made at Book in.

export type CustomerMode = "view" | "change" | "edit"

export default function CustomerStep({ customer, mode, setMode, onPick, vendorSeries }: {
  customer: CustomerRow | null
  mode: CustomerMode
  setMode: (m: CustomerMode) => void
  onPick: (c: CustomerRow) => void
  vendorSeries: boolean | null
}) {
  if (!customer || mode === "change") {
    return (
      <section aria-labelledby="gi-step-0-heading" className="space-y-4">
        <div>
          <h2 id="gi-step-0-heading" tabIndex={-1} className="text-lg font-bold text-gray-900 dark:text-white outline-none">Who is booking in?</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
            Search by name, postcode, email, phone or vendor number — or scan their vendor card. Not on the system yet? Press <b>New customer</b>.
          </p>
        </div>
        <CustomerPicker onPick={onPick} />
        {customer && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
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
          <h2 id="gi-step-0-heading" tabIndex={-1} className="text-lg font-bold text-gray-900 dark:text-white outline-none">Edit {fullName(customer)}&apos;s details</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
            Changes are saved to their customer record as soon as you press <b>Save changes</b>. Their usual terms are the starting point for the Terms step.
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
      <h2 id="gi-step-0-heading" tabIndex={-1} className="text-lg font-bold text-gray-900 dark:text-white outline-none">Customer</h2>
      <CustomerCard c={customer} vendorSeries={vendorSeries}>
        <button type="button" className={btn} onClick={() => setMode("change")}>Change customer</button>
        <button type="button" className={btn} onClick={() => setMode("edit")}>Edit details</button>
      </CustomerCard>
      <p className="text-sm text-gray-600 dark:text-gray-400">Right person? Press <b>Next</b> to list what they&apos;ve brought.</p>
    </section>
  )
}
