import Link from "next/link"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { normaliseCode } from "@/lib/goods-in/model"
import { box, btn, btnGo, mono, th, td, ukDate, PageHeader, Empty, NotReady, ErrorBox, isMissingTable } from "../_components/ui"
import CustomerSearchBox from "./new/search-box"

// Goods In → Customers. One search over the CRM's customer database (the same fields the counter's
// customer picker searches: name, postcode, email, phone, vendor number) run on the server, 50 to a
// page. With nothing searched it lists the customers who have booked goods in, most recent first.
// A scanned vendor-number card goes straight to that customer. Nothing here touches Business Central.

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50
const BASE = "/tools/warehouse/customers"

type Row = {
  id: string
  salutation: string | null
  name: string
  vendorNo: string | null
  town: string | null
  postcode: string | null
  email: string | null
  mobile: string | null
  phone: string | null
  receipts: number
  lastBooked: Date | null
}

/** A scanned or typed receipt / tote / pallet number — we say whose it is rather than "no customer found". */
type CodeHit = { what: "receipt" | "tote" | "pallet"; code: string; receiptId: string; customerId: string; customer: string }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""
const plural = (n: number, word: string) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`
const fullName = (r: { salutation: string | null; name: string }) => [r.salutation, r.name].filter(Boolean).join(" ")
const looksLikeCode = (code: string) => /^[A-Z]{1,3}\d{3,}$/.test(code)

/** The same fields searchCustomers looks through, with a little more forgiveness for how people type. */
function searchWhere(s: string): Prisma.ContactWhereInput {
  const like = { contains: s, mode: "insensitive" as const }
  const code = normaliseCode(s)
  const digits = s.replace(/\D/g, "")
  const words = s.split(/\s+/).filter(Boolean)
  const or: Prisma.ContactWhereInput[] = [
    { name: like }, { email: like }, { postcode: like }, { addressLine1: like }, { phone: like },
    { id: { equals: s, mode: "insensitive" } },
  ]
  // "Smith John" or "J Smith" still finds John Smith.
  if (words.length > 1) or.push({ AND: words.map(w => ({ name: { contains: w, mode: "insensitive" as const } })) })
  // A postcode typed without its space (TS176JJ) still finds TS17 6JJ.
  if (!/\s/.test(s) && /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/i.test(s)) or.push({ postcode: { contains: `${s.slice(0, -3)} ${s.slice(-3)}`, mode: "insensitive" } })
  // A phone number typed without its spaces.
  if (digits.length >= 5) or.push({ phone: { contains: digits } })
  const goodsIn: Prisma.GoodsInCustomerWhereInput[] = [{ vendorNo: { equals: code, mode: "insensitive" } }, { mobile: like }]
  if (code.length >= 3) goodsIn.push({ vendorNo: { contains: code, mode: "insensitive" } })
  if (digits.length >= 5) goodsIn.push({ mobile: { contains: digits } })
  or.push({ goodsInCustomer: { is: { OR: goodsIn } } })
  return { OR: or }
}

const CONTACT_INCLUDE = { goodsInCustomer: true, _count: { select: { goodsInReceipts: true } } } as const
type ContactWithGoodsIn = Prisma.ContactGetPayload<{ include: typeof CONTACT_INCLUDE }>

const toRow = (c: ContactWithGoodsIn, lastBooked: Date | null, receipts?: number): Row => ({
  id: c.id, salutation: c.salutation, name: c.name, vendorNo: c.goodsInCustomer?.vendorNo ?? null,
  town: c.goodsInCustomer?.town ?? null, postcode: c.postcode, email: c.email, mobile: c.goodsInCustomer?.mobile ?? null, phone: c.phone,
  receipts: receipts ?? c._count.goodsInReceipts, lastBooked,
})

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const q = one(sp.q).trim().slice(0, 100)
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1)
  const skip = (page - 1) * PAGE_SIZE

  const me = await getGoodsInUser()
  if (!me) {
    return <div className="p-4 sm:p-6 lg:p-8"><ErrorBox>Your account doesn&apos;t have Warehouse access. Ask a manager to add it.</ErrorBox></div>
  }

  const searching = q.length >= 2
  let rows: Row[] = []
  let total = 0
  let hit: CodeHit | null = null
  let goTo: string | null = null
  let missing = false
  let failed: string | null = null

  try {
    if (searching) {
      const code = normaliseCode(q)
      if (looksLikeCode(code)) {
        const [vendor, receipt, container] = await Promise.all([
          prisma.goodsInCustomer.findUnique({ where: { vendorNo: code }, select: { contactId: true } }),
          prisma.goodsInReceipt.findUnique({ where: { id: code }, select: { id: true, contactId: true, contact: { select: { name: true } } } }),
          prisma.goodsInContainer.findUnique({ where: { id: code }, select: { id: true, kind: true, receiptId: true, receipt: { select: { contactId: true, contact: { select: { name: true } } } } } }),
        ])
        // A scanned vendor-number card: straight to that customer.
        if (vendor) goTo = `${BASE}/${encodeURIComponent(vendor.contactId)}`
        else if (receipt) hit = { what: "receipt", code: receipt.id, receiptId: receipt.id, customerId: receipt.contactId, customer: receipt.contact.name }
        else if (container) hit = { what: container.kind === "pallet" ? "pallet" : "tote", code: container.id, receiptId: container.receiptId, customerId: container.receipt.contactId, customer: container.receipt.contact.name }
      }
      if (!goTo) {
        const where = searchWhere(q)
        const [contacts, count] = await Promise.all([
          prisma.contact.findMany({ where, include: CONTACT_INCLUDE, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take: PAGE_SIZE }),
          prisma.contact.count({ where }),
        ])
        total = count
        const ids = contacts.map(c => c.id)
        const last = ids.length
          ? await prisma.goodsInReceipt.groupBy({ by: ["contactId"], where: { contactId: { in: ids } }, _max: { createdAt: true } })
          : []
        const lastOf = new Map(last.map(l => [l.contactId, l._max.createdAt ?? null]))
        rows = contacts.map(c => toRow(c, lastOf.get(c.id) ?? null))
      }
    } else {
      // Nothing searched: the customers who have booked goods in, the most recently booked first.
      const [groups, count] = await Promise.all([
        prisma.goodsInReceipt.groupBy({
          by: ["contactId"],
          _max: { createdAt: true },
          _count: { _all: true },
          orderBy: { _max: { createdAt: "desc" } },
          skip,
          take: PAGE_SIZE,
        }),
        prisma.contact.count({ where: { goodsInReceipts: { some: {} } } }),
      ])
      total = count
      const contacts = groups.length
        ? await prisma.contact.findMany({ where: { id: { in: groups.map(g => g.contactId) } }, include: CONTACT_INCLUDE })
        : []
      const byId = new Map(contacts.map(c => [c.id, c]))
      rows = groups.flatMap(g => {
        const c = byId.get(g.contactId)
        return c ? [toRow(c, g._max.createdAt ?? null, g._count._all)] : []
      })
    }
  } catch (e) {
    if (isMissingTable(e)) missing = true
    else {
      console.error("goods-in customers list:", e)
      failed = "The customer list couldn't be loaded just now. Try again in a moment — if it keeps happening, tell Jack."
    }
  }

  // redirect() works by throwing, so it must sit outside the try/catch above.
  if (goTo) redirect(goTo)

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : skip + 1
  const to = Math.min(total, skip + rows.length)
  const pageHref = (p: number) => {
    const u = new URLSearchParams()
    if (q) u.set("q", q)
    if (p > 1) u.set("page", String(p))
    const s = u.toString()
    return s ? `${BASE}?${s}` : BASE
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <PageHeader
        title="Customers"
        intro="Find a customer to see their receipts, which of their totes and pallets are in the warehouse, and the lots made from them."
        actions={<Link href={`${BASE}/new`} className={btnGo}>+ New customer</Link>}
      />

      {/* A GET search: Enter (or a barcode scanner's Enter) searches; the address bar keeps it. */}
      <CustomerSearchBox q={q} action={BASE} />

      {missing && <NotReady />}
      {failed && <ErrorBox>{failed}</ErrorBox>}

      {!missing && !failed && (
        <>
          {q && !searching && (
            <p className="text-sm text-amber-700 dark:text-amber-300">Type at least two letters or numbers to search. Showing recent customers instead.</p>
          )}

          {hit && (
            <div className="rounded-lg border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-2">
              <span>
                <span className={`${mono} font-semibold`}>{hit.code}</span> is {hit.what === "receipt" ? "a receipt" : `a ${hit.what} on receipt `}
                {hit.what !== "receipt" && <span className={mono}>{hit.receiptId}</span>} for <b>{hit.customer}</b>.
              </span>
              <span className="flex flex-wrap gap-2">
                <Link href={`${BASE}/${encodeURIComponent(hit.customerId)}`} className={btn}>Open {hit.customer}</Link>
                <Link href={`/tools/warehouse/receipts/${encodeURIComponent(hit.receiptId)}`} className={btn}>Open receipt {hit.receiptId}</Link>
              </span>
            </div>
          )}

          {searching ? (
            // A scanned receipt or tote number is answered by the banner above, not "no customer matches".
            !(hit && total === 0) && (
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                {total === 0 ? <>No customer matches &ldquo;{q}&rdquo;</> : <>{plural(total, "customer")} {total === 1 ? "matches" : "match"} &ldquo;{q}&rdquo;</>}
              </h2>
            )
          ) : (
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Recently booked in</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
                Only customers who have booked goods in are listed here. The full customer database is the CRM&apos;s{" "}
                <Link href="/contacts" className="text-indigo-700 dark:text-indigo-300 underline">Contacts</Link> — the search above looks through all of it.
              </p>
            </div>
          )}

          {rows.length === 0 ? (
            total > 0 ? (
              <Empty>There&apos;s nothing on page {page}. <Link href={pageHref(1)} className="underline text-indigo-700 dark:text-indigo-300">Back to the first page</Link>.</Empty>
            ) : searching ? (
              !hit && (
                <Empty>
                  <p>Check the spelling, try their postcode or vendor number — or add them as a new customer.</p>
                  <Link href={`${BASE}/new`} className={`${btnGo} mt-4`}>+ New customer</Link>
                </Empty>
              )
            ) : (
              <Empty>Nobody has been booked in yet. Search above to find a customer in the CRM, or add a new one.</Empty>
            )
          ) : (
            <>
              {/* Phones: cards. */}
              <ul className="sm:hidden space-y-2">
                {rows.map(r => (
                  <li key={r.id} className={box}>
                    <Link href={`${BASE}/${encodeURIComponent(r.id)}`} className="block px-4 py-3 min-h-14 active:bg-gray-50 dark:active:bg-gray-800 rounded-xl">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-gray-900 dark:text-white min-w-0 break-words">{fullName(r)}</span>
                        {r.vendorNo && <span className={`${mono} text-xs text-indigo-700 dark:text-indigo-300 shrink-0`}>{r.vendorNo}</span>}
                      </div>
                      {(r.town || r.postcode) && <div className="text-sm text-gray-600 dark:text-gray-300">{[r.town, r.postcode].filter(Boolean).join(", ")}</div>}
                      {(r.email || r.mobile || r.phone) && <div className="text-sm text-gray-500 dark:text-gray-400 break-all">{[r.email, r.mobile ?? r.phone].filter(Boolean).join(" · ")}</div>}
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {plural(r.receipts, "receipt")}{r.lastBooked ? ` · last booked ${ukDate(r.lastBooked)}` : ""}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Tablets and desktops: a full-width table. */}
              <div className={`${box} hidden sm:block overflow-x-auto`}>
                <table className="w-full">
                  <thead className="border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className={th}>Name</th>
                      <th className={th}>Vendor no.</th>
                      <th className={th}>Town / postcode</th>
                      <th className={th}>Email / mobile</th>
                      <th className={th}>Receipts</th>
                      <th className={th}>Last booked</th>
                      <th className={th}><span className="sr-only">Book in</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                        <td className={td}>
                          <Link href={`${BASE}/${encodeURIComponent(r.id)}`} className="inline-flex items-center min-h-11 font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">
                            {fullName(r)}
                          </Link>
                        </td>
                        <td className={`${td} ${mono} whitespace-nowrap`}>{r.vendorNo ?? <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                        <td className={td}>
                          {r.town || r.postcode ? (
                            <>
                              {r.town && <div>{r.town}</div>}
                              {r.postcode && <div className="whitespace-nowrap text-gray-600 dark:text-gray-300">{r.postcode}</div>}
                            </>
                          ) : <span className="text-gray-500 dark:text-gray-400">—</span>}
                        </td>
                        <td className={`${td} max-w-xs`}>
                          {r.email && <div className="break-all">{r.email}</div>}
                          {(r.mobile ?? r.phone) && <div className="whitespace-nowrap text-gray-600 dark:text-gray-300">{r.mobile ?? r.phone}</div>}
                          {!r.email && !r.mobile && !r.phone && <span className="text-gray-500 dark:text-gray-400">—</span>}
                        </td>
                        <td className={`${td} ${mono}`}>{r.receipts.toLocaleString("en-GB")}</td>
                        <td className={`${td} whitespace-nowrap`}>{r.lastBooked ? ukDate(r.lastBooked) : <span className="text-gray-500 dark:text-gray-400">Never</span>}</td>
                        <td className={`${td} text-right`}>
                          <Link href={`/tools/warehouse/check-in?customer=${encodeURIComponent(r.id)}`} className={`${btn} whitespace-nowrap`}>Book in</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Showing {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")} of {plural(total, "customer")}
                  {pages > 1 ? ` · page ${page} of ${pages}` : ""}
                </p>
                {pages > 1 && (
                  <div className="flex gap-2">
                    {page > 1 ? <Link href={pageHref(page - 1)} className={btn}>← Previous</Link> : <span className={`${btn} opacity-40 pointer-events-none`} aria-disabled="true">← Previous</span>}
                    {page < pages ? <Link href={pageHref(page + 1)} className={btn}>Next →</Link> : <span className={`${btn} opacity-40 pointer-events-none`} aria-disabled="true">Next →</span>}
                  </div>
                )}
              </nav>
            </>
          )}
        </>
      )}
    </div>
  )
}
