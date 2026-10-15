"use client"

import Link from "next/link"
import { useActionState } from "react"
import { loginCustomer } from "@/lib/actions/customer-auth"

// The login page as vectis.co.uk lays it out: one white card on the light band — the login form
// on the left, an "or" divider, and the invitation to register on the right. The form posts to
// loginCustomer, which sets the session cookie and sends the customer on to /account; a wrong
// password comes back as state.error and is shown above the fields.

export default function CustomerLoginPage() {
  const [state, action, pending] = useActionState(loginCustomer, null)

  return (
    <div className="vs-band">
      <div className="vs-container vs-page">
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>

        <div className="vs-card max-w-[1040px] mx-auto grid lg:grid-cols-[1fr_auto_1fr]">
          {/* ── Log in ── */}
          <section className="p-6 sm:p-10" aria-labelledby="login-title">
            <h1 id="login-title" className="vs-h2 vs-h2-light mb-6">Log in to your account</h1>

            {state?.error && (
              <p role="alert" className="mb-5 px-4 py-3 border border-[var(--vs-red)] bg-white text-sm text-[var(--vs-red)]">
                {state.error}
              </p>
            )}

            <form action={action} className="space-y-5">
              <div>
                <label htmlFor="login-email" className="vs-label">Email address</label>
                <input id="login-email" name="email" type="email" required autoComplete="email" className="vs-input" />
              </div>
              <div>
                <label htmlFor="login-password" className="vs-label">Password</label>
                <input id="login-password" name="password" type="password" required autoComplete="current-password" className="vs-input" />
              </div>
              <button type="submit" disabled={pending} className="vs-btn vs-btn-block">
                {pending ? "Logging in…" : "Login"}
              </button>
            </form>
          </section>

          <OrDivider />

          {/* ── Register ── */}
          <section className="p-6 sm:p-10 flex flex-col" aria-labelledby="register-title">
            <h2 id="register-title" className="vs-h2 vs-h2-light mb-6">Register to buy or sell</h2>
            <div className="vs-prose mb-8">
              <p>
                Create a free account to bid in our auctions, follow your bids and keep track of the items you have
                consigned with us.
              </p>
              <ul>
                <li>Bid online in every sale</li>
                <li>See your commission bids and results in one place</li>
                <li>Follow the items you are selling with us</li>
              </ul>
            </div>
            <Link href="/portal/register" className="vs-btn vs-btn-outline self-start mt-auto">Create account</Link>
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
