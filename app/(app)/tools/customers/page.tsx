import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import type { Prisma } from "@/app/generated/prisma/client"
import SyncPanel from "./sync-panel"

export const dynamic = "force-dynamic"
export const metadata = { title: "Customers" }

// Admin & Operations → Customers: the Hub's own customer database (one row per person — seller,
// buyer or both), copied nightly from BC until the Hub takes over. Tabs: the list, and a data check
// of what needs tidying before anything depends on it.

const PAGE = 100
type Search = { q?: string; type?: string; page?: string; tab?: string }

const TYPES: { key: string; label: string; where: Prisma.CustomerWhereInput }[] = [
  { key: "all",    label: "Everyone",        where: {} },
  { key: "seller", label: "Sellers",         where: { vendorNo: { not: null } } },
  { key: "buyer",  label: "Buyers",          where: { buyerNo: { not: null } } },
  { key: "both",   label: "Seller & buyer",  where: { vendorNo: { not: null }, buyerNo: { not: null } } },
  { key: "web",    label: "Website account", where: { websiteId: { not: null } } },
]

function fmt(d: Date | null | undefined) {
  return d ? d.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const session = await getEffectiveSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const tab = sp.tab === "check" ? "check" : "list"

  const last = await prisma.warehouseSyncLog.findFirst({ where: { source: "customers", status: "complete" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }).catch(() => null)

  let body: React.ReactNode
  try {
    body = tab === "check" ? await DataCheck() : await List(sp)
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
          <p className="text-sm text-gray-500 dark:text-gray-400">Everyone who sells or buys with Vectis — one record per person. Copied from Business Central until the Hub takes over.</p>
        </div>
        <nav className="flex gap-1">
          <Link href="/tools/customers" className={tabCls(tab === "list")}>Customers</Link>
          <Link href="/tools/customers?tab=check" className={tabCls(tab === "check")}>Data check</Link>
        </nav>
      </div>
      {isAdmin && <SyncPanel lastRun={fmt(last?.completedAt)} />}
      {body}
    </div>
  )
}

async function List(sp: Search) {
  const q = (sp.q ?? "").trim()
  const type = TYPES.find(t => t.key === sp.type) ?? TYPES[0]
  const page = Math.max(1, Number(sp.page) || 1)
  const where: Prisma.CustomerWhereInput = {
    ...type.where,
    ...(q ? {
      OR: ["name", "name2", "email", "postCode", "phone", "mobile", "contactNo", "vendorNo", "buyerNo", "city"].map(f => ({ [f]: { contains: q, mode: "insensitive" } })),
    } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where, orderBy: [{ name: "asc" }, { id: "asc" }], take: PAGE, skip: (page - 1) * PAGE,
      select: { id: true, name: true, name2: true, contactNo: true, vendorNo: true, buyerNo: true, email: true, phone: true, mobile: true, city: true, postCode: true, websiteId: true, blocked: true },
    }),
  ])
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const link = (p: Partial<Search>) => {
    const u = new URLSearchParams()
    const m = { q, type: type.key, page: String(page), ...p }
    if (m.q) u.set("q", m.q)
    if (m.type && m.type !== "all") u.set("type", m.type)
    if (m.page && m.page !== "1") u.set("page", m.page)
    return `/tools/customers${u.size ? `?${u}` : ""}`
  }

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2 items-center" action="/tools/customers">
        <input name="q" defaultValue={q} placeholder="Search name, email, postcode, phone, C… or buyer number"
          className="flex-1 min-w-[260px] min-h-[44px] px-4 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400" />
        {type.key !== "all" && <input type="hidden" name="type" value={type.key} />}
        <button className="min-h-[44px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">Search</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {TYPES.map(t => (
          <Link key={t.key} href={link({ type: t.key, page: "1" })}
            className={`min-h-[36px] inline-flex items-center px-3 rounded-full text-sm border ${t.key === type.key ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"}`}>
            {t.label}
          </Link>
        ))}
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {total === 0 ? (q ? `Nobody matches “${q}”.` : "No customers copied yet — press Copy customers now (admins) or wait for tonight's copy.") : `${total.toLocaleString()} ${total === 1 ? "person" : "people"}${q ? ` matching “${q}”` : ""}. Page ${page} of ${pages}.`}
      </p>
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Customer no.</th><th className="px-3 py-2">Sells / buys</th>
                <th className="px-3 py-2">Email</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Town / postcode</th><th className="px-3 py-2">Website</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                  <td className="px-3 py-2">
                    <Link href={`/tools/customers/${c.id}`} className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">{c.name || c.name2 || "(no name)"}</Link>
                    {c.blocked && <span className="ml-2 text-xs rounded px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">Blocked: {c.blocked}</span>}
                  </td>
                  {/* ⚠ These cells had no text colour, so the numbers were invisible on the dark theme
                      (2026-10-23). And BC gives a person ONE number — the contact no. is the vendor no.
                      and the customer no. in all but a few dozen of 208,000 — so it is shown once; the
                      rare different seller or buyer number is named beside it. */}
                  <td className="px-3 py-2 font-mono text-xs text-gray-800 dark:text-gray-200">
                    {c.contactNo ?? c.vendorNo ?? c.buyerNo ?? "—"}
                    {c.vendorNo && c.vendorNo !== c.contactNo && <span className="block text-gray-500 dark:text-gray-400">seller {c.vendorNo}</span>}
                    {c.buyerNo && c.buyerNo !== c.contactNo && <span className="block text-gray-500 dark:text-gray-400">buyer {c.buyerNo}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
                    {[c.vendorNo && "Seller", c.buyerNo && "Buyer"].filter(Boolean).join(" & ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{c.email ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{c.mobile || c.phone || "—"}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{[c.city, c.postCode].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{c.websiteId ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex gap-2">
          {page > 1 && <Link href={link({ page: String(page - 1) })} className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm">← Previous</Link>}
          {page < pages && <Link href={link({ page: String(page + 1) })} className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm">Next →</Link>}
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">Customer no. = the person&apos;s BC number (C…), the same for selling and buying · ✓ = has an account on the website.</p>
    </div>
  )
}

// What needs tidying before anything depends on this data. Every figure links to the people behind it.
async function DataCheck() {
  const notBlank = (f: "email" | "postCode") => ({ AND: [{ [f]: { not: null } }, { NOT: { [f]: "" } }] })
  const [total, sellers, buyers, both, web, noEmail, noPostcode, blocked, orphanAddr, dupEmails, dupTotals] = await Promise.all([
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
          <Tile label="No email address" value={noEmail} warn />
          <Tile label="No postcode" value={noPostcode} warn />
          <Tile label="Blocked in BC" value={blocked} />
          <Tile label="Delivery addresses whose buyer isn't here" value={orphanAddr} warn />
        </div>
      </div>
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
