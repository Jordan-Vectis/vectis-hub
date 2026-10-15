"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { CustomerRow } from "@/lib/actions/goods-in"
import { DEFAULT_TERMS } from "@/lib/goods-in/model"
import CustomerForm from "../../_components/customer-form"
import { box, btn, mono, OkBox } from "../../_components/ui"

// A customer's details and usual terms, with Edit swapping the same cards for the shared Goods In
// customer form in place. Saving goes through saveCustomer (the CRM contact and its Goods In half
// together). There are no bank details here and never will be — the printed receipt's bank form
// is left blank for the customer to fill in by hand.

const money = (n: number) => `£${n.toFixed(2)}`
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)}%`

function Field({ name, children, wide }: { name: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400">{name}</dt>
      <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100 break-words">{children}</dd>
    </div>
  )
}

const none = <span className="text-gray-500 dark:text-gray-400">—</span>

export default function CustomerPanel({ customer }: { customer: CustomerRow }) {
  const router = useRouter()
  const [row, setRow] = useState<CustomerRow>(customer)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  if (editing) {
    return (
      <section className={`${box} p-4 sm:p-6`} aria-label="Edit customer">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Edit {row.name}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            This changes their record in the CRM too. Receipts already booked keep the details they were printed with.
          </p>
        </div>
        <div className="max-w-3xl">
          <CustomerForm
            initial={row}
            onCancel={() => setEditing(false)}
            onSaved={c => {
              const gotNumber = !row.vendorNo && c.vendorNo
              setRow(c)
              setEditing(false)
              setSaved(gotNumber ? `Saved. ${c.name} now has vendor number ${c.vendorNo}.` : `Saved ${c.name}'s details.`)
              router.refresh()
            }}
          />
        </div>
      </section>
    )
  }

  const address = [row.addressLine1, row.addressLine2, row.town, row.county, row.postcode, row.country].filter(Boolean) as string[]
  const terms: { name: string; value: number | null; std: number; show: (n: number) => string }[] = [
    { name: "Commission", value: row.commission, std: DEFAULT_TERMS.commission, show: pct },
    { name: "Lotting fee", value: row.lottingFee, std: DEFAULT_TERMS.lottingFee, show: money },
    { name: "Photography fee", value: row.photographyFee, std: DEFAULT_TERMS.photographyFee, show: money },
    { name: "Unsold fee", value: row.unsoldFee, std: DEFAULT_TERMS.unsoldFee, show: money },
  ]

  return (
    <div className="space-y-3">
      {saved && <OkBox>{saved}</OkBox>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className={`${box} p-4 sm:p-5 lg:col-span-2`} aria-labelledby="cust-details">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 id="cust-details" className="text-base font-semibold text-gray-900 dark:text-white">Details</h2>
            <button type="button" className={btn} onClick={() => { setSaved(null); setEditing(true) }}>Edit</button>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <Field name="Name">{[row.salutation, row.name].filter(Boolean).join(" ")}</Field>
            <Field name="Vendor number">{row.vendorNo ? <span className={`${mono} font-semibold`}>{row.vendorNo}</span> : <span className="text-gray-500 dark:text-gray-400">None yet</span>}</Field>
            <Field name="Address" wide>
              {address.length ? address.map((l, i) => <span key={i} className="block">{l}</span>) : none}
            </Field>
            <Field name="Email">{row.email ? <a href={`mailto:${row.email}`} className="text-indigo-700 dark:text-indigo-300 underline break-all">{row.email}</a> : none}</Field>
            <Field name="Mobile">{row.mobile ? <a href={`tel:${row.mobile.replace(/[^\d+]/g, "")}`} className="text-indigo-700 dark:text-indigo-300 underline">{row.mobile}</a> : none}</Field>
            <Field name="Telephone">{row.phone ? <a href={`tel:${row.phone.replace(/[^\d+]/g, "")}`} className="text-indigo-700 dark:text-indigo-300 underline">{row.phone}</a> : none}</Field>
            <Field name="VAT reg. no.">{row.vatRegNo ? <span className={mono}>{row.vatRegNo}</span> : none}</Field>
            {row.notes && <Field name="Notes" wide><span className="whitespace-pre-line">{row.notes}</span></Field>}
          </dl>
        </section>

        <section className={`${box} p-4 sm:p-5`} aria-labelledby="cust-terms">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
            <h2 id="cust-terms" className="text-base font-semibold text-gray-900 dark:text-white">Their usual terms</h2>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Put on each new receipt for them; the counter can still change them on the day.</p>
          <dl className="divide-y divide-gray-100 dark:divide-gray-800">
            {terms.map(t => (
              <div key={t.name} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-sm text-gray-600 dark:text-gray-300">{t.name}</dt>
                <dd className="text-sm text-right">
                  {t.value == null
                    ? <span className="text-gray-500 dark:text-gray-400">Standard <span className={mono}>({t.show(t.std)})</span></span>
                    : <span className={`${mono} font-semibold text-gray-900 dark:text-white`}>{t.show(t.value)}</span>}
                </dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-sm text-gray-600 dark:text-gray-300">Reserve</dt>
              <dd className="text-sm text-right text-gray-500 dark:text-gray-400">Set on each receipt <span className={mono}>(standard {DEFAULT_TERMS.reservePercent}%)</span></dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  )
}
