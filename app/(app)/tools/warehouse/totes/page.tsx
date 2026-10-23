import Link from "next/link"
import Form from "next/form"
import { prisma } from "@/lib/prisma"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { personName } from "@/lib/goods-in/customer-row"
import { CONTAINER_STATUS, LOCATION_KINDS, type ContainerStatus } from "@/lib/goods-in/model"
import { HUB_OWNS_WAREHOUSE } from "@/lib/customers/ownership"
import { isFromBc } from "@/lib/goods-in/source"
import { mirrorStatus } from "@/lib/goods-in/bc-mirror"
import {
  TOTE_PAGE_SIZE, TOTE_SELECT, TOTE_SORTS, TOTE_SORT_LABEL, parseToteFilter, toteFilterActive, toteFilterQuery, toteOrderBy, toteWhere, type ToteFilter, type ToteSort,
} from "@/lib/goods-in/tote-list"
import { Empty, ErrorBox, NotReady, PageHeader, StatusKey, box, btn, btnGo, input, isMissingTable, label, mono, th, ukDateTime } from "../_components/ui"
import ToteRow, { type ToteRowData } from "./tote-row"

// Goods In → Totes & pallets: the warehouse database (Jordan, 2026-10-23: "I want to see that
// warehouse database fully filterable editable and searchable"). Every tote and pallet the Hub
// holds — booked in here, and BC's, copied in nightly (lib/goods-in/bc-mirror.ts) — in one list:
// search across number, receipt, customer, category, description and location; filters down the
// side (status, kind, booked in Hub/BC, location, location kind, receipt, dates, label not printed);
// sortable columns; 100 a page; a CSV of exactly what's filtered. Each row's category, description
// and status are edited in place (updateContainer) — for a BC row only once the Hub owns the
// warehouse records (WAREHOUSE_OWNER=hub). The filter is in the URL (lib/goods-in/tote-list.ts).
// Nothing here reads or writes Business Central.

export const dynamic = "force-dynamic"
export const metadata = { title: "Totes & pallets · Goods In" }

