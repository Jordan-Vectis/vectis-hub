"use client"

import Link from "next/link"
import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import type { CustomerRow } from "@/lib/actions/goods-in"
import { BC_OWNS_MESSAGE } from "@/lib/customers/ownership"
import CustomerForm from "../../_components/customer-form"
import { box, btn, mono, OkBox } from "../../_components/ui"

// A customer's details, with Edit swapping the card for the shared Goods In customer form in
// place. Saving goes through saveCustomer (the customer record and its Goods In half together) — only
// once the Hub owns customers (switch day); until then there is no Edit and the card says where. Their
// fees and agreement are NOT here — they have their own tab on this page (Fees & agreement); the
// page passes a one-line summary of them in as `summary`, shown at the foot of the card. There are
// no bank details here and never will be — the printed receipt's bank form is left blank for the
// customer to fill in by hand.

function Field({ name, children, wide }: { name: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-4" : "min-w-0"}>
      <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400">{name}</dt>
      <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100 break-words">{children}</dd>
    </div>
  )
}

const none = <span className="text-gray-500 dark:text-gray-400">—</span>
const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`
const link = "text-indigo-700 dark:text-indigo-300 underline"

export default function CustomerPanel({ customer, summary, feesHref, canEdit = false }: {
  customer: CustomerRow
  summary?: ReactNode
  /** Their Fees & agreement tab — linked from the edit form's intro. */
  feesHref: string
  /** False until switch day: details are BC's, so there is no Edit (lib/customers/ownership.ts). */
  canEdit?: boolean
}) {
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
            This changes their customer record too. Receipts already booked keep the details they were printed with. Their fees are on the{" "}
            <Link href={feesHref} className="font-semibold text-indigo-700 dark:text-indigo-300 underline underline-offset-2">Fees &amp; agreement tab</Link>.
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

  return (
    <div className="space-y-3">
      {saved && <OkBox>{saved}</OkBox>}
      <section className={`${box} p-4 sm:p-5`} aria-labelledby="cust-details">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 id="cust-details" className="text-base font-semibold text-gray-900 dark:text-white">Details</h2>
          {canEdit
            ? <button type="button" className={btn} onClick={() => { setSaved(null); setEditing(true) }}>Edit</button>
            : <span className="text-xs text-gray-500 dark:text-gray-400 max-w-sm">{BC_OWNS_MESSAGE}</span>}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
          <Field name="Name">{[row.salutation, row.name].filter(Boolean).join(" ")}</Field>
          <Field name="Customer number">{row.customerNo ? <span className={`${mono} font-semibold`}>{row.customerNo}</span> : <span className="text-gray-500 dark:text-gray-400">Not in BC yet</span>}</Field>
          <Field name="Vendor number">{row.vendorNo ? <span className={`${mono} font-semibold`}>{row.vendorNo}</span> : <span className="text-gray-500 dark:text-gray-400">None yet</span>}</Field>
          <Field name="Email">{row.email ? <a href={`mailto:${row.email}`} className={`${link} break-all`}>{row.email}</a> : none}</Field>
          <Field name="Mobile">{row.mobile ? <a href={tel(row.mobile)} className={link}>{row.mobile}</a> : none}</Field>
          <Field name="Address">
            {address.length ? address.map((l, i) => <span key={i} className="block">{l}</span>) : none}
          </Field>
          <Field name="Telephone">{row.phone ? <a href={tel(row.phone)} className={link}>{row.phone}</a> : none}</Field>
          <Field name="VAT reg. no.">{row.vatRegNo ? <span className={mono}>{row.vatRegNo}</span> : none}</Field>
          {row.notes && <Field name="Notes" wide><span className="whitespace-pre-line">{row.notes}</span></Field>}
        </dl>
        {summary && <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-2">{summary}</div>}
      </section>
    </div>
  )
}
