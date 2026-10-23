import Link from "next/link"
import { personName } from "@/lib/goods-in/customer-row"
import { prisma } from "@/lib/prisma"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { box, btn, mono, Empty, ErrorBox, KindBadge, NotReady, PageHeader, StatusBadge, StatusKey, isMissingTable, ukDateTime } from "../_components/ui"
import { clock, plural } from "../move/words"
import { MarkCatalogued, RefreshButton, SendToBench } from "./bench-actions"

// Goods In → Benches. What is on each cataloguing bench right now: every tote and pallet whose last
// move was to a BENCH location, grouped by bench, with how many lots have been made from it so far
// (CatalogueLot.tote = the tote number). A tote stays listed here, marked Catalogued, until it is
// moved somewhere else — that is where it physically still is.

export const dynamic = "force-dynamic"

type Tote = {
  id: string; kind: string; category: string | null; description: string | null; status: string | null
  movedAt: Date | null; receiptId: string; customerId: string; customer: string; lots: number
}
type BenchGroup = { code: string; name: string | null; active: boolean; totes: Tote[] }

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, "en-GB", { numeric: true })

async function load() {
  const [containers, benches] = await Promise.all([
    prisma.goodsInContainer.findMany({
      where: { locationKind: "bench", locationCode: { not: null } },
      select: {
        id: true, kind: true, category: true, description: true, status: true, locationCode: true, movedAt: true, receiptId: true,
        receipt: { select: { customerId: true, person: { select: { name: true, name2: true } } } },
      },
      orderBy: { movedAt: "asc" },
    }),
    prisma.goodsInLocation.findMany({ where: { kind: "bench" }, select: { code: true, name: true, active: true } }),
  ])

  // Lots made from each tote so far — matched the way the Add Lot wizard stores it (upper case, no spaces).
  const ids = containers.map(c => c.id)
  const counts = ids.length
    ? await prisma.$queryRaw<{ tote: string; n: number }[]>`
        SELECT upper(replace(btrim("tote"), ' ', '')) AS tote, count(*)::int AS n
        FROM "CatalogueLot"
        WHERE upper(replace(btrim("tote"), ' ', '')) = ANY(${ids}::text[])
        GROUP BY 1`
    : []
  const lotsFor = new Map(counts.map(c => [c.tote, Number(c.n)]))

  const groups = new Map<string, BenchGroup>()
  for (const b of benches) groups.set(b.code, { code: b.code, name: b.name, active: b.active !== false, totes: [] })
  for (const c of containers) {
    const code = c.locationCode!
    if (!groups.has(code)) groups.set(code, { code, name: null, active: true, totes: [] })
    groups.get(code)!.totes.push({
      id: c.id, kind: c.kind, category: c.category, description: c.description, status: c.status, movedAt: c.movedAt,
      receiptId: c.receiptId, customerId: c.receipt.customerId ?? "", customer: personName(c.receipt.person), lots: lotsFor.get(c.id) ?? 0,
    })
  }
  const all = [...groups.values()]
  return {
    occupied: all.filter(g => g.totes.length > 0).sort(byCode),
    free: all.filter(g => g.totes.length === 0 && g.active).sort(byCode),
    benchCount: benches.length,
    totes: containers.length,
  }
}

