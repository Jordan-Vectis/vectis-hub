"use client"

import { useState } from "react"
import { saveCustomer, type CustomerInput, type CustomerRow } from "@/lib/actions/goods-in"
import { btn, btnGo, ErrorBox, input, label } from "./ui"

// One customer form for Goods In — used to add a customer at the counter (Check in) and to edit
// one (Customers). Saves the CRM contact and its Goods In half together through saveCustomer.
// The vendor number is given automatically from the series when left blank and "give one" is
// ticked; an existing customer's number from before the Hub can be typed in.
//
// Their fees are NOT on this form (Jack, 2026-10-16): they live on the customer's own page, on
// its Fees & agreement tab, and are set there once. A new customer starts on the standard terms.
// The form never sends the fees at all — saveCustomer leaves a fee that isn't sent exactly as it is —
// so a copy of the customer read before their fees were changed can't put the old ones back.

export default function CustomerForm({ initial, onSaved, onCancel }: {
  initial?: CustomerRow | null
  onSaved: (c: CustomerRow) => void
  onCancel?: () => void
  /** No longer does anything — the form has no terms section any more. Kept so older callers still compile. */
  compact?: boolean
}) {
  const [f, setF] = useState<CustomerInput>(() => ({
    id: initial?.id ?? null,
    salutation: initial?.salutation ?? "", name: initial?.name ?? "", email: initial?.email ?? "", phone: initial?.phone ?? "",
    mobile: initial?.mobile ?? "", addressLine1: initial?.addressLine1 ?? "", addressLine2: initial?.addressLine2 ?? "",
    town: initial?.town ?? "", county: initial?.county ?? "", postcode: initial?.postcode ?? "", country: initial?.country ?? "Great Britain",
    vatRegNo: initial?.vatRegNo ?? "", notes: initial?.notes ?? "", vendorNo: initial?.vendorNo ?? "", newVendorNo: !initial?.vendorNo,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof CustomerInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await saveCustomer(f)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    onSaved(res.data)
  }

  const field = (k: keyof CustomerInput, text: string, opts: { type?: string; placeholder?: string; span?: boolean; autoComplete?: string } = {}) => (
    <div className={opts.span ? "sm:col-span-2" : ""}>
      <label className={label} htmlFor={`cf-${k}`}>{text}</label>
      <input id={`cf-${k}`} type={opts.type ?? "text"} className={input} value={(f[k] as string | null) ?? ""} onChange={set(k)} placeholder={opts.placeholder} autoComplete={opts.autoComplete} />
    </div>
  )

  return (
    <form onSubmit={save} className="space-y-5">
      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid grid-cols-[110px_1fr] gap-3 sm:col-span-2">
          <div>
            <label className={label} htmlFor="cf-salutation">Title</label>
            <select id="cf-salutation" className={input} value={f.salutation ?? ""} onChange={set("salutation")}>
              {["", "Mr", "Mrs", "Miss", "Ms", "Mx", "Dr"].map(s => <option key={s} value={s}>{s || "—"}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="cf-name">Full name *</label>
            <input id="cf-name" className={input} value={f.name} onChange={set("name")} required autoComplete="name" />
          </div>
        </div>
        {field("addressLine1", "Address", { span: true, autoComplete: "address-line1" })}
        {field("addressLine2", "Address line 2", { span: true, autoComplete: "address-line2" })}
        {field("town", "Town / city", { autoComplete: "address-level2" })}
        {field("county", "County", { autoComplete: "address-level1" })}
        {field("postcode", "Postcode", { autoComplete: "postal-code" })}
        {field("country", "Country", { autoComplete: "country-name" })}
        {field("email", "Email", { type: "email", autoComplete: "email" })}
        {field("mobile", "Mobile", { type: "tel", autoComplete: "tel" })}
        {field("phone", "Telephone", { type: "tel" })}
        {field("vatRegNo", "VAT reg. no. (if a business)")}
        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <div>
            <label className={label} htmlFor="cf-vendorNo">Vendor number</label>
            <input id="cf-vendorNo" className={`${input} font-mono`} value={f.vendorNo ?? ""} onChange={set("vendorNo")} placeholder={initial?.vendorNo ? "" : "Leave blank to give the next number"} />
          </div>
          {!initial?.vendorNo && !f.vendorNo && (
            <label className="flex items-center gap-2 min-h-11 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" className="w-5 h-5" checked={!!f.newVendorNo} onChange={e => setF(p => ({ ...p, newVendorNo: e.target.checked }))} />
              Give them the next vendor number
            </label>
          )}
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="cf-notes">Notes</label>
          <textarea id="cf-notes" rows={2} className={input} value={f.notes ?? ""} onChange={set("notes")} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnGo} disabled={saving || !f.name.trim()}>{saving ? "Saving…" : initial ? "Save changes" : "Add customer"}</button>
        {onCancel && <button type="button" className={btn} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}