const BASE = "/tools/warehouse/totes"
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`

type Facets = { status: Record<string, number>; kind: Record<string, number>; source: Record<string, number> }

export default async function TotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const me = await getGoodsInUser()
  if (!me) {
    return <div className="p-4 sm:p-6 lg:p-8"><PageHeader title="Totes & pallets" /><ErrorBox>Your account doesn&apos;t have Warehouse access.</ErrorBox></div>
  }
  const f = parseToteFilter(sp)
  const where = toteWhere(f)

  let rows: ToteRowData[] = []
  let total = 0
  let totes = 0
  let facets: Facets = { status: {}, kind: {}, source: {} }
  let problem: "migrate" | string | null = null
  let bc: Awaited<ReturnType<typeof mirrorStatus>> | null = null
  try {
    const [n, byKind, found, fStatus, fKind, fSource, mirror] = await Promise.all([
      prisma.goodsInContainer.count({ where }),
      prisma.goodsInContainer.groupBy({ by: ["kind"], where, _count: { _all: true } }),
      prisma.goodsInContainer.findMany({ where, orderBy: toteOrderBy(f), skip: (f.page - 1) * TOTE_PAGE_SIZE, take: TOTE_PAGE_SIZE, select: TOTE_SELECT }),
      // "What you'd get if you picked this" — each facet counted with its own choice cleared.
      prisma.goodsInContainer.groupBy({ by: ["status"], where: toteWhere(f, "status"), _count: { _all: true } }),
      prisma.goodsInContainer.groupBy({ by: ["kind"], where: toteWhere(f, "kind"), _count: { _all: true } }),
      prisma.goodsInContainer.groupBy({ by: ["source"], where: toteWhere(f, "source"), _count: { _all: true } }),
      mirrorStatus(),
    ])
    total = n
    totes = byKind.find(k => k.kind === "tote")?._count._all ?? 0
    bc = mirror
    for (const g of fStatus) facets.status[g.status ?? "booked"] = (facets.status[g.status ?? "booked"] ?? 0) + g._count._all
    for (const g of fKind) facets.kind[g.kind] = g._count._all
    for (const g of fSource) { const k = g.source === "bc" ? "bc" : "hub"; facets.source[k] = (facets.source[k] ?? 0) + g._count._all }

    const codes = [...new Set(found.map(c => c.locationCode).filter((c): c is string => !!c))]
    const locs = codes.length ? await prisma.goodsInLocation.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } }) : []
    const locName = new Map(locs.map(l => [l.code, l.name]))
    rows = found.map(c => {
      const bcRow = isFromBc(c.source) || isFromBc(c.receipt.source)
      const rs = c.receipt.status
      const lockedWhy = bcRow && !HUB_OWNS_WAREHOUSE ? "From BC — changed in BC until the Hub takes over." : rs === "draft" ? "On a check-in not booked in yet — changed in Check in." : rs === "void" ? "On a voided receipt." : null
      return {
        id: c.id, kind: c.kind, category: c.category, description: c.description, status: c.status,
        locationCode: c.locationCode, locationKind: c.locationKind, locationName: c.locationCode ? locName.get(c.locationCode) ?? null : null,
        movedAt: c.movedAt?.toISOString() ?? null, labelPrintedAt: c.labelPrintedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(), source: c.source,
        receiptId: c.receiptId, receiptStatus: rs, vendorNo: c.receipt.vendorNo, customerId: c.receipt.customerId,
        customerName: personName(c.receipt.person, c.receipt.customer),
        canEdit: !lockedWhy, lockedWhy,
      }
    })
  } catch (e) {
    if (isMissingTable(e)) problem = "migrate"
    else { console.error("goods-in totes list error:", e); problem = String((e as { message?: string })?.message ?? e).slice(0, 300) }
  }

  const pages = Math.max(1, Math.ceil(total / TOTE_PAGE_SIZE))
  const page = Math.min(f.page, pages)
  const href = (over: Partial<ToteFilter>) => `${BASE}${toteFilterQuery(f, over)}`
  const sortHref = (s: ToteSort) => href({ sort: s, dir: f.sort === s ? (f.dir === "asc" ? "desc" : "asc") : (s === "created" || s === "moved" ? "desc" : "asc") })
  const active = toteFilterActive(f)
  const chip = (on: boolean) => `inline-flex items-center justify-between gap-2 min-h-11 w-full px-3 rounded-lg border text-sm transition-colors ${on ? "bg-indigo-600 border-indigo-600 text-white font-semibold" : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"}`
  const count = (n: number | undefined, on: boolean) => <span className={`${mono} text-xs ${on ? "text-indigo-100" : "text-gray-500 dark:text-gray-400"}`}>{(n ?? 0).toLocaleString("en-GB")}</span>

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Totes & pallets"
        intro="The warehouse database — every tote and pallet the Hub holds, the Hub's own and Business Central's copied in nightly. Search, filter, sort, edit what's in one, and export exactly what's on screen."
        actions={
          <span className="flex flex-wrap gap-2">
            <a href={`/api/goods-in/totes/export${toteFilterQuery(f)}`} className={btn}>⬇ Export CSV</a>
            <Link href="/tools/warehouse/check-in" className={btnGo}>Book goods in</Link>
          </span>
        }
      />

      {problem === "migrate" ? <NotReady /> : problem ? <ErrorBox>Couldn&apos;t load the totes: {problem}</ErrorBox> : (
        <div className="grid gap-5 xl:grid-cols-[290px_minmax(0,1fr)] items-start">
          {/* ── Filters ── */}
          <aside className={`${box} p-4 space-y-5 xl:sticky xl:top-4`} aria-label="Filters">
            <Form action={BASE} className="space-y-3">
              {f.kind && <input type="hidden" name="kind" value={f.kind} />}
              {f.status && <input type="hidden" name="status" value={f.status} />}
              {f.source && <input type="hidden" name="source" value={f.source} />}
              {f.sort !== "created" && <input type="hidden" name="sort" value={f.sort} />}
              {f.dir !== "desc" && <input type="hidden" name="dir" value={f.dir} />}
              <div>
                <label htmlFor="tq" className={label}>Search</label>
                <input id="tq" name="q" defaultValue={f.q} className={input} placeholder="Number, receipt, customer, category, location…" autoComplete="off" enterKeyHint="search" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="tloc" className={label}>Location</label>
                  <input id="tloc" name="loc" defaultValue={f.loc} className={`${input} font-mono`} placeholder="e.g. 12F" autoComplete="off" />
                </div>
                <div>
                  <label htmlFor="tlk" className={label}>Location kind</label>
                  <select id="tlk" name="lockind" defaultValue={f.lockind} className={`${input} dark:[color-scheme:dark]`}>
                    <option value="">Any</option>
                    {LOCATION_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                    <option value="none">Not put anywhere</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="trc" className={label}>Receipt</label>
                <input id="trc" name="receipt" defaultValue={f.receipt} className={`${input} font-mono`} placeholder="R010244" autoComplete="off" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="tfrom" className={label}>Booked from</label>
                  <input id="tfrom" type="date" name="from" defaultValue={f.from} className={`${input} dark:[color-scheme:dark]`} />
                </div>
                <div>
                  <label htmlFor="tto" className={label}>Booked up to</label>
                  <input id="tto" type="date" name="to" defaultValue={f.to} className={`${input} dark:[color-scheme:dark]`} />
                </div>
              </div>
              <label className="flex items-center gap-2 min-h-11 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" name="nolabel" value="1" defaultChecked={f.nolabel} className="w-5 h-5" /> Label not printed</label>
              <label className="flex items-center gap-2 min-h-11 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" name="all" value="1" defaultChecked={f.all} className="w-5 h-5" /> Include voided and unfinished</label>
              <div className="flex gap-2">
                <button type="submit" className={`${btnGo} flex-1`}>Apply</button>
                {active && <Link href={BASE} className={`${btn} flex-1`}>Clear all</Link>}
              </div>
            </Form>

            <div>
              <p className={label}>Status</p>
              <div className="grid gap-1.5">
                <Link href={href({ status: "" })} className={chip(!f.status)} aria-current={!f.status ? "page" : undefined}><span>Any</span>{count(Object.values(facets.status).reduce((a, b) => a + b, 0), !f.status)}</Link>
                {(Object.keys(CONTAINER_STATUS) as ContainerStatus[]).map(s => (
                  <Link key={s} href={href({ status: f.status === s ? "" : s })} className={chip(f.status === s)} aria-current={f.status === s ? "page" : undefined}>
                    <span>{CONTAINER_STATUS[s].label}</span>{count(facets.status[s], f.status === s)}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className={label}>Kind</p>
              <div className="grid grid-cols-3 gap-1.5">
                <Link href={href({ kind: "" })} className={chip(!f.kind)}><span>Any</span></Link>
                <Link href={href({ kind: f.kind === "tote" ? "" : "tote" })} className={chip(f.kind === "tote")}><span>Totes</span>{count(facets.kind.tote, f.kind === "tote")}</Link>
                <Link href={href({ kind: f.kind === "pallet" ? "" : "pallet" })} className={chip(f.kind === "pallet")}><span>Pallets</span>{count(facets.kind.pallet, f.kind === "pallet")}</Link>
              </div>
            </div>
            <div>
              <p className={label}>Booked in</p>
              <div className="grid grid-cols-3 gap-1.5">
                <Link href={href({ source: "" })} className={chip(!f.source)}><span>Anywhere</span></Link>
                <Link href={href({ source: f.source === "hub" ? "" : "hub" })} className={chip(f.source === "hub")}><span>The Hub</span>{count(facets.source.hub, f.source === "hub")}</Link>
                <Link href={href({ source: f.source === "bc" ? "" : "bc" })} className={chip(f.source === "bc")}><span>BC</span>{count(facets.source.bc, f.source === "bc")}</Link>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {bc?.ready && bc.lastComplete
                  ? <>BC&apos;s copy: {ukDateTime(bc.lastComplete.completedAt ?? bc.lastComplete.startedAt)}. {HUB_OWNS_WAREHOUSE ? "The Hub owns these rows now." : "BC rows are read-only here until the Hub takes over."}</>
                  : bc?.ready ? <>BC&apos;s totes haven&apos;t been copied in yet — an admin runs it in Settings.</> : null}
              </p>
            </div>
          </aside>

          {/* ── Results ── */}
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <b className="text-gray-900 dark:text-white">{plural(total, "tote or pallet", "totes and pallets")}</b>{active ? " match" : ""}
                {total > 0 && <> · {plural(totes, "tote")} · {plural(total - totes, "pallet")}</>}
                {pages > 1 && <> · showing {((page - 1) * TOTE_PAGE_SIZE + 1).toLocaleString("en-GB")}–{Math.min(page * TOTE_PAGE_SIZE, total).toLocaleString("en-GB")}</>}
              </p>
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                Sort by
                <span className="flex flex-wrap gap-1">
                  {TOTE_SORTS.map(s => (
                    <Link key={s} href={sortHref(s)} className={`inline-flex items-center min-h-9 px-2.5 rounded-md text-xs font-medium border ${f.sort === s ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"}`} aria-current={f.sort === s ? "true" : undefined}>
                      {TOTE_SORT_LABEL[s]}{f.sort === s ? (f.dir === "asc" ? " ↑" : " ↓") : ""}
                    </Link>
                  ))}
                </span>
              </label>
            </div>

            {rows.length === 0 ? (
              <Empty>
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{active ? "Nothing matches these filters" : "No totes or pallets yet"}</p>
                <p className="mb-4">{active ? "Loosen a filter, or clear them all." : "They appear here once goods are booked in, or once BC's are copied in (Settings)."}</p>
                {active && <Link href={BASE} className={btn}>Clear the filters</Link>}
              </Empty>
            ) : (
              <div className={`${box} max-xl:border-0 max-xl:bg-transparent max-xl:dark:bg-transparent xl:overflow-x-auto`}>
                <table className="w-full max-xl:block">
                  <thead className="max-xl:hidden border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className={th}><Link href={sortHref("id")} className="hover:underline">Number{f.sort === "id" ? (f.dir === "asc" ? " ↑" : " ↓") : ""}</Link></th>
                      <th className={th}><Link href={sortHref("category")} className="hover:underline">What&apos;s in it{f.sort === "category" ? (f.dir === "asc" ? " ↑" : " ↓") : ""}</Link></th>
                      <th className={th}><Link href={sortHref("status")} className="hover:underline">Status{f.sort === "status" ? (f.dir === "asc" ? " ↑" : " ↓") : ""}</Link></th>
                      <th className={th}><Link href={sortHref("location")} className="hover:underline">Where it is{f.sort === "location" ? (f.dir === "asc" ? " ↑" : " ↓") : ""}</Link></th>
                      <th className={th}><Link href={sortHref("receipt")} className="hover:underline">Receipt · customer{f.sort === "receipt" ? (f.dir === "asc" ? " ↑" : " ↓") : ""}</Link></th>
                      <th className={th}><Link href={sortHref("created")} className="hover:underline">Booked{f.sort === "created" ? (f.dir === "asc" ? " ↑" : " ↓") : ""}</Link></th>
                      <th className={th}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  {rows.map(r => <ToteRow key={r.id} r={r} />)}
                </table>
              </div>
            )}

            {pages > 1 && (
              <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Pages">
                {page > 1 ? <Link href={href({ page: page - 1 })} className={btn}>← Previous</Link> : <span className={`${btn} opacity-40 pointer-events-none`} aria-disabled="true">← Previous</span>}
                <span className="text-sm text-gray-600 dark:text-gray-300">Page {page} of {pages}</span>
                {page < pages ? <Link href={href({ page: page + 1 })} className={btn}>Next →</Link> : <span className={`${btn} opacity-40 pointer-events-none`} aria-disabled="true">Next →</span>}
              </nav>
            )}

            <div className={`${box} p-4 space-y-2`}>
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">What the statuses mean</p>
              <StatusKey />
              <p className="text-xs text-gray-500 dark:text-gray-400">Totes on voided receipts and check-ins not booked in yet are left out unless you tick &ldquo;Include voided and unfinished&rdquo;. Edit, Move, Catalogued and Returned appear on rows that can be changed here; a BC row&apos;s say where it is changed. Export CSV gives every row the filters match{total > 50000 ? " (the first 50,000)" : ""}.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
