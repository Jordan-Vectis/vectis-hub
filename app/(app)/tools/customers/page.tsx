import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import SyncPanel from "./sync-panel"
import CustomersList, { type RowDTO } from "./customers-list"
import { parseFilters, PAGE_SIZE } from "@/lib/customers/filters"
import { listCustomers, listFacets, tableExists } from "@/lib/customers/queries"

export const dynamic = "force-dynamic"
export const metadata = { title: "Customers" }

// Admin & Operations → Customers: the Hub's own customer database (one row per person — seller,
// buyer or both, ONE customer number), copied nightly from BC until the Hub takes over. Three tabs:
// the list (side filters + a preview of the selected person), a data check, and (admins) the copy
// from BC. Rules in RULES.md → "Customers".

type Search = Record<string, string | string[] | undefined>

function fmt(d: Date | null | undefined) {
  return d ? d.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null
}
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const session = await getEffectiveSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const tab = one(sp.tab) === "check" ? "check" : one(sp.tab) === "copy" && isAdmin ? "copy" : "list"

  let body: React.ReactNode
  try {
    body = tab === "check" ? await DataCheck() : tab === "copy" ? await CopyTab() : await List(sp, isAdmin)
  } catch (e: any) {
    console.error("[customers] page read failed:", e?.message)
    body = (
      <p className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-200">
        The customer database isn&apos;t set up on this environment yet — it needs Run Migrations. ({String(e?.message ?? "").slice(0, 160)})
      </p>
    )
  }

  const tabCls = (on: boolean) => `min-h-[44px] inline-flex items-center px-4 rounded-lg text-sm font-semibold ${on ? "bg-indigo-600 text-white" : "text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/5"}`
  return (
    <div className="p-6 w-full space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">👥 Customers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Everyone who sells or buys with Vectis — one record per person, one customer number. Copied from Business Central until the Hub takes over.</p>
        </div>
        <nav className="flex gap-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1">
          <Link href="/tools/customers" className={tabCls(tab === "list")}>Customers</Link>
          <Link href="/tools/customers?tab=check" className={tabCls(tab === "check")}>Data check</Link>
          {isAdmin && <Link href="/tools/customers?tab=copy" className={tabCls(tab === "copy")}>Copy from BC</Link>}
        </nav>
      </div>
      {body}
    </div>
  )
}

async function List(sp: Search, isAdmin: boolean) {
  const filters = parseFilters(sp)
  const notesReady = await tableExists("CustomerNote")
  const [{ rows, total }, facets] = await Promise.all([listCustomers(filters, notesReady), listFacets(notesReady)])
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  const dto: RowDTO[] = rows.map(r => ({ ...r, lastReceipt: iso(r.lastReceipt), lastNote: iso(r.lastNote), followUpAt: iso(r.followUpAt) }))
  return (
    <CustomersList rows={dto} total={total} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
      filters={filters} facets={facets} notesReady={notesReady} isAdmin={isAdmin} />
  )
}

