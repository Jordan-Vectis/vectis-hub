import Link from "next/link"
import Form from "next/form"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { normaliseCode } from "@/lib/goods-in/model"
import {
  Empty, ErrorBox, NotReady, PageHeader, StatusKey, btn, btnGo, box, input, isMissingTable, label, mono, td, th, ukDate, ukDateTime,
} from "../_components/ui"
import { ReceiptStatusBadge, ReceiptStatusKey, StatusCounts, kindCounts, receiptStatus } from "./_parts"
import SearchBox from "./search-box"

// Goods In → Receipts. Every receipt the Hub has booked, newest first, 50 a page, with where its
// totes and pallets have got to. Server-rendered: the filters are a plain GET form, so a link to a
// filtered list can be shared and the back button works. A barcode scanner can be used in the
// search box — scanning a receipt or a tote/pallet label goes straight to that receipt.
//
// Nothing here reads or writes Business Central.

export const dynamic = "force-dynamic"
export const metadata = { title: "Receipts · Goods In" }

const PAGE_SIZE = 50
const STATUSES = ["all", "open", "closed", "void"] as const
type StatusFilter = (typeof STATUSES)[number]
const STATUS_LABEL: Record<StatusFilter, string> = { all: "All", open: "Open", closed: "Closed", void: "Void" }

/** `id` is what the old prototype's links (e.g. from Contacts) pass — treated as a search, so a Goods In receipt number still opens. */
type SP = { q?: string; status?: string; from?: string; to?: string; page?: string; id?: string }

/** "14:02", London time — the second line under the booked date. */
const ukTime = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(d)

/** Minutes London is ahead of UTC at that instant (0 in winter, 60 in summer). */
function londonOffsetMinutes(at: Date): number {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" })
    .formatToParts(at).find(p => p.type === "timeZoneName")?.value ?? "GMT"
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part)
  if (!m) return 0
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

/** Midnight in London at the start of a YYYY-MM-DD day, as a real instant. Null for anything else. */
function londonStartOfDay(ymd: string | undefined, addDays = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? "")
  if (!m) return null
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays)
  if (!Number.isFinite(utc)) return null
  return new Date(utc - londonOffsetMinutes(new Date(utc)) * 60_000)
}

