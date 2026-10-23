import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCustomersUser } from "@/lib/customers/access"
import { customerNumber } from "@/lib/customers/filters"
import { sellerFigures, receiptsFor, totesFor, lotsFor, hubOnlyLotsFor, notesFor, uncollectedFor, type Lot } from "@/lib/customers/queries"
import { NoteComposer, NotesList, NotesFilter, type NoteDTO } from "./notes"
import { getAgreement, type CustomerAgreement } from "@/lib/actions/goods-in-agreement"
import { NOT_DRAFT } from "../../warehouse/receipts/_parts"
import FeesAgreement from "../../warehouse/customers/[id]/fees-agreement"
import VendorTermsText from "../../warehouse/customers/[id]/vendor-terms-text"
import { FromBcBadge } from "../../warehouse/receipts/_parts"

export const dynamic = "force-dynamic"

// One customer — the central place an admin finds everything about a person (2026-10-23, Jordan's
// Option 1): header with their ONE customer number, key figures, then tabs. Receipts, totes and lots
// are the Hub's own BC copies plus Hub lots not yet in BC; notes and calls live in the Hub only.
// BC is still in charge of the details themselves until switch day.

type Search = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const TABS = [
  ["overview", "Overview"], ["notes", "Notes & calls"], ["receipts", "Receipts & totes"], ["lots", "Lots"],
  ["buying", "Buying"], ["website", "Website account"], ["checks", "ID checks & terms"], ["fees", "Fees & agreement"], ["bc", "Everything BC sent"],
] as const
type Tab = (typeof TABS)[number][0]

