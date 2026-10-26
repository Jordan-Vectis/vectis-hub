import type { Metadata } from "next"
import RefundForm from "./refund-form"
import { londonDay } from "@/lib/uncollected"
import "./refund.css"

// PUBLIC — no login. The refund and returns form customers reach from vectis.co.uk: the Hub's own
// replacement for the Microsoft Form (Jack, 2026-10-26: "the form link will need to come out of the
// hub instead of using the Microsoft form"). Requests land in Accounts → Refunds, admins only.
//
// Deliberately a TOP-LEVEL route, not inside app/(app): that group's layout renders the Hub shell and
// reads the session, so putting this page there would drag the nav (and a logged-out session lookup)
// onto a page anyone can open. "/refund" is in publicExact in auth.config.ts — the exact path only.
//
// ⚠ Rules for anything added to this page (the same as /first-aid):
//   1. No links into the Hub, and no session — this page must never be a way in.
//   2. Nothing is read back: the page shows no record, and has no public GET endpoint.
//   3. The only write is the request itself, which posts to /api/public/refund-request.
// Rendered per request only so the date box can't be set to a day after today (London).
//
// ?sent=1 and ?problem=<word> are the route's answer to a browser that sent the form WITHOUT its
// script (an old iPad, a page that didn't finish loading): a thank-you, or what went wrong. Fixed
// words only — nothing the customer typed ever comes back in the address.
export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** What went wrong with a request sent without the page's script (problemFor in the route). */
const PROBLEMS: Record<string, string> = {
  check: "That didn't go through — something in the form wasn't filled in as it needs to be. Please fill it in again and send it.",
  big: "That was too much to send in one go — please send it again with fewer photos.",
  busy: "A lot of requests are coming in just now — please try again later.",
  ready: "The refund form isn't ready yet — please try again later.",
  failed: "Something went wrong sending that — please try again in a minute.",
}

export const metadata: Metadata = {
  title: "Request a refund or return — Vectis",
  description: "Tell Vectis Auctions about a lot that arrived damaged, is missing parts, wasn't as described or didn't arrive.",
  // Customers come here from a link on vectis.co.uk — the Hub's address needn't be in search results.
  robots: { index: false, follow: false },
}

const NAVY = "bg-[#2e328e]"

export default async function RefundPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""
  const sent = one(sp.sent) === "1"
  const problemKey = one(sp.problem)
  const problem = Object.prototype.hasOwnProperty.call(PROBLEMS, problemKey) ? PROBLEMS[problemKey] : null
  return (
    <div className="vectis-refund min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-5 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vectis-logo.svg" alt="Vectis Auctions" className="h-10 w-auto" />
        </div>
      </header>
      <div className={`${NAVY} text-white`}>
        <div className="max-w-2xl mx-auto px-5 py-6">
          <h1 className="text-2xl font-bold">Request a refund or return</h1>
          <p className="text-[15px] text-indigo-100 mt-1">
            For a lot you bought from us that arrived damaged, has parts missing, wasn&apos;t as described or
            never arrived.
          </p>
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-6">
        {sent ? (
          <section className="rounded-2xl border-2 border-[#2e328e]/30 bg-white p-6 text-center" role="status">
            <p className="text-3xl text-[#2e328e]" aria-hidden>✓</p>
            <h2 className="text-xl font-bold mt-1">Thank you — we&apos;ve got your request.</h2>
            <p className="text-[15px] text-gray-700 mt-2">
              We&apos;ll reply by email to the address you gave, with a reference to quote if you contact us about it.
            </p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="text-lg font-bold">Before you start</h2>
              <p className="text-[15px] text-gray-700 mt-1">It only takes a couple of minutes. Have these to hand:</p>
              <ul className="mt-3 space-y-2 text-[15px] leading-relaxed">
                <Ready>The <b>email address you bought with</b> — it&apos;s how we find your purchase.</Ready>
                <Ready>The <b>lot number</b> (or numbers) and the <b>date of the auction</b> — they&apos;re on your invoice.</Ready>
                <Ready>If something is damaged or missing, <b>photos</b> help us sort it out much faster.</Ready>
              </ul>
              <p className="text-[15px] text-gray-700 mt-3">
                We&apos;ll reply by email, with a reference for your request.
              </p>
            </section>

            {problem && (
              <p role="alert" className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-[15px] p-3">{problem}</p>
            )}

            <RefundForm today={londonDay()} />
          </>
        )}
      </main>

      <p className="text-center text-xs text-gray-500 px-5 pb-10">
        Vectis Auctions · this form is for refund and return requests only
      </p>
    </div>
  )
}

function Ready({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${NAVY}`} />
      <span className="min-w-0">{children}</span>
    </li>
  )
}
