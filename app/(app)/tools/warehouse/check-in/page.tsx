import type { ReactNode } from "react"
import { getCustomer, type CustomerRow } from "@/lib/actions/goods-in"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { COUNTER_KEYS, type CounterKey } from "@/lib/goods-in/model"
import { readCounters } from "@/lib/goods-in/numbers"
import { ErrorBox, NotReady, PageHeader, isMissingTable } from "../_components/ui"
import CheckInFlow from "./check-in-flow"

// Goods In → Check in (the counter's main screen). The page checks who is asking and whether the
// number series are set up, then hands over to the step flow, which does the rest in the browser
// and books in through createReceipt. Nothing here touches Business Central.

export const dynamic = "force-dynamic"
export const metadata = { title: "Check in — Goods In" }

const Shell = ({ children }: { children: ReactNode }) => (
  <div className="p-4 sm:p-6 lg:p-8">
    <PageHeader
      title="Check in"
      back={{ href: "/tools/warehouse", label: "Goods In" }}
      intro="Book a customer's goods in: find the customer, list their totes and pallets, check the terms, then book in. Nothing is booked until you press Book in."
    />
    {children}
  </div>
)

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ customer?: string | string[] }> }) {
  const sp = await searchParams
  // "Book in" on the Customers list and on a customer's page arrive with ?customer=<contact id>,
  // so the counter starts with that customer already picked.
  const wantedId = [sp.customer].flat()[0]?.trim() || null
  const user = await getGoodsInUser()
  if (!user) {
    return (
      <Shell>
        <ErrorBox>Your account doesn&apos;t have Warehouse access, so it can&apos;t book goods in. An admin can give you the Warehouse app.</ErrorBox>
      </Shell>
    )
  }

  // Which number series are set up. Unset ones make Book in refuse, so the counter is told up front.
  let missing: CounterKey[] | null = null
  let readProblem: string | null = null
  let initialCustomer: CustomerRow | null = null
  let customerProblem: string | null = null
  try {
    const set = new Set((await readCounters()).map(c => c.key))
    missing = COUNTER_KEYS.filter(k => !set.has(k))
  } catch (e) {
    if (isMissingTable(e)) return <Shell><NotReady /></Shell>
    console.error("check-in: reading the number series failed:", e)
    readProblem = String((e as { message?: string })?.message ?? e).slice(0, 200)
  }

  // getCustomer answers { ok, error } rather than throwing, so a bad id never stops the screen.
  if (wantedId) {
    const r = await getCustomer(wantedId)
    if (r.ok && r.data) initialCustomer = r.data
    else customerProblem = r.ok ? "That customer couldn't be found — search for them below." : `Couldn't open that customer (${r.error}) — search for them below.`
  }

  return (
    <Shell>
      {readProblem && (
        <div className="mb-5">
          <ErrorBox>Couldn&apos;t check the number series ({readProblem}). You can still fill in the check-in — Book in will say if anything is missing.</ErrorBox>
        </div>
      )}
      {customerProblem && (
        <div className="mb-5">
          <ErrorBox>{customerProblem}</ErrorBox>
        </div>
      )}
      <CheckInFlow missingSeries={missing} isAdmin={atLeast(user, "admin")} userId={user.id} initialCustomer={initialCustomer} />
    </Shell>
  )
}