const yesNo = (v: boolean | null | undefined) => (v == null ? null : v ? "Yes" : "No")
const day = (d: Date | string | null | undefined) => {
  if (!d) return null
  const dt = typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" })
}
const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`
const londonToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === "") return null
  return (
    <div className="flex gap-3 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0 text-sm">
      <dt className="w-40 shrink-0 text-gray-500 dark:text-gray-400">{k}</dt>
      <dd className="text-gray-900 dark:text-gray-100 break-words min-w-0">{v}</dd>
    </div>
  )
}
function Card({ title, children, right, className = "" }: { title: string; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h2>
        {right}
      </div>
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
// One value off a BC card, readable: Yes/No, blank dates (BC's 0001-01-01) and zeros left out.
function cardVal(v: unknown): string | null {
  if (v == null || v === "" || v === false || v === 0) return null
  if (v === true) return "Yes"
  if (typeof v === "string" && /^0001-01-01/.test(v)) return null
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("en-GB", { timeZone: "Europe/London" })
  return String(v)
}
function CardRows({ data, rows }: { data: any; rows: [string, string][] }) {
  const shown = rows.map(([k, label]) => [label, cardVal(data?.[k])] as const).filter(([, v]) => v)
  if (!shown.length) return <p className="text-sm text-gray-500 dark:text-gray-400">Nothing set.</p>
  return <dl>{shown.map(([label, v]) => <Row key={label} k={label} v={v} />)}</dl>
}

// The fields Jordan's list cared about, in plain words. Everything else is in "Everything BC sent".
const SELLER_TERMS: [string, string][] = [
  ["EVA_ChargeLottingFee", "Charge entry fee"], ["EVA_LottingFee", "Entry fee"],
  ["EVA_UnsoldType", "Unsold charge type"], ["EVA_UnsoldPercentage", "Unsold %"],
  ["EVA_WithdrawnType", "Withdrawn charge type"], ["EVA_WithdrawnCharge", "Withdrawn charge"],
  ["EVA_IntroductionCommPayee", "Introduction commission to"], ["EVA_IntroductionCommType", "Introduction commission type"],
  ["EVA_IntroductionCommPerc", "Introduction commission %"], ["EVA_IntroCommExpiryDate", "Introduction commission ends"],
  ["EVA_NeverChargeCommission", "Never charge commission"], ["EVA_NeverChargeUnsold", "Never charge unsold"],
  ["EVA_NeverChargeEntryFeeOnSold", "Never charge entry fee on sold"], ["EVA_NeverChargeIllustration", "Never charge illustration"],
  ["EVA_NeverChargeMinimumComm", "Never charge minimum commission"], ["EVA_NeverChargeInsurance", "Never charge insurance"],
  ["EVA_NeverChargeVAT", "Never charge VAT"], ["EVA_NeverChargeWithdrawn", "Never charge withdrawn"],
  ["EVA_SellItemsExcludingVAT", "Sell items excluding VAT"], ["EVA_PayToVendorNo", "Pay a different seller"],
  ["EVA_PayToVendorName", "…called"], ["EVA_PayToVendorOnly", "Pay to that seller only"], ["EVA_ChqPayeeName", "Cheque payee"],
  ["EVA_HoldInvoices", "Hold invoices"], ["EVA_TrustedVendor", "Trusted seller"], ["EVA_StaffVendor", "Staff seller"],
  ["EVA_StandardVendor", "Standard seller"], ["EVA_Trade", "Trade"], ["EVA_Originator", "Brought in by"],
  ["EVA_VendorComments", "Comments"], ["EVA_NoOfReceipts", "Receipts (BC's count)"], ["EVA_NoOfItemsSold", "Items sold (BC's count)"],
  ["EVA_NoOfItemsUnsold", "Items unsold (BC's count)"], ["EVA_TotalGrossSales", "Total gross sales (BC)"],
]
const ID_CHECKS: [string, string][] = [
  ["EVA_CalcFirstName", "First name"], ["EVA_CalcSurname", "Surname"], ["EVA_CalcCompanyName", "Company"],
  ["EVA_DateOfBirth", "Date of birth"], ["EVA_Nationality", "Nationality"], ["EVA_PreferredLanguage", "Preferred language"],
  ["EVA_HowDidYouHearAboutUs", "How they heard about us"], ["EVA_ContactAccountType", "Account type"],
  ["EVA_Approved", "Approved to buy"], ["EVA_ApprovedBy", "…by"], ["EVA_ApprovedAt", "…on"],
  ["EVA_VendorApproved", "Approved to sell"], ["EVA_VendorApprovedBy", "…by"], ["EVA_VendorApprovedAt", "…on"],
  ["EVA_ID1Type", "ID 1"], ["EVA_ID2Type", "ID 2"], ["EVA_IDCheckedStatus", "ID status"], ["EVA_IDStatusInvalidReason", "Why invalid"],
  ["EVA_DateChecked", "ID checked on"], ["EVA_SCN_ScreeningComplete", "Screening done"], ["EVA_SCN_ScreeningCompDate", "Screened on"],
  ["EVA_SCN_ScreenExpDate", "Screening expires"], ["EVA_ScreeningServiceID", "Screening reference"], ["EVA_KYCAssignedTo", "KYC assigned to"],
  ["EVA_HighRisk", "High risk"], ["EVA_HighRiskReason", "…because"], ["EVA_Blocked", "Blocked"], ["PTE_BlockedReason", "…because"],
  ["Privacy_Blocked", "Privacy blocked"], ["EVA_CompanyRegistrationNo", "Company reg. no."], ["EVA_CompanyDirectorName", "Company director"],
  ["EVA_CompanyOtherBenefName", "Other beneficiary"],
]

const pill = (cls: string) => `text-xs font-semibold rounded-full px-2 py-1 ${cls}`
const SELLER = pill("bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200")
const BUYER  = pill("bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200")
const WEB    = pill("bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200")
const BLOCK  = pill("bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300")
const btn = "min-h-[44px] inline-flex items-center justify-center px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:border-indigo-400"

function LotsTable({ lots }: { lots: Lot[] }) {
  const today = londonToday()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-gray-500 dark:text-gray-400"><tr><th className="py-1 pr-3">Barcode</th><th className="py-1 pr-3">Lot</th><th className="py-1 pr-3">Sale</th><th className="py-1 pr-3">Lot no.</th><th className="py-1 pr-3 text-right">Hammer</th><th className="py-1">Status</th></tr></thead>
        <tbody>
          {lots.map(l => {
            const upcoming = !!l.auctionDate && l.auctionDate.slice(0, 10) >= today
            const sold = (l.hammerPrice ?? 0) > 0
            return (
              <tr key={l.uniqueId} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-1.5 pr-3 font-mono text-gray-800 dark:text-gray-200 whitespace-nowrap">{l.barcode ?? l.uniqueId}</td>
                <td className="py-1.5 pr-3 text-gray-900 dark:text-gray-100 max-w-[28rem] truncate">{l.description ?? <span className="text-gray-400">—</span>}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap"><span className="font-mono text-gray-800 dark:text-gray-200">{l.auctionCode ?? "—"}</span>{l.auctionDate && <span className="block text-gray-500 dark:text-gray-400">{day(l.auctionDate)}</span>}</td>
                <td className="py-1.5 pr-3 font-mono text-gray-800 dark:text-gray-200">{l.lotNo ?? "—"}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-gray-800 dark:text-gray-200">{sold ? gbp(l.hammerPrice!) : "—"}</td>
                <td className="py-1.5 whitespace-nowrap">
                  {upcoming ? <span className="text-indigo-700 dark:text-indigo-300">In sale</span>
                    : sold ? <span className="text-green-700 dark:text-green-400">Sold{l.collected === false ? " · not collected" : ""}</span>
                    : l.auctionDate ? <span className={l.collected === false ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}>Unsold{l.collected === false ? " · awaiting collection" : l.collected ? " · collected" : ""}</span>
                    : <span className="text-gray-500 dark:text-gray-400">Not in a sale yet</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const sp = await searchParams
  const me = await getCustomersUser()
  const tab: Tab = TABS.some(t => t[0] === one(sp.tab)) ? (one(sp.tab) as Tab) : "overview"

  const c = await prisma.customer.findUnique({ where: { id }, include: { shipTo: { orderBy: { code: "asc" } } } }).catch(() => null)
  if (!c) notFound()
  // Its own table, read on its own: before Run Migrations it simply isn't there yet.
  const card = await prisma.customerBcCard.findUnique({ where: { customerId: c.id } }).catch(() => null)
  const cc = (card?.contactCard ?? null) as Record<string, unknown> | null

  // Always: the key figures across the top.
  const [fig, notes, cases] = await Promise.all([sellerFigures(c.vendorNo), notesFor(c.id), uncollectedFor(c.buyerNo)])
  const notesReady = notes !== null
  const noteDtos: NoteDTO[] = (notes ?? []).map(n => ({ ...n, followUpAt: n.followUpAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }))
  const openCases = cases.filter(x => !["collected", "closed"].includes(x.status))
  const followUps = (notes ?? []).filter(n => n.followUpAt && !n.followUpDone && n.followUpAt.getTime() < Date.now() + 86_400_000)
  const lastNote = notes?.[0] ?? null
  const num = customerNumber(c)
  const customerNo = num.main
  const name = c.name || c.name2 || "(no name)"
  const screenExp = typeof cc?.EVA_SCN_ScreenExpDate === "string" && !/^0001/.test(cc.EVA_SCN_ScreenExpDate) ? new Date(cc.EVA_SCN_ScreenExpDate) : null
  const idStatus = typeof cc?.EVA_IDCheckedStatus === "string" && cc.EVA_IDCheckedStatus ? cc.EVA_IDCheckedStatus : null

  const tabHref = (t: Tab) => `/tools/customers/${c.id}${t === "overview" ? "" : `?tab=${t}`}`
  const count = (n: number) => <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-gray-200 dark:bg-gray-700 text-[11px] font-bold text-gray-700 dark:text-gray-200">{n.toLocaleString()}</span>
  const tabCount: Partial<Record<Tab, number>> = { notes: notes?.length ?? 0, receipts: fig.receipts, lots: fig.lots + fig.hubOnlyLots, buying: openCases.length }

  // ── Tab bodies ──
  let body: React.ReactNode
  if (tab === "overview") {
    const [receipts, recent] = await Promise.all([receiptsFor(c.vendorNo, 6), lotsFor(c.vendorNo, { take: 8 })])
    const attention: { tone: "amber" | "red" | "indigo" | "grey"; text: React.ReactNode }[] = []
    if (c.blocked) attention.push({ tone: "red", text: <>Blocked in BC: <b>{c.blocked}</b></> })
    if (openCases.length) attention.push({ tone: "amber", text: <><b>{openCases.length}</b> paid, not collected {openCases.length === 1 ? "case" : "cases"} · <Link href={tabHref("buying")} className="underline">Buying</Link></> })
    if (fig.unsoldUncollected) attention.push({ tone: "amber", text: <><b>{fig.unsoldUncollected.toLocaleString()}</b> unsold {fig.unsoldUncollected === 1 ? "lot" : "lots"} still here after the sale — collect or re-offer · <Link href={tabHref("lots")} className="underline">Lots</Link></> })
    if (followUps.length) attention.push({ tone: "amber", text: <><b>{followUps.length}</b> follow-{followUps.length === 1 ? "up" : "ups"} due · <Link href={tabHref("notes")} className="underline">Notes &amp; calls</Link></> })
    if (fig.lotsNow) attention.push({ tone: "indigo", text: <><b>{fig.lotsNow.toLocaleString()}</b> {fig.lotsNow === 1 ? "lot" : "lots"} in a sale still to come</> })
    if (fig.hubOnlyLots) attention.push({ tone: "indigo", text: <><b>{fig.hubOnlyLots.toLocaleString()}</b> {fig.hubOnlyLots === 1 ? "lot" : "lots"} catalogued in the Hub, not yet in BC</> })
    if (idStatus && idStatus.toLowerCase() !== "valid") attention.push({ tone: "amber", text: <>ID check: <b>{idStatus}</b> · <Link href={tabHref("checks")} className="underline">ID checks &amp; terms</Link></> })
    if (screenExp) attention.push({ tone: screenExp.getTime() < Date.now() ? "amber" : "grey", text: <>Screening {screenExp.getTime() < Date.now() ? "expired" : "expires"} <b>{day(screenExp)}</b></> })
    if (!attention.length) attention.push({ tone: "grey", text: <span className="text-green-700 dark:text-green-400">✓ Nothing needs attention</span> })
    const toneCls = { amber: "border-amber-300 dark:border-amber-700/60", red: "border-red-300 dark:border-red-700/60", indigo: "border-indigo-300 dark:border-indigo-700/60", grey: "border-gray-200 dark:border-gray-700" }

    body = (
      <div className="space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card title="Contact details">
            <dl>
              <Row k="Name" v={[c.name, c.name2].filter(Boolean).join(" · ")} />
              <Row k="Email" v={c.email ? <a href={`mailto:${c.email}`} className="text-indigo-700 dark:text-indigo-300 hover:underline">{c.email}</a> : <span className="text-amber-600 dark:text-amber-400">None</span>} />
              <Row k="Second email" v={c.email2} />
              <Row k="Phone" v={c.phone} /><Row k="Mobile" v={c.mobile} /><Row k="Second mobile" v={c.mobile2} />
              <Row k="Address" v={[c.address, c.address2, c.address3, c.city, c.county, c.postCode, c.countryCode].filter(Boolean).join(", ")} />
              <Row k="VAT number" v={c.vatRegNo} /><Row k="EORI number" v={c.eoriNumber} /><Row k="Currency" v={c.currencyCode} />
              <Row k="In BC since" v={day(c.bcCreatedAt)} />
            </dl>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Details change in BC for now — the Hub takes over on switch day.</p>
          </Card>
          <Card title="Latest notes & calls" right={<Link href={tabHref("notes")} className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline">All {notes?.length ?? 0} →</Link>}>
            {!notesReady ? <p className="text-sm text-amber-700 dark:text-amber-300">Notes need Run Migrations before they can be kept.</p> : (
              <div className="space-y-3">
                <NotesList notes={noteDtos.slice(0, 3)} meId={me?.id ?? ""} isAdmin={!!me?.isAdmin} />
                <NoteComposer customerId={c.id} compact />
              </div>
            )}
          </Card>
          <Card title="Needs attention">
            <ul className="space-y-2">
              {attention.map((a, i) => <li key={i} className={`rounded-lg border px-3 py-2 text-sm text-gray-800 dark:text-gray-200 ${toneCls[a.tone]}`}>{a.text}</li>)}
            </ul>
          </Card>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Recent receipts" right={<Link href={tabHref("receipts")} className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline">All {fig.receipts} →</Link>}>
            {receipts.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">{c.vendorNo ? "No receipts in the BC copy." : "Not a seller."}</p> : <ReceiptsTable receipts={receipts} />}
          </Card>
          <Card title="Recent lots" right={<Link href={tabHref("lots")} className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline">All {fig.lots.toLocaleString()} →</Link>}>
            {recent.lots.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">{c.vendorNo ? "No lots in the BC copy." : "Not a seller."}</p> : <LotsTable lots={recent.lots} />}
          </Card>
        </div>
      </div>
    )
  } else if (tab === "notes") {
    const kind = one(sp.kind) ?? "all"
    body = (
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        <div className="space-y-4">
          {!notesReady ? <p className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-200">Notes need Run Migrations before they can be kept.</p> : (
            <>
              <Card title="Add to the record"><NoteComposer customerId={c.id} /></Card>
              <div className="flex flex-wrap items-center gap-3"><NotesFilter value={kind} /><span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{noteDtos.length} on record · newest first</span></div>
              <NotesList notes={noteDtos} meId={me?.id ?? ""} isAdmin={!!me?.isAdmin} filter={kind} />
            </>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Follow-ups">
            {followUps.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">None due.</p> : (
              <ul className="space-y-1 text-sm">{followUps.map(n => <li key={n.id} className="text-amber-700 dark:text-amber-300"><b>{day(n.followUpAt)}</b> — {n.text.slice(0, 80)}{n.text.length > 80 ? "…" : ""}</li>)}</ul>
            )}
          </Card>
          <Card title="Who to contact">
            <dl>
              <Row k="Email" v={c.email ? <a href={`mailto:${c.email}`} className="text-indigo-700 dark:text-indigo-300 hover:underline">{c.email}</a> : null} />
              <Row k="Phone" v={c.phone} /><Row k="Mobile" v={c.mobile} />
              <Row k="Prefers" v={c.doNotEmailResults ? "Not emailed results" : null} />
            </dl>
          </Card>
        </div>
      </div>
    )
  } else if (tab === "receipts") {
    // Goods In's own receipts (the Hub's check-in) are read on their own and tolerantly: their table is
    // keyed on the customer only after Run Migrations.
    const [receipts, totes, giReceipts] = await Promise.all([
      receiptsFor(c.vendorNo), totesFor(c.vendorNo),
      prisma.goodsInReceipt.findMany({ where: { customerId: c.id, ...NOT_DRAFT }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, status: true, createdAt: true, createdByName: true, source: true, _count: { select: { containers: true } } } }).catch(() => null),
    ])
    body = (
      <div className="space-y-4">
        <Card title={`Receipts (${receipts.length})`} right={<Link href="/tools/lot-lookup" className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline">Look up in Admin Centre →</Link>}>
          {receipts.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">{c.vendorNo ? "No receipts in the BC copy." : "Not a seller."}</p> : <ReceiptsTable receipts={receipts} />}
        </Card>
        <Card title={`Receipts in Goods In's database${giReceipts ? ` (${giReceipts.length})` : ""}`} right={<Link href={`/tools/warehouse/customers/${encodeURIComponent(c.id)}`} className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline">Open in Goods In →</Link>}>
          {giReceipts === null ? <p className="text-sm text-gray-500 dark:text-gray-400">Goods In receipts can&apos;t be read until an admin presses Run Migrations.</p>
            : giReceipts.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">No receipts in Goods In&apos;s database yet — BC&apos;s are copied in nightly, the Hub&apos;s own appear when booked in.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 dark:text-gray-400"><tr><th className="py-1 pr-3">Receipt</th><th className="py-1 pr-3">Booked in</th><th className="py-1 pr-3 text-right">Totes / pallets</th><th className="py-1 pr-3">Status</th><th className="py-1">By</th></tr></thead>
                  <tbody>{giReceipts.map(r => (
                    <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200">
                      <td className="py-1.5 pr-3 font-mono"><Link href={`/tools/warehouse/receipts/${encodeURIComponent(r.id)}`} className="text-indigo-700 dark:text-indigo-300 hover:underline">{r.id}</Link></td>
                      <td className="py-1.5 pr-3">{day(r.createdAt) ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{r._count.containers}</td>
                      <td className="py-1.5 pr-3">{r.status === "void" ? "Void" : r.status === "closed" ? "Closed" : "Open"}</td>
                      <td className="py-1.5">{r.source === "bc" ? <FromBcBadge /> : r.createdByName ?? "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
        </Card>
        <Card title={`Totes (${totes.length})`}>
          {totes.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">{c.vendorNo ? "No totes in the BC copy." : "Not a seller."}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-gray-500 dark:text-gray-400"><tr><th className="py-1 pr-3">Tote</th><th className="py-1 pr-3">Receipt</th><th className="py-1 pr-3">Location</th><th className="py-1 pr-3">Catalogued</th><th className="py-1 pr-3">Status</th><th className="py-1">Created in BC</th></tr></thead>
                <tbody>{totes.map(t => (
                  <tr key={t.toteNo} className="border-t border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200">
                    <td className="py-1.5 pr-3 font-mono">{t.toteNo}</td><td className="py-1.5 pr-3 font-mono">{t.receiptNo ?? "—"}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.location ?? <span className="text-gray-400">—</span>}</td>
                    <td className="py-1.5 pr-3">{t.catalogued == null ? "—" : t.catalogued ? "Yes" : "No"}</td>
                    <td className="py-1.5 pr-3">{t.status ?? "—"}</td><td className="py-1.5">{day(t.bcCreatedAt) ?? "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">As at the last BC Data Sync. Totes booked in through the Hub&apos;s own Goods In appear here once they carry this seller&apos;s number.</p>
        </Card>
      </div>
    )
  } else if (tab === "lots") {
    const sale = one(sp.sale) || null
    const page = Math.max(1, Number(one(sp.page)) || 1)
    const [{ lots, total, sales }, hubOnly] = await Promise.all([lotsFor(c.vendorNo, { sale, page }), hubOnlyLotsFor(c.vendorNo)])
    const pages = Math.max(1, Math.ceil(total / 100))
    const saleHref = (s: string | null, p = 1) => `/tools/customers/${c.id}?tab=lots${s ? `&sale=${encodeURIComponent(s)}` : ""}${p > 1 ? `&page=${p}` : ""}`
    body = (
      <div className="space-y-4">
        {hubOnly.length > 0 && (
          <Card title={`In the Hub, not yet in BC (${fig.hubOnlyLots.toLocaleString()})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-gray-500 dark:text-gray-400"><tr><th className="py-1 pr-3">Barcode</th><th className="py-1 pr-3">Lot</th><th className="py-1 pr-3">Sale</th><th className="py-1 pr-3 text-right">Estimate</th><th className="py-1">Catalogued</th></tr></thead>
                <tbody>{hubOnly.map(l => (
                  <tr key={l.id} className="border-t border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200">
                    <td className="py-1.5 pr-3 font-mono">{l.barcode ?? "—"}</td><td className="py-1.5 pr-3 max-w-[28rem] truncate">{l.title}</td>
                    <td className="py-1.5 pr-3"><Link href={`/tools/cataloguing/auctions/${l.auctionId}`} className="font-mono text-indigo-700 dark:text-indigo-300 hover:underline">{l.auctionCode}</Link> <span className="text-gray-500 dark:text-gray-400">{l.auctionName}</span></td>
                    <td className="py-1.5 pr-3 text-right font-mono">{l.estimateLow != null && l.estimateHigh != null ? `£${l.estimateLow}–${l.estimateHigh}` : "—"}</td><td className="py-1.5">{day(l.createdAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        )}
        <Card title={`Lots in BC (${total.toLocaleString()}${sale ? ` in ${sale}` : ""})`} right={<Link href="/tools/lot-lookup" className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline">Look up in Admin Centre →</Link>}>
          {sales.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <Link href={saleHref(null)} className={`min-h-[36px] inline-flex items-center px-3 rounded-full border text-xs ${!sale ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"}`}>All sales</Link>
              {sales.slice(0, 24).map(s => <Link key={s.code} href={saleHref(s.code)} title={s.name ?? undefined} className={`min-h-[36px] inline-flex items-center px-3 rounded-full border text-xs font-mono ${sale === s.code ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"}`}>{s.code} <span className="ml-1 opacity-70">{s.n}</span></Link>)}
              {sales.length > 24 && <span className="text-xs text-gray-500 self-center">+{sales.length - 24} more sales</span>}
            </div>
          )}
          {lots.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">{c.vendorNo ? "No lots in the BC copy." : "Not a seller."}</p> : <LotsTable lots={lots} />}
          {pages > 1 && (
            <div className="flex gap-2 items-center mt-3">
              {page > 1 && <Link href={saleHref(sale, page - 1)} className={btn}>← Previous</Link>}
              <span className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {pages}</span>
              {page < pages && <Link href={saleHref(sale, page + 1)} className={btn}>Next →</Link>}
            </div>
          )}
        </Card>
      </div>
    )
  } else if (tab === "buying") {
    body = (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Buyer settings">
          {c.buyerNo ? (
            <dl>
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
        <Card title={`Paid, not collected (${openCases.length} open)`}>
          {cases.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">No cases.</p> : (
            <table className="w-full text-xs">
              <thead className="text-left text-gray-500 dark:text-gray-400"><tr><th className="py-1 pr-3">Invoice</th><th className="py-1 pr-3">Sale</th><th className="py-1 pr-3 text-right">Paid</th><th className="py-1 pr-3">Paid by</th><th className="py-1">Status</th></tr></thead>
              <tbody>{cases.map(x => (
                <tr key={x.id} className="border-t border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200">
                  <td className="py-1.5 pr-3 font-mono">{me?.isAdmin ? <Link href={`/tools/accounts/uncollected/${x.id}`} className="text-indigo-700 dark:text-indigo-300 hover:underline">{x.invoiceNo ?? "—"}</Link> : (x.invoiceNo ?? "—")}</td>
                  <td className="py-1.5 pr-3 font-mono">{x.saleCode ?? "—"}</td><td className="py-1.5 pr-3 text-right font-mono">{x.amountPaid != null ? gbp(x.amountPaid) : "—"}</td>
                  <td className="py-1.5 pr-3">{day(x.paidAt) ?? "—"}</td>
                  <td className={`py-1.5 ${["collected", "closed"].includes(x.status) ? "text-gray-500 dark:text-gray-400" : "text-amber-600 dark:text-amber-400 font-semibold"}`}>{x.status}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">What they have bought isn&apos;t copied from BC yet — BC&apos;s lot copy carries no buyer number. That comes with the next copy change.</p>
        </Card>
      </div>
    )
  } else if (tab === "website") {
    body = (
      <Card title="Website account">
        {c.websiteId ? (
          <>
            <dl><Row k="Website account" v={c.websiteId} /><Row k="Email on the website" v={typeof (c.bcWeb as any)?.email === "string" ? (c.bcWeb as any).email : null} /></dl>
            <div className="mt-3"><Raw label="Everything the website account holds" data={c.bcWeb} /></div>
          </>
        ) : <p className="text-sm text-gray-500 dark:text-gray-400">No account on the website.</p>}
      </Card>
    )
  } else if (tab === "fees") {
    // The same tab Goods In shows (fees-agreement.tsx) — set once, used by every check-in for them.
    const a = await getAgreement(c.id).catch(() => null)
    const fallback: CustomerAgreement = {
      customerId: c.id, fees: { commission: null, lottingFee: null, photographyFee: null, unsoldFee: null },
      reservePercent: null, termsSignedAt: null, termsRecordedBy: null, specialArrangement: null, updatedAt: null, updatedByName: null, ready: false,
    }
    body = (
      <FeesAgreement
        customerId={c.id}
        name={name}
        initial={a?.ok ? a.data : fallback}
        loadError={a?.ok ? null : a ? a.error : "Couldn't read their fees and agreement just now."}
        termsText={<VendorTermsText />}
      />
    )
  } else if (tab === "checks") {
    body = (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Seller terms (BC vendor card)">
          {card?.vendorCard ? <CardRows data={card.vendorCard} rows={SELLER_TERMS} /> : <p className="text-sm text-gray-500 dark:text-gray-400">{c.vendorNo ? "Not copied yet — it comes with the next copy." : "Not a seller."}</p>}
        </Card>
        <Card title="ID checks & approvals (BC contact card)">
          {cc ? <CardRows data={cc} rows={ID_CHECKS} /> : <p className="text-sm text-gray-500 dark:text-gray-400">Not copied yet — it comes with the next copy.</p>}
        </Card>
      </div>
    )
  } else {
    body = (
      <Card title="Everything Business Central sent">
        <div className="space-y-2">
          <Raw label="Person (BC contact)" data={c.bcContact} />
          <Raw label="Seller (BC vendor)" data={c.bcVendor} />
          <Raw label="Buyer (BC customer)" data={c.bcBuyer} />
          <Raw label="Website account" data={c.bcWeb} />
          <Raw label="Contact card" data={card?.contactCard} />
          <Raw label="Vendor card (bank fields removed)" data={card?.vendorCard} />
          {!c.bcContact && !c.bcVendor && !c.bcBuyer && !c.bcWeb && <p className="text-sm text-gray-500">Nothing stored.</p>}
        </div>
      </Card>
    )
  }

  const tile = (v: React.ReactNode, label: React.ReactNode, cls = "text-gray-900 dark:text-white") => (
    <div className="flex-[1_1_150px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
      <p className={`text-2xl font-bold leading-tight ${cls}`}>{v}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  )

  return (
    <div className="p-6 w-full space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/tools/customers" className={btn}>← Customers</Link>
        <div className="flex-1 min-w-[260px]">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{name}</h1>
            {customerNo && <span className="font-mono text-base text-indigo-700 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950 rounded-lg px-2.5 py-1">{customerNo}</span>}
            {c.vendorNo && <span className={SELLER}>Seller{num.alsoSeller ? ` ${num.alsoSeller}` : ""}</span>}
            {c.buyerNo && <span className={BUYER}>Buyer{num.alsoBuyer ? ` ${num.alsoBuyer}` : ""}</span>}
            {num.odd && <span className={pill("bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200")} title="BC's contact “No.” field holds this instead of a C-number — fix it in BC">Odd contact no. in BC: {c.contactNo}</span>}
            {c.websiteId && <span className={WEB}>Website account</span>}
            {c.blocked && <span className={BLOCK}>Blocked: {c.blocked}</span>}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {[c.email, c.mobile || c.phone, [c.city, c.postCode].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
            {c.bcCreatedAt ? ` · in BC since ${day(c.bcCreatedAt)}` : ""}{c.syncedAt ? ` · copied ${c.syncedAt.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={tabHref("notes")} className="min-h-[44px] inline-flex items-center px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">+ Add note or call</Link>
          {c.email && <a href={`mailto:${c.email}`} className={btn}>Email</a>}
        </div>
      </div>

      {/* Key figures */}
      <div className="flex flex-wrap gap-3">
        {tile(fig.receipts.toLocaleString(), "Receipts")}
        {tile(fig.totes.toLocaleString(), "Totes")}
        {tile(<>{fig.lots.toLocaleString()}<span className="text-sm font-semibold text-gray-500 dark:text-gray-400"> · {fig.sold.toLocaleString()} sold</span></>, fig.hubOnlyLots ? `Lots in BC · +${fig.hubOnlyLots.toLocaleString()} in the Hub` : "Lots in BC")}
        {tile(gbp(fig.hammer), "Hammer total as seller")}
        {tile(openCases.length.toLocaleString(), "Paid, not collected", openCases.length ? "text-amber-600 dark:text-amber-400" : "text-green-700 dark:text-green-400")}
        {tile(lastNote ? day(lastNote.createdAt) : "—", lastNote ? `Last contact · ${lastNote.byName ?? "note"}` : notesReady ? "No notes yet" : "Notes need Run Migrations", "text-lg pt-1")}
      </div>

      {/* Tabs */}
      <nav aria-label="Customer sections" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700">
        {TABS.map(([key, label]) => (
          <Link key={key} href={tabHref(key)} aria-current={tab === key ? "page" : undefined}
            className={`min-h-[44px] inline-flex items-center px-3.5 text-sm font-semibold border-b-[3px] -mb-px whitespace-nowrap ${tab === key ? "border-indigo-600 text-gray-900 dark:text-white" : "border-transparent text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"}`}>
            {label}{tabCount[key] != null && tabCount[key]! > 0 && count(tabCount[key]!)}
          </Link>
        ))}
      </nav>

      {body}

      <p className="text-xs text-gray-500 dark:text-gray-400">Receipts, totes and lots are read from the Hub&apos;s own BC copies (as at the last Data Sync) and the Hub&apos;s own lots; nothing here writes to BC. Notes and calls live in the Hub only.</p>
    </div>
  )
}

function ReceiptsTable({ receipts }: { receipts: Awaited<ReturnType<typeof receiptsFor>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-gray-500 dark:text-gray-400"><tr><th className="py-1 pr-3">Receipt</th><th className="py-1 pr-3">First tote</th><th className="py-1 pr-3 text-right">Totes</th><th className="py-1 pr-3 text-right">Lots (sold)</th><th className="py-1">Sales</th></tr></thead>
        <tbody>{receipts.map(r => (
          <tr key={r.receiptNo} className="border-t border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200">
            <td className="py-1.5 pr-3 font-mono">{r.receiptNo}</td><td className="py-1.5 pr-3">{day(r.first) ?? "—"}</td>
            <td className="py-1.5 pr-3 text-right font-mono">{r.totes}</td>
            <td className="py-1.5 pr-3 text-right font-mono">{r.lots ? <>{r.lots} <span className="text-gray-500 dark:text-gray-400">({r.sold})</span></> : <span className="text-gray-400">—</span>}</td>
            <td className="py-1.5 font-mono">{r.sales ?? <span className="text-gray-400 font-sans">Not in a sale yet</span>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}