type Row = {
  id: string
  createdAt: Date
  vendorNo: string | null
  status: string | null
  createdByName: string | null
  printedAt: Date | null
  emailedAt: Date | null
  emailedTo: string | null
  customerName: string
  contactId: string
  containers: { kind: string; status: string | null }[]
}

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const me = await getGoodsInUser()
  if (!me) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PageHeader title="Receipts" />
        <ErrorBox>Your account doesn&apos;t have Warehouse access.</ErrorBox>
      </div>
    )
  }

  const q = (sp.q ?? sp.id ?? "").trim().slice(0, 100)
  const code = normaliseCode(q)
  // A scanned lot barcode or location isn't a receipt — the empty list then offers Find instead.
  const looksLikeCode = /\d/.test(code) && !/\s/.test(q) && code.length <= 24
  const status: StatusFilter = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as StatusFilter) : "all"
  const fromStr = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : ""
  const toStr = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : ""
  const from = londonStartOfDay(fromStr)
  const toExclusive = londonStartOfDay(toStr, 1)
  const askedPage = Math.max(1, Math.floor(Number(sp.page)) || 1)

  let goTo: string | null = null
  let rows: Row[] = []
  let total = 0
  let page = askedPage
  let everAny = true
  let problem: "migrate" | string | null = null

  try {
    // A scanned (or typed) receipt or tote/pallet number goes straight to its receipt.
    if (q && code.length >= 3) {
      const [exactReceipt, exactContainer] = await Promise.all([
        prisma.goodsInReceipt.findUnique({ where: { id: code }, select: { id: true } }),
        prisma.goodsInContainer.findUnique({ where: { id: code }, select: { id: true, receiptId: true } }),
      ])
      if (exactReceipt) goTo = `/tools/warehouse/receipts/${encodeURIComponent(exactReceipt.id)}`
      else if (exactContainer) goTo = `/tools/warehouse/receipts/${encodeURIComponent(exactContainer.receiptId)}?tote=${encodeURIComponent(exactContainer.id)}`
    }

    if (!goTo) {
      const and: Prisma.GoodsInReceiptWhereInput[] = []
      if (q) {
        and.push({
          OR: [
            { id: { contains: code, mode: "insensitive" } },
            { vendorNo: { contains: code, mode: "insensitive" } },
            { contact: { name: { contains: q, mode: "insensitive" } } },
            { containers: { some: { id: code } } },
          ],
        })
      }
      if (status === "open") and.push({ OR: [{ status: "open" }, { status: null }] })
      else if (status !== "all") and.push({ status })
      if (from) and.push({ createdAt: { gte: from } })
      if (toExclusive) and.push({ createdAt: { lt: toExclusive } })
      const where: Prisma.GoodsInReceiptWhereInput = and.length ? { AND: and } : {}

      total = await prisma.goodsInReceipt.count({ where })
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
      page = Math.min(askedPage, pages)
      const found = total === 0 ? [] : await prisma.goodsInReceipt.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true, createdAt: true, vendorNo: true, status: true, createdByName: true, printedAt: true, emailedAt: true, emailedTo: true,
          customer: true, contactId: true,
          contact: { select: { name: true } },
          containers: { select: { kind: true, status: true } },
        },
      })
      rows = found.map(r => {
        const snap = r.customer && typeof r.customer === "object" && !Array.isArray(r.customer) ? (r.customer as { name?: unknown }) : null
        return {
          id: r.id, createdAt: r.createdAt, vendorNo: r.vendorNo, status: r.status, createdByName: r.createdByName,
          printedAt: r.printedAt, emailedAt: r.emailedAt, emailedTo: r.emailedTo,
          customerName: r.contact?.name || (typeof snap?.name === "string" ? snap.name : "") || "—",
          contactId: r.contactId,
          containers: r.containers,
        }
      })
      if (total === 0 && and.length) everAny = (await prisma.goodsInReceipt.count()) > 0
      else if (total === 0) everAny = false
    }
  } catch (e) {
    if (isMissingTable(e)) problem = "migrate"
    else {
      console.error("goods-in receipts list error:", e)
      problem = String((e as { message?: string })?.message ?? e).slice(0, 300)
    }
  }

  // Outside the try: redirect() works by throwing, and the catch above would swallow it.
  if (goTo) redirect(goTo)

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = !!(q || status !== "all" || fromStr || toStr)
  const href = (over: Partial<Record<keyof SP, string | number | null>>) => {
    const p = new URLSearchParams()
    const merged: Record<string, string | number | null | undefined> = { q, status: status === "all" ? null : status, from: fromStr, to: toStr, page: null, ...over }
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== undefined && v !== "" && !(k === "status" && v === "all") && !(k === "page" && Number(v) <= 1)) p.set(k, String(v))
    const s = p.toString()
    return `/tools/warehouse/receipts${s ? `?${s}` : ""}`
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Receipts"
        back={{ href: "/tools/warehouse", label: "Goods In" }}
        intro="Every receipt booked in, newest first. Scan or type a receipt, tote or pallet number to go straight to it."
        actions={<Link href="/tools/warehouse/check-in" className={btnGo}>Book goods in</Link>}
      />

      {problem === "migrate" ? <NotReady /> : (
        <>
          {/* ── Filters ── */}
          <div className={`${box} p-4 mb-4`}>
            <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Show receipts that are">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 mr-1">Show</span>
              {STATUSES.map(s => {
                const on = s === status
                return (
                  <Link
                    key={s}
                    href={href({ status: s })}
                    aria-current={on ? "page" : undefined}
                    className={`inline-flex items-center justify-center min-h-11 px-4 rounded-lg border text-sm font-medium transition-colors ${on
                      ? "bg-indigo-600 border-indigo-600 text-white"
                      : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                  >
                    {STATUS_LABEL[s]}
                  </Link>
                )
              })}
            </div>
            <Form action="/tools/warehouse/receipts" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end">
              {status !== "all" && <input type="hidden" name="status" value={status} />}
              <div className="sm:col-span-2 lg:col-span-1">
                <label htmlFor="rq" className={label}>Search</label>
                <SearchBox defaultValue={q} />
              </div>
              <div>
                <label htmlFor="rfrom" className={label}>Booked from</label>
                <input id="rfrom" type="date" name="from" defaultValue={fromStr} className={`${input} dark:[color-scheme:dark]`} />
              </div>
              <div>
                <label htmlFor="rto" className={label}>Booked up to</label>
                <input id="rto" type="date" name="to" defaultValue={toStr} className={`${input} dark:[color-scheme:dark]`} />
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
                <button type="submit" className={`${btnGo} flex-1 lg:flex-none`}>Search</button>
                {filtered && <Link href="/tools/warehouse/receipts" className={`${btn} flex-1 lg:flex-none`}>Clear</Link>}
              </div>
            </Form>
          </div>

          {problem ? (
            <ErrorBox>Couldn&apos;t load the receipts: {problem}</ErrorBox>
          ) : rows.length === 0 ? (
            !everAny ? (
              <Empty>
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">No receipts yet</p>
                <p className="mb-4">Receipts appear here once goods are booked in at the counter.</p>
                <Link href="/tools/warehouse/check-in" className={btnGo}>Book goods in</Link>
              </Empty>
            ) : (
              <Empty>
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">No receipts match</p>
                <p className="mb-4">
                  {q ? <>Nothing found for <span className={`${mono} font-semibold`}>{q}</span>{status !== "all" || fromStr || toStr ? " with these filters" : ""}. </> : "No receipts with these filters. "}
                  Check the number, or clear the filters to see every receipt.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Link href="/tools/warehouse/receipts" className={btn}>Clear the filters</Link>
                  {looksLikeCode && <Link href={`/tools/warehouse/find?q=${encodeURIComponent(code)}`} className={btn}>Look up <span className={mono}>{code}</span> in Find</Link>}
                </div>
              </Empty>
            )
          ) : (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                {total.toLocaleString("en-GB")} receipt{total === 1 ? "" : "s"}{filtered ? " match" : ""}
                {pages > 1 && <> · showing {((page - 1) * PAGE_SIZE + 1).toLocaleString("en-GB")}–{Math.min(page * PAGE_SIZE, total).toLocaleString("en-GB")}</>}
              </p>

              {/* ── Phones and iPads: cards (two across once there's room) ── */}
              <ul className="xl:hidden grid gap-3 md:grid-cols-2">
                {rows.map(r => (
                  <li key={r.id} className="min-w-0">
                    <Link href={`/tools/warehouse/receipts/${encodeURIComponent(r.id)}`} className={`${box} block h-full p-4 hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors ${receiptStatus(r.status) === "void" ? "opacity-70" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`${mono} text-lg font-bold text-indigo-700 dark:text-indigo-300`}>{r.id}</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.customerName}</p>
                          {r.vendorNo && <p className={`${mono} text-xs text-gray-500 dark:text-gray-400`}>Vendor {r.vendorNo}</p>}
                        </div>
                        <ReceiptStatusBadge status={r.status} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-700 dark:text-gray-200">
                        <span className="font-medium">{kindCounts(r.containers)}</span>
                        <StatusCounts containers={r.containers} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                        <span>Booked {ukDateTime(r.createdAt)}{r.createdByName ? ` by ${r.createdByName}` : ""}</span>
                        <span>{r.printedAt ? <span className="text-emerald-700 dark:text-emerald-300">✓ Printed</span> : "Not printed"}</span>
                        <span>{r.emailedAt ? <span className="text-emerald-700 dark:text-emerald-300">✓ Emailed</span> : "Not emailed"}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              {/* ── Wide screens: the table (it needs ~950px, more than an iPad has beside the menu) ── */}
              <div className={`${box} hidden xl:block overflow-x-auto`}>
                <table className="w-full">
                  <thead className="border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className={th}>Receipt</th>
                      <th className={th}>Booked</th>
                      <th className={th}>Customer</th>
                      <th className={th}>Vendor no.</th>
                      <th className={th}>Totes / pallets</th>
                      <th className={th}>Where they are</th>
                      <th className={th}>Booked by</th>
                      <th className={`${th} text-center`}>Printed</th>
                      <th className={`${th} text-center`}>Emailed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {rows.map(r => {
                      const void_ = receiptStatus(r.status) === "void"
                      return (
                        <tr key={r.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${void_ ? "opacity-70" : ""}`}>
                          <td className={td}>
                            <Link href={`/tools/warehouse/receipts/${encodeURIComponent(r.id)}`} className={`${mono} font-bold text-indigo-700 dark:text-indigo-300 hover:underline inline-flex items-center min-h-8 ${void_ ? "line-through" : ""}`}>
                              {r.id}
                            </Link>
                            {receiptStatus(r.status) !== "open" && <div className="mt-1"><ReceiptStatusBadge status={r.status} /></div>}
                          </td>
                          <td className={`${td} whitespace-nowrap`}>
                            {ukDate(r.createdAt)}
                            <div className="text-xs text-gray-500 dark:text-gray-400">{ukTime(r.createdAt)}</div>
                          </td>
                          <td className={td}>
                            <Link href={`/tools/warehouse/customers/${encodeURIComponent(r.contactId)}`} className="hover:underline">{r.customerName}</Link>
                          </td>
                          <td className={`${td} ${mono} whitespace-nowrap`}>{r.vendorNo ?? <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                          <td className={td}>{kindCounts(r.containers)}</td>
                          <td className={td}><StatusCounts containers={r.containers} /></td>
                          <td className={td}>{r.createdByName ?? <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                          <td className={`${td} text-center whitespace-nowrap`}>
                            {r.printedAt
                              ? <span title={`Printed ${ukDateTime(r.printedAt)}`} className="text-emerald-700 dark:text-emerald-300 font-bold">✓<span className="block font-normal text-xs">{ukDate(r.printedAt)}</span></span>
                              : <span className="text-gray-500 dark:text-gray-400" title="Not printed yet"><span aria-hidden>—</span><span className="sr-only">Not printed</span></span>}
                          </td>
                          <td className={`${td} text-center whitespace-nowrap`}>
                            {r.emailedAt
                              ? <span title={`Emailed${r.emailedTo ? ` to ${r.emailedTo}` : ""} ${ukDateTime(r.emailedAt)}`} className="text-emerald-700 dark:text-emerald-300 font-bold">✓<span className="block font-normal text-xs">{ukDate(r.emailedAt)}</span></span>
                              : <span className="text-gray-500 dark:text-gray-400" title="Not emailed yet"><span aria-hidden>—</span><span className="sr-only">Not emailed</span></span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {pages > 1 && (
                <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Pages">
                  {page > 1
                    ? <Link href={href({ page: page - 1 })} className={btn}>← Newer</Link>
                    : <span className={`${btn} opacity-40 pointer-events-none`} aria-disabled="true">← Newer</span>}
                  <span className="text-sm text-gray-600 dark:text-gray-300">Page {page} of {pages}</span>
                  {page < pages
                    ? <Link href={href({ page: page + 1 })} className={btn}>Older →</Link>
                    : <span className={`${btn} opacity-40 pointer-events-none`} aria-disabled="true">Older →</span>}
                </nav>
              )}
            </>
          )}

          {/* ── What the colours mean ── */}
          <div className={`${box} mt-6 p-4 space-y-3`}>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Where the totes and pallets are</p>
            <StatusKey />
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 pt-1">The receipt itself</p>
            <ReceiptStatusKey />
            <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">✓ in Printed or Emailed shows the receipt has gone out, with the day it last did.</p>
          </div>
        </>
      )}
    </div>
  )
}
