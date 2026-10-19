import Link from "next/link"
import Form from "next/form"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { normaliseCode } from "@/lib/goods-in/model"
import { Empty, ErrorBox, NotReady, PageHeader, box, btn, btnGo, input, isMissingTable, label, mono, td, th, ukDate, ukDateTime } from "../_components/ui"
import { addDaysYmd, isYmd, londonDayStart, londonYmd } from "./london-days"
import { FromCell, LocationLink, MOVE_SELECT, MoveKindChip, findHref, moveItem, moveKind, type MoveRow } from "./move-parts"

// Goods In → History: every move of a tote, pallet or lot, newest first, 100 to a page.
//
// Server-rendered from the URL: the filters are a plain GET form (?item=&location=&from=&to=&page=),
// so a filtered view can be bookmarked or sent to someone, Back works, and a scanner's Enter in the
// item box simply submits. Days are LONDON days (history/london-days.ts) — the warehouse's calendar,
// not the server's UTC one.

export const dynamic = "force-dynamic"
export const metadata = { title: "Goods In — History" }

const PAGE_SIZE = 100
const PATH = "/tools/warehouse/history"

type SearchParams = Promise<Record<string, string | string[] | undefined>>
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim()

type Filters = { item: string; location: string; from: string; to: string }

function hrefFor(f: Filters, page = 1) {
  const q = new URLSearchParams()
  if (f.item) q.set("item", f.item)
  if (f.location) q.set("location", f.location)
  if (f.from) q.set("from", f.from)
  if (f.to) q.set("to", f.to)
  if (page > 1) q.set("page", String(page))
  const s = q.toString()
  return s ? `${PATH}?${s}` : PATH
}

type LotInfo = { title: string; auction: string | null }

