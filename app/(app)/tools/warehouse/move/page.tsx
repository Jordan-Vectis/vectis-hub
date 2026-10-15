import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { ErrorBox, NotReady, PageHeader, isMissingTable } from "../_components/ui"
import MoveScreen from "./move-screen"

// Goods In → Move. The scanner screen for putting things somewhere: scan a tote, pallet or lot, then
// the location it is going to. ?item=T027657 opens with that item already waiting for a location;
// ?to=BENCH12 opens with that location kept, so every scan goes straight there.

export const dynamic = "force-dynamic"

export default async function MovePage({ searchParams }: { searchParams: Promise<{ item?: string | string[]; to?: string | string[] }> }) {
  const sp = await searchParams
  const user = await getGoodsInUser()
  if (!user) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PageHeader title="Move" />
        <ErrorBox>Your account doesn&apos;t have Warehouse access.</ErrorBox>
      </div>
    )
  }

  // How many locations there are to move things to — none at all means every scan would fail, so
  // say why up front rather than letting the first move be the one that finds out.
  let locations = 0
  try {
    locations = await prisma.goodsInLocation.count({ where: { OR: [{ active: true }, { active: null }] } })
  } catch (e) {
    if (isMissingTable(e)) {
      return (
        <div className="p-4 sm:p-6 lg:p-8">
          <PageHeader title="Move" back={{ href: "/tools/warehouse", label: "Goods In" }} />
          <NotReady />
        </div>
      )
    }
    console.error("goods-in move page:", e)
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PageHeader title="Move" back={{ href: "/tools/warehouse", label: "Goods In" }} />
        <ErrorBox>The locations couldn&apos;t be read just now — refresh the page to try again. ({String((e as Error)?.message ?? e).slice(0, 160)})</ErrorBox>
      </div>
    )
  }

  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Move"
        back={{ href: "/tools/warehouse", label: "Goods In" }}
        intro={<>Scan a tote, pallet or lot, then scan where it is going. To put a run of things in the same place, scan the location first (or switch on <b>Keep this location</b>) and then just scan each item.</>}
      />
      {locations === 0 && (
        <div className="mb-4 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-5 py-4 text-sm leading-relaxed">
          <p className="font-semibold mb-1">No locations have been set up yet</p>
          <p>
            Nothing can be moved until there are locations to move it to. A Warehouse manager adds them (or loads the warehouse&apos;s whole list) in{" "}
            <Link href="/tools/warehouse/locations" className="underline font-semibold">Locations</Link>.
          </p>
        </div>
      )}
      <MoveScreen initialItem={first(sp.item)} initialTo={first(sp.to)} />
    </div>
  )
}
