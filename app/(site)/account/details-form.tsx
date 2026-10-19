"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useActionState, useState } from "react"
import { logoutCustomer, updateCustomerDetails } from "@/lib/actions/customer-auth"
import type { CustomerSession } from "@/lib/customer-auth"

// The account area's side menu and the "My details" form, in the site's house style: vs-label /
// vs-input fields inside white vs-card-flat panels, as vectis.co.uk's account pages. The menu
// lives here rather than in the server layout because the current link is read from the
// browser's path; the layout only hands it the customer's name.

const MENU = [
  { href: "/account", label: "My details" },
  { href: "/account/sales", label: "My sales" },
  { href: "/account/bids", label: "My bids" },
]

/** The customer's name, the account pages as plain caps links (the current one navy), and Log out. */
export function AccountMenu({ name }: { name: string }) {
  const pathname = usePathname()
  const isCurrent = (href: string) => (href === "/account" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`))

  return (
    <aside aria-label="My account" className="lg:sticky lg:top-8 lg:self-start">
      <p className="vs-kicker vs-kicker-navy mb-1">My account</p>
      <p className="vs-h4 mb-4 break-words">{name}</p>
      <nav>
        <ul className="flex flex-wrap gap-x-6 lg:flex-col lg:gap-0 lg:border-t lg:border-[var(--vs-line)]">
          {MENU.map(item => {
            const active = isCurrent(item.href)
            return (
              <li key={item.href} className="lg:border-b lg:border-[var(--vs-line)]">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`vs-caps inline-flex items-center min-h-[44px] lg:flex lg:py-1 ${active ? "text-[var(--vs-navy)]" : "text-black hover:text-[var(--vs-navy)]"}`}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <form action={logoutCustomer} className="mt-6">
        <button type="submit" className="vs-btn vs-btn-outline min-h-[44px]">Log out</button>
      </form>
    </aside>
  )
}

function Field({
  label, name, type = "text", defaultValue, autoComplete, placeholder, className = "",
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string | null
  autoComplete?: string
  placeholder?: string
  className?: string
}) {
  const id = `acc-${name}`
  return (
    <div className={className}>
      <label htmlFor={id} className="vs-label">{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="vs-input"
      />
    </div>
  )
}

function AddressFields({
  prefix, defaults,
}: {
  prefix: "shipping" | "billing"
  defaults: {
    line1?: string | null
    line2?: string | null
    city?: string | null
    county?: string | null
    postcode?: string | null
  }
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
      <Field label="Address line 1" name={`${prefix}Line1`} defaultValue={defaults.line1} autoComplete={`${prefix} address-line1`} className="sm:col-span-2" />
      <Field label="Address line 2" name={`${prefix}Line2`} defaultValue={defaults.line2} autoComplete={`${prefix} address-line2`} placeholder="Optional" className="sm:col-span-2" />
      <Field label="City / Town" name={`${prefix}City`} defaultValue={defaults.city} autoComplete={`${prefix} address-level2`} />
      <Field label="County" name={`${prefix}County`} defaultValue={defaults.county} autoComplete={`${prefix} address-level1`} placeholder="Optional" />
      <Field label="Postcode" name={`${prefix}Postcode`} defaultValue={defaults.postcode} autoComplete={`${prefix} postal-code`} className="sm:max-w-[240px]" />
    </div>
  )
}

/** One white panel of the form, titled. */
function Panel({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="vs-card-flat p-5 sm:p-8">
      <h2 id={id} className="vs-h4 mb-5">{title}</h2>
      {children}
    </section>
  )
}

export default function DetailsForm({ account }: { account: CustomerSession }) {
  const [state, action, pending] = useActionState(updateCustomerDetails, null)
  const [billingSame, setBillingSame] = useState(account.billingSameAsShipping)
  const error = state && "error" in state ? state.error : null
  const success = state && "success" in state ? state.success : null

  return (
    <form action={action} className="space-y-6">
      {error && (
        <p role="alert" className="px-4 py-3 border border-[var(--vs-red)] bg-white text-sm text-[var(--vs-red)]">{error}</p>
      )}
      {success && (
        <p role="status" className="px-4 py-3 border border-[var(--vs-navy)] bg-white text-sm text-[var(--vs-navy)]">{success}</p>
      )}

      <Panel id="acc-personal" title="Personal details">
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
          <Field label="First name" name="firstName" defaultValue={account.firstName} autoComplete="given-name" />
          <Field label="Last name" name="lastName" defaultValue={account.lastName} autoComplete="family-name" />
          <Field label="Phone number" name="phone" type="tel" defaultValue={account.phone} autoComplete="tel" placeholder="Optional" />
          <div>
            <label htmlFor="acc-email" className="vs-label">Email address</label>
            <input id="acc-email" type="email" value={account.email} disabled readOnly aria-describedby="acc-email-hint" className="vs-input" />
            <p id="acc-email-hint" className="text-sm text-[var(--vs-muted)] mt-1.5">
              Your email address cannot be changed here — please <Link href="/contact" className="vs-text-link">contact us</Link> if it needs updating.
            </p>
          </div>
        </div>
      </Panel>

      <Panel id="acc-shipping" title="Shipping address">
        <AddressFields prefix="shipping" defaults={{
          line1: account.shippingLine1,
          line2: account.shippingLine2,
          city: account.shippingCity,
          county: account.shippingCounty,
          postcode: account.shippingPostcode,
        }} />
        <label className="flex items-center gap-3 min-h-[44px] mt-5 pt-4 border-t border-[var(--vs-line)] cursor-pointer">
          <input
            type="checkbox"
            name="billingSameAsShipping"
            checked={billingSame}
            onChange={e => setBillingSame(e.target.checked)}
            className="vs-check"
          />
          <span>Billing address same as shipping</span>
        </label>
      </Panel>

      {!billingSame && (
        <Panel id="acc-billing" title="Billing address">
          <AddressFields prefix="billing" defaults={{
            line1: account.billingLine1,
            line2: account.billingLine2,
            city: account.billingCity,
            county: account.billingCounty,
            postcode: account.billingPostcode,
          }} />
        </Panel>
      )}

      <Panel id="acc-password" title="Change password">
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
          <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" />
          <Field label="New password" name="newPassword" type="password" autoComplete="new-password" />
        </div>
        <p className="text-sm text-[var(--vs-muted)] mt-3">
          Leave both blank to keep your current password. A new password needs at least 8 characters.
        </p>
      </Panel>

      <button type="submit" disabled={pending} className="vs-btn vs-btn-lg w-full sm:w-auto">
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  )
}