async function CopyTab() {
  const last = await prisma.warehouseSyncLog.findFirst({ where: { source: "customers", status: "complete" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }).catch(() => null)
  return <SyncPanel lastRun={fmt(last?.completedAt)} />
}

// What needs tidying before anything depends on this data. Every figure links to the people behind it.
async function DataCheck() {
  const notBlank = (f: "email" | "postCode") => ({ AND: [{ [f]: { not: null } }, { NOT: { [f]: "" } }] })
  const [total, sellers, buyers, both, web, noEmail, noPostcode, blocked, orphanAddr, dupEmails, dupTotals, oddNos] = await Promise.all([
    prisma.customer.count(),
    prisma.customer.count({ where: { vendorNo: { not: null } } }),
    prisma.customer.count({ where: { buyerNo: { not: null } } }),
    prisma.customer.count({ where: { vendorNo: { not: null }, buyerNo: { not: null } } }),
    prisma.customer.count({ where: { websiteId: { not: null } } }),
    prisma.customer.count({ where: { NOT: notBlank("email") } }),
    prisma.customer.count({ where: { NOT: notBlank("postCode") } }),
    prisma.customer.count({ where: { blocked: { not: null } } }),
    prisma.customerShipTo.count({ where: { customerId: null } }),
    prisma.$queryRawUnsafe<{ email: string; n: bigint }[]>(
      `SELECT lower(trim("email")) AS email, count(*) AS n FROM "Customer" WHERE coalesce(trim("email"), '') <> '' GROUP BY 1 HAVING count(*) > 1 ORDER BY n DESC, 1 LIMIT 200`),
    // The true totals — the list above is only the first 200.
    prisma.$queryRawUnsafe<{ emails: bigint; records: bigint }[]>(
      `SELECT count(*) AS emails, coalesce(sum(n), 0) AS records FROM (SELECT count(*) AS n FROM "Customer" WHERE coalesce(trim("email"), '') <> '' GROUP BY lower(trim("email")) HAVING count(*) > 1) d`),
    // BC's contact "No." is free text — on a handful of records it holds a name or an email, not a C-number.
    prisma.$queryRawUnsafe<{ id: string; name: string | null; contactNo: string }[]>(
      `SELECT id, name, "contactNo" FROM "Customer" WHERE "contactNo" IS NOT NULL AND "contactNo" !~ '^C[0-9]+$' ORDER BY name LIMIT 50`),
  ])
  const dupEmailCount = Number(dupTotals[0]?.emails ?? 0)
  const dupPeople = Number(dupTotals[0]?.records ?? 0)
  const Tile = ({ label, value, href, warn }: { label: string; value: number; href?: string; warn?: boolean }) => {
    const inner = (
      <>
        <p className={`text-2xl font-bold ${warn && value > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>{value.toLocaleString()}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      </>
    )
    const cls = "rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 block"
    return href ? <Link href={href} className={`${cls} hover:border-indigo-400`}>{inner}</Link> : <div className={cls}>{inner}</div>
  }

  return (
    <div className="space-y-6">
      {total === 0 && <p className="text-sm text-gray-600 dark:text-gray-300">Nothing copied yet, so there&apos;s nothing to check. Run a copy first.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Tile label="People" value={total} href="/tools/customers" />
        <Tile label="Sellers" value={sellers} href="/tools/customers?type=seller" />
        <Tile label="Buyers" value={buyers} href="/tools/customers?type=buyer" />
        <Tile label="Both seller and buyer" value={both} href="/tools/customers?type=both" />
        <Tile label="With a website account" value={web} href="/tools/customers?type=web" />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">To tidy (amber = something to look at)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Tile label="Emails shared by more than one record" value={dupEmailCount} warn />
          <Tile label="Records involved in those" value={dupPeople} warn />
          <Tile label="No email address" value={noEmail} href="/tools/customers?noEmail=1" warn />
          <Tile label="No postcode" value={noPostcode} warn />
          <Tile label="Blocked in BC" value={blocked} href="/tools/customers?blocked=1" />
          <Tile label="Delivery addresses whose buyer isn't here" value={orphanAddr} warn />
          <Tile label="Contact no. in BC isn't a C-number" value={oddNos.length} warn />
        </div>
      </div>
      {oddNos.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Odd contact numbers — fix these in BC</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">BC&apos;s contact &ldquo;No.&rdquo; field is free text, and on these records it holds a name or an email instead of a C-number. The Hub shows their seller or buyer C-number instead until BC is corrected.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2">
            {oddNos.map(o => (
              <Link key={o.id} href={`/tools/customers/${o.id}`} className="flex justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm hover:border-indigo-400">
                <span className="truncate text-gray-800 dark:text-gray-200">{o.name ?? "(no name)"}</span>
                <span className="shrink-0 font-mono text-xs text-amber-600 dark:text-amber-400 truncate max-w-[50%]">{o.contactNo}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {dupEmails.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Likely duplicates — the same email on more than one record</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Often the same person with two BC accounts, or a couple sharing an inbox. Open one to see the records side by side.{dupEmailCount > dupEmails.length ? ` Showing the first ${dupEmails.length} of ${dupEmailCount.toLocaleString()}, most-shared first.` : ""}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2">
            {dupEmails.map(d => (
              <Link key={d.email} href={`/tools/customers?q=${encodeURIComponent(d.email)}`}
                className="flex justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm hover:border-indigo-400">
                <span className="truncate text-gray-800 dark:text-gray-200">{d.email}</span>
                <span className="shrink-0 font-semibold text-amber-600 dark:text-amber-400">{Number(d.n)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
