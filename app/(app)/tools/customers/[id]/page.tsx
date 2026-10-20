import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// One customer: their details, what they've consigned (BC receipts, totes, lots — from the Hub's
// copies, linked by their seller number), their buyer settings and delivery addresses, and every
// field BC sent about them.

const yesNo = (v: boolean | null | undefined) => (v == null ? null : v ? "Yes" : "No")

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === "") return null
  return (
    <div className="flex gap-3 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0 text-sm">
      <dt className="w-44 shrink-0 text-gray-500 dark:text-gray-400">{k}</dt>
      <dd className="text-gray-900 dark:text-gray-100 break-words min-w-0">{v}</dd>
    </div>
  )
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{title}</h2>
      {children}
    </section>
  )
}
function Raw({ label, data }: { label: string; data: unknown }) {
  if (!data || typeof data !== "object") return null
  const entries = Object.entries(data as Record<string, unknown>).filter(([k]) => !k.startsWith("@odata"))
  return (
    <details className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200">{label} — {entries.length} fields</summary>
      <dl className="mt-2">{entries.map(([k, v]) => <Row key={k} k={k} v={v === null || v === "" ? <span className="text-gray-400">blank</span> : typeof v === "object" ? JSON.stringify(v) : String(v)} />)}</dl>
    </details>
  )
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await prisma.customer.findUnique({ where: { id }, include: { shipTo: { orderBy: { code: "asc" } } } }).catch(() => null)
  if (!c) notFound()

  // What they've consigned — from the BC copies the Hub already keeps, linked by seller number.
  const [receipts, lotCount, soldCount] = c.vendorNo
    ? await Promise.all([
        prisma.$queryRawUnsafe<{ receiptNo: string; totes: bigint; first: Date | null }[]>(
          `SELECT "receiptNo", count(*) AS totes, min("bcCreatedAt") AS first FROM "WarehouseReceiptTote"
           WHERE "vendorNo" = $1 GROUP BY "receiptNo" ORDER BY first DESC NULLS LAST LIMIT 50`, c.vendorNo).catch(() => []),
        prisma.warehouseItem.count({ where: { vendorNo: c.vendorNo } }).catch(() => 0),
        prisma.warehouseItem.count({ where: { vendorNo: c.vendorNo, hammerPrice: { gt: 0 } } }).catch(() => 0),
      ])
    : [[], 0, 0]

  const day = (d: Date | null) => d ? d.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }) : "—"

  return (
    <div className="p-6 w-full space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/tools/customers" className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-white/10 text-sm font-semibold text-gray-700 dark:text-gray-200">← Customers</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{c.name || c.name2 || "(no name)"}</h1>
        {c.vendorNo && <span className="text-xs font-semibold rounded-full px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200">Seller {c.vendorNo}</span>}
        {c.buyerNo && <span className="text-xs font-semibold rounded-full px-2 py-1 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">Buyer {c.buyerNo}</span>}
        {c.websiteId && <span className="text-xs font-semibold rounded-full px-2 py-1 bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200">Website account</span>}
        {c.blocked && <span className="text-xs font-semibold rounded-full px-2 py-1 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">Blocked: {c.blocked}</span>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Copied from Business Central{c.syncedAt ? ` — last ${c.syncedAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}` : ""}. BC is still in charge, so changes are made in BC for now.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Contact details">
          <dl>
            <Row k="Name" v={[c.name, c.name2].filter(Boolean).join(" · ")} />
            <Row k="Email" v={c.email} /><Row k="Second email" v={c.email2} />
            <Row k="Phone" v={c.phone} /><Row k="Mobile" v={c.mobile} /><Row k="Second mobile" v={c.mobile2} />
            <Row k="Address" v={[c.address, c.address2, c.address3, c.city, c.county, c.postCode, c.countryCode].filter(Boolean).join(", ")} />
            <Row k="VAT number" v={c.vatRegNo} /><Row k="EORI number" v={c.eoriNumber} /><Row k="Currency" v={c.currencyCode} />
            <Row k="BC contact no." v={c.contactNo} />
            <Row k="In BC since" v={c.bcCreatedAt ? day(c.bcCreatedAt) : null} />
          </dl>
        </Card>

        <Card title="As a seller">
          {c.vendorNo ? (
            <>
              <dl>
                <Row k="Seller no." v={c.vendorNo} />
                <Row k="Lots in BC" v={`${lotCount.toLocaleString()} (${soldCount.toLocaleString()} sold)`} />
                <Row k="Receipts" v={receipts.length === 50 ? "50+ (latest shown)" : receipts.length} />
              </dl>
              {receipts.length > 0 && (
                <div className="mt-3 max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-gray-500 dark:text-gray-400"><tr><th className="py-1">Receipt</th><th>Totes</th><th>First tote</th></tr></thead>
                    <tbody>{receipts.map(r => (
                      <tr key={r.receiptNo} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-1 font-mono">{r.receiptNo}</td><td>{Number(r.totes)}</td><td>{day(r.first)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Commission terms and the &quot;never charge&quot; settings aren&apos;t in BC&apos;s published feeds yet — see &quot;What does BC publish?&quot; on the Customers page.</p>
            </>
          ) : <p className="text-sm text-gray-500 dark:text-gray-400">Not a seller.</p>}
        </Card>

        <Card title="As a buyer">
          {c.buyerNo ? (
            <dl>
              <Row k="Buyer no." v={c.buyerNo} />
              <Row k="Paddle no." v={c.paddleNo} /><Row k="Permanent paddle" v={c.permanentPaddleNo} />
              <Row k="Permanent buyer" v={yesNo(c.permanentBuyer)} /><Row k="Trusted buyer" v={yesNo(c.trustedBuyer)} />
              <Row k="Preferential phone buyer" v={yesNo(c.preferentialTelephoneBuyer)} />
              <Row k="Private / trade" v={c.privateTrade} />
              <Row k="Premium discount" v={c.buyerPremiumDiscPct ? `${c.buyerPremiumDiscPct}%` : null} />
              <Row k="Don't email results" v={yesNo(c.doNotEmailResults)} />
              <Row k="No standard delivery charge" v={yesNo(c.doNotChargeStdDelivery)} />
            </dl>
          ) : <p className="text-sm text-gray-500 dark:text-gray-400">Not a buyer.</p>}
          {c.shipTo.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Delivery addresses ({c.shipTo.length})</p>
              <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-300">
                {c.shipTo.map(s => <li key={s.id}><span className="font-mono">{s.code}</span> — {[s.name, s.address, s.address2, s.city, s.postCode, s.countryCode].filter(Boolean).join(", ")}</li>)}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card title="Everything Business Central sent">
        <div className="space-y-2">
          <Raw label="Person (BC contact)" data={c.bcContact} />
          <Raw label="Seller (BC vendor)" data={c.bcVendor} />
          <Raw label="Buyer (BC customer)" data={c.bcBuyer} />
          <Raw label="Website account" data={c.bcWeb} />
          {!c.bcContact && !c.bcVendor && !c.bcBuyer && !c.bcWeb && <p className="text-sm text-gray-500">Nothing stored.</p>}
        </div>
      </Card>
    </div>
  )
}
