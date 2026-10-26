import { redirect } from "next/navigation"
import { getAccountsAccess } from "@/lib/accounts-auth"
import { getRefund } from "@/lib/actions/refunds"
import { REFUNDS_PATH, parseRefundFilter, refundFilterQuery } from "@/lib/refunds"
import { londonDay } from "@/lib/uncollected"
import RefundView from "./refund-client"
import { BackLink, ErrorNote, NeedsMigrations } from "../ui"

// Admin & Operations → Refunds → one request: who sent it and why, its status and who's dealing with
// it, the lots and the money (filled from BC — read only — and worked out live), the photos, the old
// log's cells for an imported one, notes, the timeline, and Delete. Admins only, like the list; every
// action re-checks on the server.
//
// The list's filter rides along in the address only so Back returns to the same list — nothing else
// is put in the URL, never the search (the list keeps that in the tab's sessionStorage itself).

export const dynamic = "force-dynamic"

type Params = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

// Never the customer's name in the tab's title (titles end up in the browser's history).
export const metadata = { title: "Refunds — request" }

export default async function RefundPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { session, canAccess, isAdmin } = await getAccountsAccess()
  if (!session || !canAccess || !isAdmin) redirect("/hub")

  const { id } = await params
  const sp = await searchParams
  const backHref = `${REFUNDS_PATH}${refundFilterQuery(parseRefundFilter(sp))}`
  const res = await getRefund(id)

  if (!res.ok) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <BackLink href={backHref}>Refunds</BackLink>
        <div className="mt-3">{res.notReady ? <NeedsMigrations /> : <ErrorNote>{res.error}</ErrorNote>}</div>
      </div>
    )
  }

  const me = { id: session.user.id, name: session.user.name || session.user.email || "Unknown" }
  return <RefundView r={res.data} today={londonDay()} backHref={backHref} me={me} />
}
