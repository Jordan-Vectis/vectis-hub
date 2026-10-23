import Link from "next/link"
import { personName } from "@/lib/goods-in/customer-row"
import type { ReactNode } from "react"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { mailStatus } from "@/lib/goods-in/mail"
import { listUnfinishedCheckIns } from "@/lib/actions/goods-in-checkin"
import type { ContainerStatus, CounterKey, CustomerSnapshot } from "@/lib/goods-in/model"
import { GoodsInFindBox } from "@/components/warehouse-sidebar"
import { Empty, ErrorBox, NotReady, PageHeader, StatusBadge, box, btn, btnGo, isMissingTable, mono, td, th, ukDateTime } from "./_components/ui"
import { londonDayStart, londonYmd, mondayOfYmd } from "./history/london-days"
import { FromTo, MOVE_SELECT, MoveKindChip, findHref, moveItem, moveKind, type MoveRow } from "./history/move-parts"
import { BOOKED_LIVE, NOT_DRAFT, carryOnHref } from "./receipts/_parts"

// Goods In — the dashboard. What the counter needs at a glance: book goods in, scan anything,
// how much is waiting where, and what has just happened. Read straight from the Goods In tables
// (the Hub's normal pattern for a server page); nothing here reads or writes Business Central.

export const dynamic = "force-dynamic"

/** The series booking in can't work without (vendor numbers are optional by design — see createReceipt). */
const NEEDED_SERIES: CounterKey[] = ["receipt", "tote", "pallet"]

type KindCount = { totes: number; pallets: number }
const none = (): KindCount => ({ totes: 0, pallets: 0 })

