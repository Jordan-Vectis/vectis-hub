import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCustomer, type CustomerRow } from "@/lib/actions/goods-in"
import { getAgreement, type CustomerAgreement } from "@/lib/actions/goods-in-agreement"
import { listUnfinishedCheckIns, loadCheckIn, type CheckInLoaded } from "@/lib/actions/goods-in-checkin"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { COUNTER_KEYS, normaliseCode, type CounterKey } from "@/lib/goods-in/model"
import { readCounters } from "@/lib/goods-in/numbers"
import { ErrorBox, NotReady, PageHeader, isMissingTable } from "../_components/ui"
import CheckInFlow from "./check-in-flow"
import type { UnfinishedCheckIn } from "./shared"

// Goods In → Check in (the counter's main screen). The page checks who is asking and whether the
// number series are set up, reads any check-in being carried on (?receipt=), the customer's Fees &
// agreement (so the terms are right from the first draw) and the check-ins not booked in yet, then
// hands over to the step flow, which does the rest in the browser — saving the check-in as it goes
// (lib/actions/goods-in-checkin.ts). Nothing here touches Business Central.

export const dynamic = "force-dynamic"
export const metadata = { title: "Check in — Goods In" }

const Shell = ({ children }: { children: ReactNode }) => (
  <div className="p-4 sm:p-6 lg:p-8">
    <PageHeader
      title="Check in"
      back={{ href: "/tools/warehouse", label: "Goods In" }}
      intro="Find the customer, list their totes and pallets, then book them in. Each tote and pallet is numbered as soon as you add it, so its label can go on straight away — nothing counts as booked in until you press Book in."
    />
    {children}
  </div>
)

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ customer?: string | string[]; receipt?: string | string[] }> }) {
  const sp = await searchParams
  // "Book in" on the Customers list and on a customer's page arrive with ?customer=<contact id>,
  // so the counter starts with that customer already picked. "Carry on checking in" (Receipts, the
  // dashboard, a customer's page) arrives with ?receipt=<receipt not booked in yet>.
  const wantedId = [sp.customer].flat()[0]?.trim() || null
  const wantedReceipt = normaliseCode([sp.receipt].flat()[0] ?? "") || null
  const user = await getGoodsInUser()
  if (!user) {
    return (
      <Shell>
        <ErrorBox>Your account doesn&apos;t have Warehouse access, so it can&apos;t book goods in. An admin can give you the Warehouse app.</ErrorBox>
      </Shell>
    )
  }

  // Which number series are set up. Unset ones make numbering refuse, so the counter is told up front.
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

  // The actions answer { ok, error } rather than throwing, so a bad id never stops the screen.
  let initialCheckIn: CheckInLoaded | null = null
  let receiptProblem: string | null = null
  if (wantedReceipt) {
    const r = await loadCheckIn(wantedReceipt)
    if (r.ok) {
      initialCheckIn = r.data
    } else {
      // Not a check-in any more (booked in, or thrown away and kept as voided): its own page says what it is.
      const found = await prisma.goodsInReceipt.findUnique({ where: { id: wantedReceipt }, select: { status: true } }).catch(() => null)
      if (found && found.status !== "draft") redirect(`/tools/warehouse/receipts/${encodeURIComponent(wantedReceipt)}`)
      receiptProblem = `Couldn't carry on with ${wantedReceipt}: ${r.error}`
    }
  }

  if (wantedId && !initialCheckIn) {
    const r = await getCustomer(wantedId)
    if (r.ok && r.data) initialCustomer = r.data
    else customerProblem = r.ok ? "That customer couldn't be found — search for them below." : `Couldn't open that customer (${r.error}) — search for them below.`
  }

  // Their Fees & agreement (customer page → Fees & agreement): the reserve, a special arrangement and
  // whether they've signed the vendor terms. Not read → the screen reads it itself, and until then
  // the fees on their record and the standard reserve apply.
  let initialAgreement: CustomerAgreement | null = null
  const forContact = initialCheckIn?.customer?.id ?? initialCustomer?.id ?? null
  if (forContact) {
    const a = await getAgreement(forContact).catch(() => null)
    if (a?.ok) initialAgreement = a.data
  }

  // Check-ins not booked in yet — the person's own first, each marked `mine` by the Hub. The Customer
  // step offers their own back; everyone's are used to spot a customer who already has one.
  let unfinished: UnfinishedCheckIn[] = []
  const u = await listUnfinishedCheckIns().catch(() => null)
  if (u?.ok) unfinished = u.data

  return (
    <Shell>
      {readProblem && (
        <div className="mb-5">
          <ErrorBox>Couldn&apos;t check the number series ({readProblem}). You can still fill in the check-in — it will say if a number can&apos;t be given.</ErrorBox>
        </div>
      )}
      {receiptProblem && (
        <div className="mb-5">
          <ErrorBox>{receiptProblem}</ErrorBox>
        </div>
      )}
      {customerProblem && (
        <div className="mb-5">
          <ErrorBox>{customerProblem}</ErrorBox>
        </div>
      )}
      <CheckInFlow
        missingSeries={missing}
        isAdmin={atLeast(user, "admin")}
        userId={user.id}
        initialCustomer={initialCustomer}
        initialCheckIn={initialCheckIn}
        initialAgreement={initialAgreement}
        unfinished={unfinished}
      />
    </Shell>
  )
}
