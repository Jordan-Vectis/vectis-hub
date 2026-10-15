"use client"

import Link from "next/link"
import { useActionState, useState } from "react"
import { registerCustomer } from "@/lib/actions/customer-auth"

// Registration, in the same card as the login page: the form on the left (two columns of fields
// from sm up), an "or" divider, and the way back to login on the right. The form posts to
// registerCustomer, which makes the Contact and the account, signs the customer in and sends
// them to /account; a problem comes back as state.error and is shown above the fields.

function Field({
  label, name, type = "text", required, autoComplete, placeholder, hint, className = "",
}: {
  label: string; name: string; type?: string
  required?: boolean; autoComplete?: string; placeholder?: string; hint?: string; className?: string
}) {
  const id = `reg-${name}`
  return (
    <div className={className}>
      <label htmlFor={id} className="vs-label">
        {label}{required && <span aria-hidden="true" className="text-[var(--vs-red)]"> *</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="vs-input"
      />
      {hint && <p id={`${id}-hint`} className="text-xs text-[var(--vs-muted)] mt-1.5">{hint}</p>}
    </div>
  )
}

export default function CustomerRegisterPage() {
  const [state, action, pending] = useActionState(registerCustomer, null)
  const [billingSame, setBillingSame] = useState(true)

  return (
    <div className="vs-band">
      <div className="vs-container vs-page">
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>

        <div className="vs-card max-w-[1140px] mx-auto grid lg:grid-cols-[1fr_auto_minmax(280px,360px)]">
          {/* ── The form ── */}
          <section className="p-6 sm:p-10" aria-labelledby="register-title">
            <h1 id="register-title" className="vs-h2 vs-h2-light mb-2">Register to buy or sell</h1>
            <p className="text-sm text-[var(--vs-muted)] mb-8">Fields marked * are required.</p>

            {state?.error && (
              <p role="alert" className="mb-6 px-4 py-3 border border-[var(--vs-red)] bg-white text-sm text-[var(--vs-red)]">
                {state.error}
              </p>
            )}

            <form action={action} className="space-y-10">
              <section aria-labelledby="reg-personal">
                <h2 id="reg-personal" className="vs-h4 mb-5">Your details</h2>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
                  <Field label="First name" name="firstName" required autoComplete="given-name" />
                  <Field label="Last name" name="lastName" required autoComplete="family-name" />
                  <Field label="Email address" name="email" type="email" required autoComplete="email" className="sm:col-span-2" />
                  <Field label="Phone number" name="phone" type="tel" autoComplete="tel" />
                  <Field label="Password" name="password" type="password" required autoComplete="new-password" hint="At least 8 characters" />
                </div>
              </section>

              <section aria-labelledby="reg-shipping">
                <h2 id="reg-shipping" className="vs-h4 mb-5">Shipping address</h2>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
                  <Field label="Address line 1" name="shippingLine1" autoComplete="shipping address-line1" className="sm:col-span-2" />
                  <Field label="Address line 2" name="shippingLine2" autoComplete="shipping address-line2" className="sm:col-span-2" />
                  <Field label="City / Town" name="shippingCity" autoComplete="shipping address-level2" />
                  <Field label="County" name="shippingCounty" autoComplete="shipping address-level1" />
                  <Field label="Postcode" name="shippingPostcode" autoComplete="shipping postal-code" className="sm:max-w-[240px]" />
                </div>

                <label className="flex items-center gap-3 min-h-[44px] mt-5 cursor-pointer">
                  <input
                    type="checkbox"
                    name="billingSameAsShipping"
                    checked={billingSame}
                    onChange={e => setBillingSame(e.target.checked)}
                    className="vs-check"
                  />
                  <span>Billing address same as shipping</span>
                </label>
              </section>

              {!billingSame && (
                <section aria-labelledby="reg-billing">
                  <h2 id="reg-billing" className="vs-h4 mb-5">Billing address</h2>
                  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
                    <Field label="Address line 1" name="billingLine1" autoComplete="billing address-line1" className="sm:col-span-2" />
                    <Field label="Address line 2" name="billingLine2" autoComplete="billing address-line2" className="sm:col-span-2" />
                    <Field label="City / Town" name="billingCity" autoComplete="billing address-level2" />
                    <Field label="County" name="billingCounty" autoComplete="billing address-level1" />
                    <Field label="Postcode" name="billingPostcode" autoComplete="billing postal-code" className="sm:max-w-[240px]" />
                  </div>
                </section>
              )}

              <button type="submit" disabled={pending} className="vs-btn vs-btn-lg w-full sm:w-auto">
                {pending ? "Creating account…" : "Create account"}
              </button>
            </form>
          </section>

          <OrDivider />

          {/* ── Already registered ── */}
          <section className="p-6 sm:p-10 flex flex-col" aria-labelledby="login-title">
            <h2 id="login-title" className="vs-h2 vs-h2-light mb-6">Already registered?</h2>
            <p className="mb-8">
              Log in to bid in our auctions, see your commission bids and follow the items you are selling with us.
            </p>
            <Link href="/portal/login" className="vs-btn vs-btn-outline self-start">Log in</Link>
          </section>
        </div>
      </div>
    </div>
  )
}

/** A hairline with "or" on it — across the card on phones, down the middle of it from lg. */
function OrDivider() {
  return (
    <div className="flex items-center gap-4 px-6 sm:px-10 lg:flex-col lg:px-0 lg:py-10" aria-hidden="true">
      <span className="flex-1 h-px bg-[var(--vs-line)] lg:h-auto lg:w-px" />
      <span className="vs-caps text-[var(--vs-muted)]">or</span>
      <span className="flex-1 h-px bg-[var(--vs-line)] lg:h-auto lg:w-px" />
    </div>
  )
}
