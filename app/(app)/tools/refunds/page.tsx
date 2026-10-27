import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getAccountsAccess } from "@/lib/accounts-auth"
import { listRefunds } from "@/lib/actions/refunds"
import { REFUND_FORM_PATH, parseRefundFilter } from "@/lib/refunds"
import FormLink from "./form-link"
import ImportBox from "./import-box"
import MatchSales from "./match-sales"
import RefundsPanel from "./panel-client"
import { BackLink, ErrorNote, NeedsMigrations, card } from "./ui"

// Admin & Operations → 💷 Refunds: every refund, part-refund and return request — from the Hub's own
// public refund form (/refund, replacing the Microsoft Form), added by staff, or imported once from the
// old SharePoint refund log — worked from New to Paid and complete for accounts.
//
// Admins only (Jack, 2026-10-26) — and every action re-checks that on the server. The filter lives in
// the address bar, read by parseRefundFilter. ⚠ The search never does (it is usually a customer's
// name or email): this page always renders the list unsearched, and the panel asks listRefunds for
// the search itself.

export const dynamic = "force-dynamic"
export const metadata = { title: "Refunds" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** This Hub's own address, from the request (Railway's proxy forwards the host) — so staging's page
 *  shows staging's form and the live Hub the live one. */
async function formAddress(): Promise<string> {
  const h = await headers()
  const first = (v: string | null) => (v ?? "").split(",")[0].trim()
  const host = first(h.get("x-forwarded-host")) || first(h.get("host"))
  if (!host || !/^[A-Za-z0-9.\-:[\]]+$/.test(host)) return REFUND_FORM_PATH
  const proto = first(h.get("x-forwarded-proto")) || (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https")
  return `${proto === "http" ? "http" : "https"}://${host}${REFUND_FORM_PATH}`
}

export default async function RefundsPage({ searchParams }: { searchParams: SearchParams }) {
  const { canAccess, isAdmin } = await getAccountsAccess()
  // Admins only — anyone else (Accounts' Simple mode included) goes back to the Hub.
  if (!canAccess || !isAdmin) redirect("/hub")

  const sp = await searchParams
  const [res, formUrl] = await Promise.all([listRefunds(parseRefundFilter(sp)), formAddress()])

  return (
    <div className="p-4 sm:p-6 max-w-7xl desk:max-w-[1600px] mx-auto">
      <BackLink href="/hub">Hub</BackLink>
      <div className="mt-1 mb-5">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">💷 Refunds</h1>
        <p className="text-base text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
          Refund, part-refund and return requests from customers, and payouts to vendors — from first look to paid and complete for accounts.
        </p>
      </div>

      {res.ok ? (
        <RefundsPanel list={res.data} />
      ) : res.notReady ? (
        <NeedsMigrations />
      ) : (
        <ErrorNote>{res.error}</ErrorNote>
      )}

      <FormLink url={formUrl} />

      {/* Requests with no sale code (the old log's, the form's) — their F / E number matched from BC. */}
      {res.ok && <details className={`${card} group mt-5`}>
        <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center gap-2 min-h-11 px-4 sm:px-5 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          <span className="transition-transform group-open:rotate-90" aria-hidden>▸</span> Match sales from BC
        </summary>
        <div className="px-4 sm:px-5 pb-5">
          <MatchSales />
        </div>
      </details>}

      {/* The old SharePoint log, brought over once (re-importing never duplicates — each row's importKey). */}
      {res.ok && <details className={`${card} group mt-5`}>
        <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center gap-2 min-h-11 px-4 sm:px-5 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          <span className="transition-transform group-open:rotate-90" aria-hidden>▸</span> Import the old refund log
        </summary>
        <div className="px-4 sm:px-5 pb-5">
          <ImportBox />
        </div>
      </details>}

      <HowItWorks />
    </div>
  )
}

/** The rules, plainly — where requests come from, how the money is worked out, what BC is used for. */
function HowItWorks() {
  return (
    <section className={`${card} p-4 sm:p-5 mt-5`} aria-labelledby="how-title">
      <h2 id="how-title" className="text-sm font-semibold text-gray-700 dark:text-gray-200">How refunds work here</h2>
      <ul className="mt-2 space-y-2 text-sm text-gray-600 dark:text-gray-300 list-disc pl-5 max-w-4xl">
        <li>
          <b>Where they come from.</b> Customers fill in the <b>public refund form</b> (its address is above — no login needed), which
          arrives here as <b>New</b> with their photos. Anything sent another way — an email, a phone call, a vendor owed a payout — is
          added with <b>＋ Add a request</b>. The old SharePoint refund log can be imported once (re-importing never adds a row twice).
        </li>
        <li>
          <b>Working it.</b> Open a request, <b>Pick it up</b>, then move it on: being looked at, waiting for the item to come back,
          agreed — to pay, and paid (with the date processed). Declining or closing it another way needs a reason. Once it&apos;s paid,
          accounts tick <b>Complete for accounts</b>.
        </li>
        <li>
          <b>The money.</b> Commission is the buyer&apos;s premium, <b>27% of the hammer</b> including VAT. A refund of a percentage is that
          percentage of hammer + commission (£90 + £24.30 at 20% = £22.86); &ldquo;hammer only&rdquo; is the percentage of the hammer alone;
          a set amount is just that. Postage refunded is added on top. A total is only saved once every lot can be worked out —
          until then the list says <b>Not worked out</b> (a request from the old log keeps the log&apos;s total until then).
        </li>
        <li>
          <b>Fill from BC</b> looks up the buyer&apos;s lots in Business Central (their C-number, and the sale or auction date) with your own
          BC sign-in, and offers the hammer, commission and description for the lots on the request. It <b>only reads</b> BC — nothing
          is ever written to it — and nothing is saved until you press Save.
        </li>
        <li>
          <b>Never bank or card details</b> — not in a note, not in what happened. The Hub refuses anything that looks like them.
        </li>
      </ul>
    </section>
  )
}