async function loadDashboard() {
  const today = londonYmd()
  const dayStart = londonDayStart(today)
  const weekStart = londonDayStart(mondayOfYmd(today))
  // A voided receipt's totes aren't real goods, and a check-in that hasn't been booked in yet (a
  // draft) isn't booked in at all — leave both out of every figure. A draft's createdAt becomes the
  // booking time when it is booked in, so "booked today" counts it on the day it really was.
  const liveReceipt: Prisma.GoodsInReceiptWhereInput = BOOKED_LIVE

  const [bookedToday, byStatus, cataloguedWeek, receipts, moves, counters, locations, mail, unfinished] = await Promise.all([
    prisma.goodsInReceipt.count({ where: { createdAt: { gte: dayStart }, ...liveReceipt } }),
    prisma.goodsInContainer.groupBy({ by: ["status", "kind"], where: { receipt: liveReceipt }, _count: { _all: true } }),
    prisma.goodsInContainer.groupBy({ by: ["kind"], where: { status: "catalogued", updatedAt: { gte: weekStart }, receipt: liveReceipt }, _count: { _all: true } }),
    // Recent receipts are ones booked in; check-ins not finished have their own list.
    prisma.goodsInReceipt.findMany({
      where: NOT_DRAFT,
      take: 10,
      orderBy: { createdAt: "desc" },
      select: { id: true, customer: true, status: true, createdByName: true, createdAt: true, person: { select: { name: true, name2: true } }, containers: { select: { kind: true } } },
    }),
    prisma.goodsInMovement.findMany({ take: 10, orderBy: { movedAt: "desc" }, select: MOVE_SELECT }),
    prisma.goodsInCounter.findMany({ select: { key: true } }),
    prisma.goodsInLocation.count({ where: { OR: [{ active: null }, { active: true }] } }),
    mailStatus(),
    // Never let this list stop the dashboard: a failure is shown as a quiet line instead.
    listUnfinishedCheckIns().catch(e => ({ ok: false as const, error: String((e as { message?: string })?.message ?? e).slice(0, 200) })),
  ])

  const status: Record<"booked" | "stored" | "bench", KindCount> = { booked: none(), stored: none(), bench: none() }
  for (const g of byStatus) {
    const s = (g.status ?? "booked") as ContainerStatus
    if (s !== "booked" && s !== "stored" && s !== "bench") continue
    if (g.kind === "pallet") status[s].pallets += g._count._all
    else status[s].totes += g._count._all
  }
  const catalogued = none()
  for (const g of cataloguedWeek) {
    if (g.kind === "pallet") catalogued.pallets += g._count._all
    else catalogued.totes += g._count._all
  }

  const haveSeries = new Set(counters.map(c => c.key))
  return {
    bookedToday, status, catalogued, receipts, moves: moves as MoveRow[], locations, mail, unfinished,
    missingSeries: NEEDED_SERIES.filter(k => !haveSeries.has(k)),
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`
const splitLine = (c: KindCount) => `${plural(c.totes, "tote")} · ${plural(c.pallets, "pallet")}`

export default async function GoodsInDashboard() {
  const user = await getGoodsInUser()
  const isAdmin = atLeast(user, "admin")
  const isManager = atLeast(user, "manager")

  let data: Awaited<ReturnType<typeof loadDashboard>> | null = null
  let notReady = false
  let error: string | null = null
  try {
    data = await loadDashboard()
  } catch (e) {
    if (isMissingTable(e)) notReady = true
    else {
      console.error("goods-in dashboard error:", e)
      error = String((e as { message?: string })?.message ?? e).slice(0, 300)
    }
  }

  const bookButton = (
    <Link href="/tools/warehouse/check-in" className={`${btnGo} !min-h-14 !px-6 !text-base shadow-sm`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="w-5 h-5" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
      Book goods in
    </Link>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Goods In"
        intro="Book a customer's goods in, put totes and pallets away, and find anything by scanning its code."
        actions={notReady ? undefined : bookButton}
      />

      {notReady && <NotReady />}

      {!notReady && (
        <div className="space-y-6">
          {error && <ErrorBox>The dashboard&apos;s figures couldn&apos;t be loaded: {error}. Booking in and Find may still work — try refreshing in a moment.</ErrorBox>}

          {data && <SetupChecklist data={data} isAdmin={isAdmin} isManager={isManager} />}

          <section className={`${box} p-4 sm:p-5`} aria-label="Find anything">
            <GoodsInFindBox autoFocus />
          </section>

          {data && <Unfinished data={data} />}

          {data && <Figures data={data} />}

          {data && (
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6 items-start">
              <RecentReceipts receipts={data.receipts} />
              <RecentMoves moves={data.moves} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Setup checklist ─────────────────────────────────────────────────────────────────────

type Data = Awaited<ReturnType<typeof loadDashboard>>

function SetupChecklist({ data, isAdmin, isManager }: { data: Data; isAdmin: boolean; isManager: boolean }) {
  const seriesDone = data.missingSeries.length === 0
  const locationsDone = data.locations > 0
  const mailDone = data.mail.connected
  if (seriesDone && locationsDone && mailDone) return null

  // Keys read as words ("receipt", "tote", "pallet"). Without receipt or tote numbers nothing can be
  // booked in; without pallet numbers only pallets are refused.
  const missingNames: string[] = data.missingSeries
  const blocksAll = data.missingSeries.some(k => k !== "pallet")
  const items: { done: boolean; title: string; detail: ReactNode; action?: { href: string; label: string } }[] = [
    {
      done: seriesDone,
      title: "Number series",
      detail: seriesDone
        ? "Receipt, tote and pallet numbers are set."
        : <>Where the {listWords(missingNames)} numbers carry on from isn&apos;t set yet, so {blocksAll ? "booking in is refused" : "pallets can't be booked in"} until it is.{!isAdmin && " Ask a Warehouse admin to set it in Settings."}</>,
      action: !seriesDone && isAdmin ? { href: "/tools/warehouse/settings", label: "Open Settings" } : undefined,
    },
    {
      done: locationsDone,
      title: "Locations",
      detail: locationsDone
        ? `${plural(data.locations, "location")} ready for putting goods away.`
        : <>No storage locations, benches or shelves yet, so nothing can be put away.{!isManager && " Ask a manager to add them."}</>,
      action: !locationsDone ? { href: "/tools/warehouse/locations", label: isManager ? "Add locations" : "View locations" } : undefined,
    },
    {
      done: mailDone,
      title: "Receipts mailbox",
      detail: mailDone
        ? <>Receipts are emailed from <span className={mono}>{data.mail.mailbox}</span>.</>
        : data.mail.configured
          ? <>The mailbox receipts are emailed from (<span className={mono}>{data.mail.mailbox}</span>) isn&apos;t connected yet. Receipts can still be printed.{!isAdmin && " A Warehouse admin connects it in Settings."}</>
          : <>Emailing receipts needs Microsoft settings this Hub doesn&apos;t have yet (IT are setting these up). Receipts can still be printed.</>,
      action: !mailDone && isAdmin ? { href: "/tools/warehouse/settings", label: "Open Settings" } : undefined,
    },
  ]
  const left = items.filter(i => !i.done).length

  return (
    <section className="rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 p-4 sm:p-5" aria-labelledby="goods-in-setup">
      <h2 id="goods-in-setup" className="text-base font-semibold text-amber-900 dark:text-amber-100">Setting up Goods In — {plural(left, "thing", "things")} still to do</h2>
      <p className="text-sm text-amber-800 dark:text-amber-200/90 mt-0.5">This box goes away once everything below is done.</p>
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        {items.map(i => (
          <li key={i.title} className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-white/70 dark:bg-gray-900/60 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{i.title}</span>
              {i.done
                ? <span className="rounded-full border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">Done</span>
                : <span className="rounded-full border border-amber-400 dark:border-amber-600 bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-100">To do</span>}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{i.detail}</p>
            {i.action && (
              <Link href={i.action.href} className="mt-auto self-start inline-flex items-center min-h-11 px-4 rounded-lg text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors">
                {i.action.label} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

const listWords = (w: string[]) => (w.length <= 1 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`)

// ─── Check-ins not finished ──────────────────────────────────────────────────────────────

/** How many unfinished check-ins the dashboard lists before pointing at Receipts — it mustn't push the figures down. */
const UNFINISHED_SHOWN = 3

/** Check-ins started at the counter but not booked in yet (draft receipts) — carry one on, or open it to throw it away. */
function Unfinished({ data }: { data: Data }) {
  const res = data.unfinished
  if (!res.ok) {
    return <p className="text-xs text-gray-500 dark:text-gray-400">Check-ins not finished couldn&apos;t be listed just now ({res.error}). They are still on the Receipts list under <b>Not booked in yet</b>.</p>
  }
  const list = res.data
  if (list.length === 0) return null
  // The person's own come first (listUnfinishedCheckIns), then everyone else's, newest first.
  const shown = list.slice(0, UNFINISHED_SHOWN)
  const more = list.length - shown.length
  return (
    <section className="rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 p-4 sm:p-5" aria-labelledby="unfinished-checkins">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        {/* listUnfinishedCheckIns gives at most 20, so 20 may mean more. */}
        <h2 id="unfinished-checkins" className="text-base font-semibold text-amber-900 dark:text-amber-100">Check-ins not finished ({list.length >= 20 ? "20+" : list.length.toLocaleString("en-GB")})</h2>
        <Link href="/tools/warehouse/receipts?status=draft" className="inline-flex items-center min-h-11 text-sm font-medium text-amber-900 dark:text-amber-100 underline">See them in Receipts</Link>
      </div>
      <p className="text-sm text-amber-800 dark:text-amber-200/90">Started at the counter but not booked in yet. Carry one on to finish it, or open it to throw it away.</p>
      <ul className="mt-3 space-y-2">
        {shown.map(u => {
          const who = u.mine ? "you" : u.createdByName
          return (
            <li key={u.receiptId} className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-white/80 dark:bg-gray-900/70 p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-semibold text-gray-900 dark:text-white break-words">
                  {u.customer || "No customer"} <span className={`${mono} font-normal text-gray-500 dark:text-gray-400`}>{u.receiptId}</span>
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                  {u.rows === 0 ? "Nothing added yet" : `${plural(u.rows, "tote or pallet", "totes and pallets")} numbered`}
                  {who ? ` · started by ${who}` : ""} · last saved {ukDateTime(u.updatedAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={carryOnHref(u.receiptId)} className={btnGo}>Carry on</Link>
                <Link href={`/tools/warehouse/receipts/${encodeURIComponent(u.receiptId)}`} className={btn}>Open</Link>
              </div>
            </li>
          )
        })}
      </ul>
      {more > 0 && (
        <p className="mt-2 text-sm text-amber-900 dark:text-amber-100">
          And {list.length >= 20 ? "more" : `${more.toLocaleString("en-GB")} more`} —{" "}
          <Link href="/tools/warehouse/receipts?status=draft" className="inline-flex items-center min-h-11 font-medium underline">see them in Receipts</Link>.
        </p>
      )}
    </section>
  )
}

// ─── Figure tiles ────────────────────────────────────────────────────────────────────────

function Figures({ data }: { data: Data }) {
  const total = (c: KindCount) => c.totes + c.pallets
  const tiles: { href: string; label: string; value: number; sub: string; status?: ContainerStatus; go: string }[] = [
    { href: "/tools/warehouse/receipts", label: "Receipts booked today", value: data.bookedToday, sub: "Since midnight", go: "See receipts" },
    { href: "/tools/warehouse/move", label: "Waiting to be put away", value: total(data.status.booked), sub: splitLine(data.status.booked), status: "booked", go: "Put away in Move" },
    { href: "/tools/warehouse/locations", label: "In storage", value: total(data.status.stored), sub: splitLine(data.status.stored), status: "stored", go: "See locations" },
    { href: "/tools/warehouse/bench", label: "At a bench", value: total(data.status.bench), sub: splitLine(data.status.bench), status: "bench", go: "See benches" },
    { href: "/tools/warehouse/bench", label: "Catalogued this week", value: total(data.catalogued), sub: `${splitLine(data.catalogued)} · since Monday`, status: "catalogued", go: "See benches" },
  ]
  return (
    <section aria-label="Figures">
      <ul className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {tiles.map(t => (
          <li key={t.label}>
            <Link href={t.href} className={`${box} group flex h-full flex-col gap-1 p-4 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300 leading-snug">{t.label}</span>
                {t.status && <StatusBadge status={t.status} />}
              </div>
              <span className={`${mono} text-3xl font-bold text-gray-900 dark:text-white`}>{t.value.toLocaleString("en-GB")}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{t.sub}</span>
              <span className="mt-auto pt-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300 group-hover:underline">{t.go} →</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        The figures leave out voided receipts and check-ins not booked in yet, and the chip on each tile is the status it counts.
        &ldquo;Catalogued this week&rdquo; is totes and pallets marked catalogued since Monday.
      </p>
    </section>
  )
}

// ─── Recent receipts ─────────────────────────────────────────────────────────────────────

type ReceiptItem = Data["receipts"][number]

const receiptCustomer = (r: ReceiptItem) => personName(r.person, r.customer)
const receiptContents = (r: ReceiptItem) => {
  const totes = r.containers.filter(c => c.kind !== "pallet").length
  const pallets = r.containers.length - totes
  if (!totes && !pallets) return "Nothing on it yet"
  return [totes ? plural(totes, "tote") : null, pallets ? plural(pallets, "pallet") : null].filter(Boolean).join(", ")
}
const VoidChip = () => <span className="ml-2 rounded-full border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300">Void</span>

function SectionHead({ id, title, href, linkLabel }: { id: string; title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 id={id} className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
      <Link href={href} className="inline-flex items-center min-h-11 px-2 text-sm font-medium text-indigo-600 dark:text-indigo-300 hover:underline">{linkLabel} →</Link>
    </div>
  )
}

function RecentReceipts({ receipts }: { receipts: ReceiptItem[] }) {
  return (
    <section aria-labelledby="recent-receipts">
      <SectionHead id="recent-receipts" title="Recent receipts" href="/tools/warehouse/receipts" linkLabel="All receipts" />
      {receipts.length === 0 ? (
        <Empty>No receipts yet. Press <b>Book goods in</b> to book the first customer&apos;s goods in.</Empty>
      ) : (
        <>
          {/* Phones and upright iPads: cards */}
          <ul className="md:hidden space-y-2">
            {receipts.map(r => (
              <li key={r.id}>
                <Link href={`/tools/warehouse/receipts/${encodeURIComponent(r.id)}`} className={`${box} block p-3 hover:border-indigo-400 dark:hover:border-indigo-500`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`${mono} text-base font-bold text-gray-900 dark:text-white`}>{r.id}{r.status === "void" && <VoidChip />}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{ukDateTime(r.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-800 dark:text-gray-200 mt-1 truncate">{receiptCustomer(r)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{receiptContents(r)} · booked by {r.createdByName || "—"}</p>
                </Link>
              </li>
            ))}
          </ul>
          {/* Wider: a table */}
          <div className={`${box} hidden md:block overflow-x-auto`}>
            <table className="w-full">
              <thead className="border-b border-gray-200 dark:border-gray-800">
                <tr><th className={th}>Receipt</th><th className={th}>Customer</th><th className={th}>Totes &amp; pallets</th><th className={th}>Booked by</th><th className={th}>When</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {receipts.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className={`${td} whitespace-nowrap`}>
                      <Link href={`/tools/warehouse/receipts/${encodeURIComponent(r.id)}`} className={`${mono} font-bold text-indigo-700 dark:text-indigo-300 hover:underline`}>{r.id}</Link>
                      {r.status === "void" && <VoidChip />}
                    </td>
                    <td className={td}>{receiptCustomer(r)}</td>
                    <td className={`${td} whitespace-nowrap`}>{receiptContents(r)}</td>
                    <td className={td}>{r.createdByName || "—"}</td>
                    <td className={`${td} whitespace-nowrap text-gray-500 dark:text-gray-400`}>{ukDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

// ─── Recent moves ────────────────────────────────────────────────────────────────────────

function RecentMoves({ moves }: { moves: MoveRow[] }) {
  return (
    <section aria-labelledby="recent-moves">
      <SectionHead id="recent-moves" title="Recent moves" href="/tools/warehouse/history" linkLabel="Full history" />
      {moves.length === 0 ? (
        <Empty>Nothing has been moved yet. Totes, pallets and lots appear here as they&apos;re put away or moved in <b>Move</b>.</Empty>
      ) : (
        <>
          <ul className="md:hidden space-y-2">
            {moves.map(m => (
              <li key={m.id} className={`${box} p-3`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Link href={findHref(moveItem(m))} className={`${mono} text-base font-bold text-indigo-700 dark:text-indigo-300 hover:underline truncate`}>{moveItem(m)}</Link>
                    <MoveKindChip kind={moveKind(m)} />
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{ukDateTime(m.movedAt)}</span>
                </div>
                <div className="text-sm mt-1.5"><FromTo m={m} /></div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">by {m.movedByName || "—"}</p>
              </li>
            ))}
          </ul>
          <div className={`${box} hidden md:block overflow-x-auto`}>
            <table className="w-full">
              <thead className="border-b border-gray-200 dark:border-gray-800">
                <tr><th className={th}>Item</th><th className={th}>From → to</th><th className={th}>Who</th><th className={th}>When</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {moves.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="inline-flex items-center gap-2">
                        <Link href={findHref(moveItem(m))} className={`${mono} font-bold text-indigo-700 dark:text-indigo-300 hover:underline`}>{moveItem(m)}</Link>
                        <MoveKindChip kind={moveKind(m)} />
                      </span>
                    </td>
                    <td className={td}><FromTo m={m} /></td>
                    <td className={td}>{m.movedByName || "—"}</td>
                    <td className={`${td} whitespace-nowrap text-gray-500 dark:text-gray-400`}>{ukDateTime(m.movedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