export default async function GoodsInHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams

  // ── Read the filters ──
  const item = normaliseCode(one(sp.item)).slice(0, 40)
  const location = normaliseCode(one(sp.location)).slice(0, 24)
  const rawFrom = one(sp.from)
  const rawTo = one(sp.to)
  let from = isYmd(rawFrom) ? rawFrom : ""
  let to = isYmd(rawTo) ? rawTo : ""
  const ignoredDate = (rawFrom && !from) || (rawTo && !to)
  let swapped = false
  if (from && to && from > to) { [from, to] = [to, from]; swapped = true }
  const filters: Filters = { item, location, from, to }
  const filtered = !!(item || location || from || to)
  const pageAsked = Math.max(1, Math.floor(Number(one(sp.page)) || 1))

  const and: Prisma.GoodsInMovementWhereInput[] = []
  if (item) and.push({ OR: [{ containerId: { contains: item, mode: "insensitive" } }, { barcode: { contains: item, mode: "insensitive" } }] })
  if (location) and.push({ OR: [{ locationCode: { startsWith: location } }, { fromCode: { startsWith: location } }] })
  if (from) and.push({ movedAt: { gte: londonDayStart(from) } })
  if (to) and.push({ movedAt: { lt: londonDayStart(addDaysYmd(to, 1)) } })
  const where: Prisma.GoodsInMovementWhereInput = and.length ? { AND: and } : {}

  // ── Load ──
  let rows: MoveRow[] = []
  let total = 0
  let page = pageAsked
  let lastPage = 1
  let notReady = false
  let error: string | null = null
  const lots = new Map<string, LotInfo>()
  try {
    total = await prisma.goodsInMovement.count({ where })
    lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
    page = Math.min(pageAsked, lastPage)
    rows = await prisma.goodsInMovement.findMany({
      where,
      orderBy: [{ movedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: MOVE_SELECT,
    })
  } catch (e) {
    if (isMissingTable(e)) notReady = true
    else {
      console.error("goods-in history error:", e)
      error = String((e as { message?: string })?.message ?? e).slice(0, 300)
    }
  }

  // The lots' titles, so a barcode on its own isn't a mystery. Nice to have — a failure here
  // leaves the barcodes showing rather than the whole page failing.
  const lotIds = [...new Set(rows.map(r => r.lotId).filter((x): x is string => !!x))]
  if (lotIds.length) {
    try {
      const found = await prisma.catalogueLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, title: true, auction: { select: { code: true } } } })
      for (const l of found) lots.set(l.id, { title: l.title, auction: l.auction?.code ?? null })
    } catch (e) {
      console.error("goods-in history lot titles:", e)
    }
  }

  const today = londonYmd()
  const quick: { label: string; f: Filters }[] = [
    { label: "Today", f: { ...filters, from: today, to: today } },
    { label: "Last 7 days", f: { ...filters, from: addDaysYmd(today, -6), to: today } },
    { label: "Last 30 days", f: { ...filters, from: addDaysYmd(today, -29), to: today } },
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="History"
        intro="Every move of a tote, pallet or lot — where it went, where it came from, who moved it and when. Newest first."
      />

      {notReady ? <NotReady /> : (
        <div className="space-y-5">
          {/* ── Filters (a GET form: the URL is the view) ── */}
          <section className={`${box} p-4 sm:p-5`} aria-label="Filter the history">
            <Form action={PATH} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
              <div>
                <label htmlFor="h-item" className={label}>Item — tote, pallet or lot barcode</label>
                <input id="h-item" name="item" defaultValue={item} placeholder="e.g. T027657" autoComplete="off" autoCapitalize="characters" spellCheck={false} className={`${input} ${mono}`} />
              </div>
              <div>
                <label htmlFor="h-location" className={label}>Location — or the start of one</label>
                <input id="h-location" name="location" defaultValue={location} placeholder="e.g. A1 or BENCH3" autoComplete="off" autoCapitalize="characters" spellCheck={false} className={`${input} ${mono}`} />
              </div>
              <div>
                <label htmlFor="h-from" className={label}>From (day)</label>
                <input id="h-from" name="from" type="date" defaultValue={from} max={today} className={`${input} dark:[color-scheme:dark]`} />
              </div>
              <div>
                <label htmlFor="h-to" className={label}>To (day)</label>
                <input id="h-to" name="to" type="date" defaultValue={to} max={today} className={`${input} dark:[color-scheme:dark]`} />
              </div>
              <div className="flex gap-2 sm:col-span-2 xl:col-span-1">
                <button type="submit" className={`${btnGo} flex-1 xl:flex-none`}>Show moves</button>
                {filtered && <Link href={PATH} className={btn}>Clear</Link>}
              </div>
            </Form>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Quick dates:</span>
              {quick.map(q => (
                <Link key={q.label} href={hrefFor(q.f)} className="inline-flex items-center min-h-11 px-3 rounded-full border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">
                  {q.label}
                </Link>
              ))}
              <span className="basis-full sm:basis-auto sm:ml-2">A location matches moves into it and out of it. Days are UK days.</span>
            </div>
          </section>

          {ignoredDate && <ErrorBox>A date couldn&apos;t be read and was left out — pick it again from the calendar.</ErrorBox>}
          {swapped && <p className="text-sm text-amber-700 dark:text-amber-300">The From day was after the To day, so they&apos;ve been swapped round.</p>}
          {error && <ErrorBox>The history couldn&apos;t be loaded: {error}</ErrorBox>}

          {!error && (
            <>
              <Summary total={total} page={page} filters={filters} filtered={filtered} />
              {rows.length > 0 && (
                <>
                  <Pager page={page} lastPage={lastPage} filters={filters} />
                  <MoveCards rows={rows} lots={lots} />
                  <MoveTable rows={rows} lots={lots} />
                  <Pager page={page} lastPage={lastPage} filters={filters} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── What's showing, in words ────────────────────────────────────────────────────────────

function describe(f: Filters) {
  const parts: string[] = []
  if (f.item) parts.push(`items matching ${f.item}`)
  if (f.location) parts.push(`locations starting ${f.location}`)
  if (f.from && f.to) parts.push(f.from === f.to ? `on ${ukDate(londonDayStart(f.from))}` : `from ${ukDate(londonDayStart(f.from))} to ${ukDate(londonDayStart(f.to))}`)
  else if (f.from) parts.push(`since ${ukDate(londonDayStart(f.from))}`)
  else if (f.to) parts.push(`up to ${ukDate(londonDayStart(f.to))}`)
  return parts.join(", ")
}

function Summary({ total, page, filters, filtered }: { total: number; page: number; filters: Filters; filtered: boolean }) {
  if (total === 0) {
    return filtered
      ? <Empty>No moves for {describe(filters)}. <Link href={PATH} className="underline text-indigo-600 dark:text-indigo-300">Clear the filters</Link> to see everything.</Empty>
      : <Empty>Nothing has been moved yet. Every time a tote, pallet or lot is put away or moved in <b>Move</b>, it appears here.</Empty>
  }
  const first = (page - 1) * PAGE_SIZE + 1
  const last = Math.min(total, page * PAGE_SIZE)
  return (
    <p className="text-sm text-gray-600 dark:text-gray-300" role="status">
      Showing <b className={mono}>{first.toLocaleString("en-GB")}–{last.toLocaleString("en-GB")}</b> of <b className={mono}>{total.toLocaleString("en-GB")}</b> {total === 1 ? "move" : "moves"}
      {filtered && <> for {describe(filters)}</>}.
    </p>
  )
}

function Pager({ page, lastPage, filters }: { page: number; lastPage: number; filters: Filters }) {
  if (lastPage <= 1) return null
  // The receipts list's disabled look: the same button, faded — readable in dark mode (RULES design rule 2).
  const off = `${btn} opacity-40 pointer-events-none`
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-2">
        {page > 1 ? <Link href={hrefFor(filters, 1)} className={btn}>« Newest</Link> : <span className={off} aria-disabled="true">« Newest</span>}
        {page > 1 ? <Link href={hrefFor(filters, page - 1)} className={btn} rel="prev">‹ Newer</Link> : <span className={off} aria-disabled="true">‹ Newer</span>}
      </div>
      <span className="text-sm text-gray-600 dark:text-gray-300">Page <b className={mono}>{page}</b> of <b className={mono}>{lastPage}</b></span>
      <div className="flex gap-2">
        {page < lastPage ? <Link href={hrefFor(filters, page + 1)} className={btn} rel="next">Older ›</Link> : <span className={off} aria-disabled="true">Older ›</span>}
        {page < lastPage ? <Link href={hrefFor(filters, lastPage)} className={btn}>Oldest »</Link> : <span className={off} aria-disabled="true">Oldest »</span>}
      </div>
    </nav>
  )
}

// ─── The moves ───────────────────────────────────────────────────────────────────────────

function ItemCell({ m, lots }: { m: MoveRow; lots: Map<string, LotInfo> }) {
  const code = moveItem(m)
  const lot = m.lotId ? lots.get(m.lotId) : undefined
  return (
    <div className="min-w-0">
      <Link href={findHref(code)} className={`${mono} font-bold text-indigo-700 dark:text-indigo-300 hover:underline`}>{code}</Link>
      {lot && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1 max-w-xs" title={lot.title}>
          {lot.auction && <span className={`${mono} mr-1.5`}>{lot.auction}</span>}{lot.title}
        </p>
      )}
    </div>
  )
}

/** Phones and upright iPads: one card per move. */
function MoveCards({ rows, lots }: { rows: MoveRow[]; lots: Map<string, LotInfo> }) {
  return (
    <ul className="md:hidden space-y-2">
      {rows.map(m => (
        <li key={m.id} className={`${box} p-3`}>
          <div className="flex items-start justify-between gap-2">
            <ItemCell m={m} lots={lots} />
            <MoveKindChip kind={moveKind(m)} />
          </div>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <span className="text-gray-500 dark:text-gray-400">From</span><span><FromCell m={m} /></span>
            <span className="text-gray-500 dark:text-gray-400">To</span><span><LocationLink code={m.locationCode} /></span>
            <span className="text-gray-500 dark:text-gray-400">When</span><span className="text-gray-800 dark:text-gray-200">{ukDateTime(m.movedAt)}</span>
            <span className="text-gray-500 dark:text-gray-400">Who</span><span className="text-gray-800 dark:text-gray-200">{m.movedByName || "—"}</span>
          </div>
          {m.note && <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words border-t border-gray-100 dark:border-gray-800 pt-2">{m.note}</p>}
        </li>
      ))}
    </ul>
  )
}

/** Wider screens: the full-width table. */
function MoveTable({ rows, lots }: { rows: MoveRow[]; lots: Map<string, LotInfo> }) {
  return (
    <div className={`${box} hidden md:block overflow-x-auto`}>
      <table className="w-full">
        <thead className="border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th className={th}>When</th>
            <th className={th}>Item</th>
            <th className={th}>Kind</th>
            <th className={th}>From</th>
            <th className={th}>To</th>
            <th className={th}>Who</th>
            <th className={th}>Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(m => (
            <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className={`${td} whitespace-nowrap text-gray-600 dark:text-gray-300`}>{ukDateTime(m.movedAt)}</td>
              <td className={td}><ItemCell m={m} lots={lots} /></td>
              <td className={td}><MoveKindChip kind={moveKind(m)} /></td>
              <td className={`${td} whitespace-nowrap`}><FromCell m={m} /></td>
              <td className={`${td} whitespace-nowrap`}><LocationLink code={m.locationCode} /></td>
              <td className={td}>{m.movedByName || "—"}</td>
              <td className={`${td} min-w-48 max-w-md whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300`}>{m.note || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