export default async function BenchPage() {
  const user = await getGoodsInUser()
  const header = (
    <PageHeader
      title="Benches"
      back={{ href: "/tools/warehouse", label: "Goods In" }}
      intro="What is on each cataloguing bench right now, how many lots have been made from each tote so far, and a place to mark a tote catalogued once its lots are made."
      actions={
        <>
          <Link href="/tools/warehouse/move" className={btn}>Move</Link>
          <RefreshButton />
        </>
      }
    />
  )
  if (!user) {
    return <div className="p-4 sm:p-6 lg:p-8">{header}<ErrorBox>Your account doesn&apos;t have Warehouse access.</ErrorBox></div>
  }

  let data: Awaited<ReturnType<typeof load>>
  try {
    data = await load()
  } catch (e) {
    if (isMissingTable(e)) return <div className="p-4 sm:p-6 lg:p-8">{header}<NotReady /></div>
    console.error("goods-in bench page:", e)
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        {header}
        <ErrorBox>The benches couldn&apos;t be read just now — press Refresh to try again. ({String((e as Error)?.message ?? e).slice(0, 160)})</ErrorBox>
      </div>
    )
  }

  const { occupied, free, benchCount, totes } = data
  const stillGoing = occupied.reduce((n, b) => n + b.totes.filter(t => t.status !== "catalogued").length, 0)
  const finished = totes - stillGoing

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {header}

      <section className={`${box} p-4 sm:p-5`}>
        <div className="max-w-2xl">
          <SendToBench />
        </div>
      </section>

      {totes > 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          <b className="text-gray-900 dark:text-white">{plural(totes, "tote or pallet", "totes and pallets")}</b> at {plural(occupied.length, "bench", "benches")} —{" "}
          {stillGoing === 0 ? "none still being catalogued" : `${stillGoing.toLocaleString("en-GB")} still being catalogued`}
          {finished > 0 ? `, ${finished.toLocaleString("en-GB")} catalogued and waiting to be moved away` : ""}.{" "}
          <span className="text-gray-500 dark:text-gray-400">As at {clock(new Date())}.</span>
        </p>
      )}

      {occupied.length === 0 ? (
        <Empty>
          <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Nothing is at a bench right now</p>
          <p className="max-w-xl mx-auto leading-relaxed">
            A tote or pallet arrives here when it is moved to a bench — scan it and then the bench in the box above, or use{" "}
            <Link href="/tools/warehouse/move" className="underline">Move</Link>.
            {benchCount === 0 && (
              <> No bench locations have been set up yet: a Warehouse manager adds them (or loads the warehouse&apos;s list, which marks the benches) in{" "}
                <Link href="/tools/warehouse/locations" className="underline">Locations</Link>.</>
            )}
          </p>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3 items-start">
          {occupied.map(b => <BenchCard key={b.code} bench={b} />)}
        </div>
      )}

      {occupied.length > 0 && <StatusKey />}

      {free.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Free benches ({free.length})</h2>
          <div className="flex flex-wrap gap-2">
            {free.map(b => (
              <Link
                key={b.code}
                href={`/tools/warehouse/find?q=${encodeURIComponent(b.code)}`}
                title={b.name ?? undefined}
                className={`${mono} inline-flex min-h-11 items-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800`}
              >
                {b.code}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function BenchCard({ bench }: { bench: BenchGroup }) {
  const totes = bench.totes.filter(t => t.kind !== "pallet").length
  const pallets = bench.totes.length - totes
  return (
    <section className={`${box} overflow-hidden`}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <h2 className={`${mono} text-xl font-bold text-gray-900 dark:text-white`}>
          <Link href={`/tools/warehouse/find?q=${encodeURIComponent(bench.code)}`} className="hover:underline">{bench.code}</Link>
        </h2>
        {bench.name && <span className="text-sm text-gray-500 dark:text-gray-400">{bench.name}</span>}
        {!bench.active && <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">switched off</span>}
        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
          {[totes ? plural(totes, "tote") : null, pallets ? plural(pallets, "pallet") : null].filter(Boolean).join(" · ")}
        </span>
      </header>
      <ul className="divide-y divide-gray-200 dark:divide-gray-800">
        {bench.totes.map(t => (
          <li key={t.id} className="px-4 py-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/tools/warehouse/find?q=${encodeURIComponent(t.id)}`} className={`${mono} text-lg font-bold text-gray-900 dark:text-white hover:underline`}>{t.id}</Link>
              <KindBadge kind={t.kind} />
              <StatusBadge status={t.status} />
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-200">
              <Link href={`/tools/warehouse/customers/${encodeURIComponent(t.customerId)}`} className="hover:underline">{t.customer}</Link>
              <span className="text-gray-400"> · </span>
              receipt <Link href={`/tools/warehouse/receipts/${encodeURIComponent(t.receiptId)}`} className={`${mono} underline-offset-2 hover:underline`}>{t.receiptId}</Link>
            </p>
            {(t.category || t.description) && (
              <p className="text-sm text-gray-700 dark:text-gray-200 break-words">
                {t.category && <b className="text-gray-900 dark:text-white">{t.category}</b>}
                {t.category && t.description ? " — " : ""}
                {t.description}
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Here since {ukDateTime(t.movedAt)} ·{" "}
              {t.lots === 0 ? (
                "no lots made from it yet"
              ) : (
                <Link href={`/tools/warehouse/find?q=${encodeURIComponent(t.id)}`} className="underline">{plural(t.lots, "lot")} made so far</Link>
              )}
            </p>
            <div className="flex flex-wrap items-start gap-2 pt-1">
              <MarkCatalogued id={t.id} status={t.status} lots={t.lots} />
              <Link href={`/tools/warehouse/move?item=${encodeURIComponent(t.id)}`} className={btn}>Move it</Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
