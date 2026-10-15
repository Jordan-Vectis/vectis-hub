import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { getDepartmentAccess, canSeeAuction } from "@/lib/departments"
import { CONTAINER_STATUS, LOCATION_KINDS, type ContainerStatus } from "@/lib/goods-in/model"
import type { CustomerRow } from "@/lib/actions/goods-in"
import {
  box, btn, btnGo, mono, th, td, ukDate, ukDateTime,
  PageHeader, StatusBadge, StatusKey, KindBadge, Empty, NotReady, ErrorBox, OkBox, isMissingTable,
} from "../../_components/ui"
import CustomerPanel from "./customer-panel"

// Goods In → one customer: their details and usual terms (editable in place), a button to book
// goods in for them, every receipt they have, the totes and pallets of theirs in the warehouse now
// with where each one is, and the lots made from their totes with the sale and shelf. Read with
// prisma directly (server component); every write goes through lib/actions/goods-in.ts. Nothing
// here reads or writes Business Central, and no bank details are ever held or shown.

export const dynamic = "force-dynamic"

const RECEIPT_LIMIT = 200
const CONTAINER_LIMIT = 500
const LOT_LIMIT = 300
const BASE = "/tools/warehouse/customers"
const STATUS_ORDER = Object.keys(CONTAINER_STATUS) as ContainerStatus[]

type ReceiptView = {
  id: string
  createdAt: Date
  createdByName: string | null
  status: string | null
  printedAt: Date | null
  emailedAt: Date | null
  emailedTo: string | null
  totes: number
  pallets: number
  byStatus: { status: ContainerStatus; n: number }[]
}

type ContainerView = {
  id: string
  kind: string
  category: string | null
  description: string | null
  status: string | null
  locationCode: string | null
  locationName: string | null
  locationKind: string | null
  since: Date
  receiptId: string
}

type LotView = {
  id: string
  barcode: string | null
  title: string
  tote: string | null
  createdAt: Date
  auctionId: string
  auctionCode: string
  auctionName: string
  canOpen: boolean
  shelf: string | null
  shelfName: string | null
  shelvedAt: Date | null
}

type LotRaw = {
  id: string
  barcode: string | null
  title: string
  tote: string | null
  createdAt: Date | string
  auctionId: string
  auctionCode: string
  auctionName: string
  auctionType: string | null
  total: number
}

type Loaded = {
  customer: CustomerRow
  since: Date
  receipts: ReceiptView[]
  receiptTotal: number
  inWarehouse: ContainerView[]
  inWarehouseTotal: number
  lots: LotView[]
  lotTotal: number
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`
const kindLabel = (k: string | null | undefined) => LOCATION_KINDS.find(l => l.value === k)?.label ?? null
const findHref = (code: string) => `/tools/warehouse/find?q=${encodeURIComponent(code)}`
const receiptHref = (id: string) => `/tools/warehouse/receipts/${encodeURIComponent(id)}`
const receiptStatus = (s: string | null) => (s === "void" ? "Void" : s === "closed" ? "Closed" : "Open")
const muted = "text-gray-500 dark:text-gray-400"
const link = "text-indigo-700 dark:text-indigo-300 hover:underline"

async function load(id: string, viewer: { id: string; role: string }): Promise<Loaded | null> {
  const c = await prisma.contact.findUnique({ where: { id }, include: { goodsInCustomer: true, _count: { select: { goodsInReceipts: true } } } })
  if (!c) return null
  const g = c.goodsInCustomer
  const customer: CustomerRow = {
    id: c.id, salutation: c.salutation, name: c.name, email: c.email, phone: c.phone,
    addressLine1: c.addressLine1, addressLine2: c.addressLine2, postcode: c.postcode, notes: c.notes,
    vendorNo: g?.vendorNo ?? null, mobile: g?.mobile ?? null, town: g?.town ?? null, county: g?.county ?? null, country: g?.country ?? null,
    vatRegNo: g?.vatRegNo ?? null, commission: g?.commission ?? null, lottingFee: g?.lottingFee ?? null,
    photographyFee: g?.photographyFee ?? null, unsoldFee: g?.unsoldFee ?? null,
    receipts: c._count.goodsInReceipts,
  }

  // In the warehouse now = not yet catalogued or given back, on a receipt that wasn't voided.
  // (Prisma's "not" leaves out NULLs, so a blank status is let in explicitly.)
  const inWarehouseWhere: Prisma.GoodsInContainerWhereInput = {
    receipt: { contactId: id, OR: [{ status: null }, { status: { not: "void" } }] },
    OR: [{ status: null }, { status: { notIn: ["catalogued", "returned"] } }],
  }

  const [receipts, inWarehouse, inWarehouseTotal, access] = await Promise.all([
    prisma.goodsInReceipt.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      take: RECEIPT_LIMIT,
      select: {
        id: true, createdAt: true, createdByName: true, status: true, printedAt: true, emailedAt: true, emailedTo: true,
        containers: { select: { kind: true, status: true } },
      },
    }),
    prisma.goodsInContainer.findMany({
      where: inWarehouseWhere,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: CONTAINER_LIMIT,
      select: { id: true, kind: true, category: true, description: true, status: true, locationCode: true, locationKind: true, movedAt: true, createdAt: true, receiptId: true },
    }),
    prisma.goodsInContainer.count({ where: inWarehouseWhere }),
    getDepartmentAccess(viewer.id, viewer.role),
  ])

  // Lots made from their totes. CatalogueLot.tote is typed or scanned by the cataloguer, so it is
  // compared trimmed and in upper case (tote and pallet numbers are stored that way). A lot older
  // than the tote itself can't have been made from it — that is an older lot whose tote number
  // happens to be the same (e.g. from before the Hub's numbers carried on from BC's) — so it is
  // left out rather than shown against the wrong customer.
  const lotsRaw = receipts.length
    ? await prisma.$queryRaw<LotRaw[]>`
        SELECT l."id", l."barcode", l."title", l."tote", l."createdAt", l."auctionId",
               a."code" AS "auctionCode", a."name" AS "auctionName", a."auctionType",
               (COUNT(*) OVER ())::int AS "total"
        FROM "CatalogueLot" l
        JOIN "CatalogueAuction" a ON a."id" = l."auctionId"
        JOIN "GoodsInContainer" c ON c."id" = upper(btrim(l."tote"))
        JOIN "GoodsInReceipt" r ON r."id" = c."receiptId"
        WHERE r."contactId" = ${id}
          AND l."createdAt" >= c."createdAt"
        ORDER BY l."createdAt" DESC
        LIMIT ${LOT_LIMIT}`
    : []

  // A lot's shelf is its latest Goods In move.
  const lotIds = lotsRaw.map(l => l.id)
  const moves = lotIds.length
    ? await prisma.goodsInMovement.findMany({
        where: { lotId: { in: lotIds } },
        orderBy: { movedAt: "desc" },
        select: { lotId: true, locationCode: true, movedAt: true },
      })
    : []
  const shelfOf = new Map<string, { code: string; at: Date }>()
  for (const m of moves) if (m.lotId && !shelfOf.has(m.lotId)) shelfOf.set(m.lotId, { code: m.locationCode, at: m.movedAt })

  const codes = [...new Set([...inWarehouse.map(x => x.locationCode), ...[...shelfOf.values()].map(s => s.code)].filter((x): x is string => !!x))]
  const locations = codes.length
    ? await prisma.goodsInLocation.findMany({ where: { code: { in: codes } }, select: { code: true, name: true, kind: true } })
    : []
  const loc = new Map(locations.map(l => [l.code, l]))

  return {
    customer,
    since: c.createdAt,
    receiptTotal: c._count.goodsInReceipts,
    receipts: receipts.map(r => {
      const counts = new Map<ContainerStatus, number>()
      for (const x of r.containers) {
        const s = (x.status && x.status in CONTAINER_STATUS ? x.status : "booked") as ContainerStatus
        counts.set(s, (counts.get(s) ?? 0) + 1)
      }
      const totes = r.containers.filter(x => x.kind !== "pallet").length
      return {
        id: r.id, createdAt: r.createdAt, createdByName: r.createdByName, status: r.status,
        printedAt: r.printedAt, emailedAt: r.emailedAt, emailedTo: r.emailedTo,
        totes, pallets: r.containers.length - totes,
        byStatus: STATUS_ORDER.filter(s => counts.has(s)).map(s => ({ status: s, n: counts.get(s)! })),
      }
    }),
    inWarehouse: inWarehouse.map(x => ({
      id: x.id, kind: x.kind, category: x.category, description: x.description, status: x.status,
      locationCode: x.locationCode, locationName: x.locationCode ? loc.get(x.locationCode)?.name ?? null : null,
      locationKind: x.locationKind ?? (x.locationCode ? loc.get(x.locationCode)?.kind ?? null : null),
      since: x.movedAt ?? x.createdAt, receiptId: x.receiptId,
    })),
    inWarehouseTotal,
    lotTotal: lotsRaw[0]?.total ?? 0,
    lots: lotsRaw.map(l => {
      const shelf = shelfOf.get(l.id)
      return {
        id: l.id, barcode: l.barcode, title: l.title, tote: l.tote, createdAt: new Date(l.createdAt),
        auctionId: l.auctionId, auctionCode: l.auctionCode, auctionName: l.auctionName,
        canOpen: canSeeAuction(access, { id: l.auctionId, auctionType: l.auctionType }),
        shelf: shelf?.code ?? null, shelfName: shelf ? loc.get(shelf.code)?.name ?? null : null, shelvedAt: shelf?.at ?? null,
      }
    }),
  }
}

function Section({ title, intro, children, id }: { title: string; intro?: React.ReactNode; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div>
        <h2 id={id} className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
        {intro && <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 max-w-3xl">{intro}</div>}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className={`${box} px-4 py-3`}>
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function Where({ byStatus }: { byStatus: ReceiptView["byStatus"] }) {
  if (!byStatus.length) return <span className={muted}>Nothing on it</span>
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {byStatus.map(b => (
        <span key={b.status} className="inline-flex items-center gap-1">
          <span className={`${mono} text-xs font-semibold text-gray-700 dark:text-gray-200`}>{b.n}</span>
          <StatusBadge status={b.status} />
        </span>
      ))}
    </span>
  )
}

function Sent({ r }: { r: ReceiptView }) {
  if (!r.printedAt && !r.emailedAt) return <span className={muted}>Not printed or emailed yet</span>
  return (
    <span className="block space-y-0.5">
      {r.printedAt && <span className="block">Printed {ukDate(r.printedAt)}</span>}
      {r.emailedAt && <span className="block break-all">Emailed {ukDate(r.emailedAt)}{r.emailedTo ? ` to ${r.emailedTo}` : ""}</span>}
    </span>
  )
}

function Location({ code, name, kind }: { code: string | null; name: string | null; kind: string | null }) {
  if (!code) return <span className="text-gray-500 dark:text-gray-400">Not put away yet</span>
  return (
    <span className="block">
      <span className={`${mono} font-semibold`}>{code}</span>
      {(name || kindLabel(kind)) && <span className="block text-xs text-gray-500 dark:text-gray-400">{[kindLabel(kind), name].filter(Boolean).join(" · ")}</span>}
    </span>
  )
}

function Sale({ l }: { l: LotView }) {
  return (
    <span className="block">
      {l.canOpen
        ? <Link href={`/tools/cataloguing/auctions/${encodeURIComponent(l.auctionId)}`} className={`${mono} font-semibold ${link}`}>{l.auctionCode}</Link>
        : <span className={`${mono} font-semibold`} title="You can't open this sale — it belongs to another department.">{l.auctionCode}</span>}
      <span className="block text-xs text-gray-500 dark:text-gray-400">{l.auctionName}</span>
    </span>
  )
}

function Shelf({ l }: { l: LotView }) {
  if (!l.shelf) return <span className="text-gray-500 dark:text-gray-400">Not shelved yet</span>
  return (
    <span className="block">
      <span className={`${mono} font-semibold`}>{l.shelf}</span>
      <span className="block text-xs text-gray-500 dark:text-gray-400">{[l.shelfName, l.shelvedAt ? `since ${ukDate(l.shelvedAt)}` : null].filter(Boolean).join(" · ")}</span>
    </span>
  )
}

export default async function CustomerPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const justAdded = sp.added === "1"

  const me = await getGoodsInUser()
  if (!me) {
    return <div className="p-4 sm:p-6 lg:p-8"><ErrorBox>Your account doesn&apos;t have Warehouse access. Ask a manager to add it.</ErrorBox></div>
  }

  let data: Loaded | null = null
  let missing = false
  let failed: string | null = null
  try {
    data = await load(id, me)
  } catch (e) {
    if (isMissingTable(e)) missing = true
    else {
      console.error("goods-in customer page:", e)
      failed = "This customer couldn't be loaded just now. Try again in a moment — if it keeps happening, tell Jack."
    }
  }

  if (missing || failed) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PageHeader title="Customer" back={{ href: BASE, label: "Customers" }} />
        {missing ? <NotReady /> : <ErrorBox>{failed}</ErrorBox>}
      </div>
    )
  }
  // notFound() works by throwing, so it sits outside the try/catch above.
  if (!data) notFound()

  const { customer: c, receipts, inWarehouse, lots } = data
  const totesIn = inWarehouse.filter(x => x.kind !== "pallet").length
  const palletsIn = inWarehouse.length - totesIn
  const lastBooked = receipts[0]?.createdAt ?? null
  const bookHref = `/tools/warehouse/check-in?customer=${encodeURIComponent(c.id)}`

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <div className="space-y-4">
        <PageHeader
          title={[c.salutation, c.name].filter(Boolean).join(" ")}
          back={{ href: BASE, label: "Customers" }}
          intro={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {c.vendorNo
                ? <span>Vendor no. <span className={`${mono} font-semibold text-gray-800 dark:text-gray-100`}>{c.vendorNo}</span></span>
                : <span>No vendor number yet — one is given when goods are first booked in, once the vendor number series is set up.</span>}
              <span>On the system since {ukDate(data.since)}</span>
            </span>
          }
          actions={<Link href={bookHref} className={`${btnGo} !min-h-12`}>Book goods in for this customer</Link>}
        />
        {justAdded && (
          <OkBox>
            {c.name} has been added{c.vendorNo ? <> with vendor number <span className={`${mono} font-semibold`}>{c.vendorNo}</span></> : " (no vendor number yet)"}. Book their goods in with the button above when you&apos;re ready.
          </OkBox>
        )}
        <CustomerPanel customer={c} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Receipts" value={data.receiptTotal.toLocaleString("en-GB")} />
        <Stat
          label="In the warehouse now"
          value={data.inWarehouseTotal.toLocaleString("en-GB")}
          sub={
            data.inWarehouseTotal === 0 ? "Nothing waiting"
              : data.inWarehouseTotal > inWarehouse.length ? `Newest ${inWarehouse.length} listed below`
              : [totesIn && plural(totesIn, "tote"), palletsIn && plural(palletsIn, "pallet")].filter(Boolean).join(" · ")
          }
        />
        <Stat label="Lots made" value={data.lotTotal.toLocaleString("en-GB")} sub="From their totes" />
        <Stat label="Last booked in" value={<span className="text-base">{lastBooked ? ukDate(lastBooked) : "Never"}</span>} />
      </div>

      <div className={`${box} px-4 py-3 space-y-2`}>
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">What the tote and pallet colours mean</p>
        <StatusKey />
      </div>

      {/* ── Receipts ─────────────────────────────────────────────────────────────────── */}
      <Section
        id="receipts"
        title={`Receipts (${data.receiptTotal.toLocaleString("en-GB")})`}
        intro={data.receiptTotal > receipts.length ? `Showing the latest ${receipts.length} — open Receipts to search the rest.` : "Newest first. Open one to reprint it, email it or add more totes."}
      >
        {receipts.length === 0 ? (
          <Empty>
            <p>Nothing booked in for {c.name} yet.</p>
            <Link href={bookHref} className={`${btnGo} mt-4`}>Book goods in for this customer</Link>
          </Empty>
        ) : (
          <>
            <ul className="sm:hidden space-y-2">
              {receipts.map(r => (
                <li key={r.id} className={`${box} px-4 py-3 space-y-2`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={receiptHref(r.id)} className={`${mono} text-base font-bold ${link} inline-flex items-center min-h-11`}>{r.id}</Link>
                    <span className={`text-xs font-semibold ${r.status === "void" ? "text-red-700 dark:text-red-300" : "text-gray-600 dark:text-gray-300"}`}>{receiptStatus(r.status)}</span>
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-200">{ukDateTime(r.createdAt)}{r.createdByName ? ` · ${r.createdByName}` : ""}</div>
                  <div className="text-sm text-gray-700 dark:text-gray-200">{[r.totes && plural(r.totes, "tote"), r.pallets && plural(r.pallets, "pallet")].filter(Boolean).join(" · ") || "No totes"}</div>
                  <Where byStatus={r.byStatus} />
                  <div className="text-xs text-gray-500 dark:text-gray-400"><Sent r={r} /></div>
                  <div className="flex gap-2 pt-1">
                    <Link href={receiptHref(r.id)} className={`${btn} flex-1`}>Open</Link>
                    {/* A void receipt is never printed (the PDF route refuses it too). */}
                    {r.status !== "void" && <a href={`/api/goods-in/receipt/${encodeURIComponent(r.id)}/pdf`} target="_blank" rel="noopener" className={`${btn} flex-1`}>Receipt PDF</a>}
                  </div>
                </li>
              ))}
            </ul>
            <div className={`${box} hidden sm:block overflow-x-auto`}>
              <table className="w-full">
                <thead className="border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className={th}>Receipt</th>
                    <th className={th}>Booked in</th>
                    <th className={th}>Totes / pallets</th>
                    <th className={th}>Where they are</th>
                    <th className={th}>Sent to customer</th>
                    <th className={th}>Status</th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {receipts.map(r => (
                    <tr key={r.id} className={r.status === "void" ? "opacity-60" : ""}>
                      <td className={td}><Link href={receiptHref(r.id)} className={`${mono} font-semibold ${link} inline-flex items-center min-h-11`}>{r.id}</Link></td>
                      <td className={`${td} whitespace-nowrap`}>
                        {ukDateTime(r.createdAt)}
                        {r.createdByName && <span className="block text-xs text-gray-500 dark:text-gray-400">by {r.createdByName}</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{[r.totes && plural(r.totes, "tote"), r.pallets && plural(r.pallets, "pallet")].filter(Boolean).join(" · ") || <span className={muted}>None</span>}</td>
                      <td className={td}><Where byStatus={r.byStatus} /></td>
                      <td className={`${td} text-xs max-w-[16rem]`}><Sent r={r} /></td>
                      <td className={`${td} whitespace-nowrap`}>
                        <span className={r.status === "void" ? "font-semibold text-red-700 dark:text-red-300" : ""}>{receiptStatus(r.status)}</span>
                      </td>
                      <td className={`${td} text-right whitespace-nowrap`}>
                        {r.status !== "void" && <a href={`/api/goods-in/receipt/${encodeURIComponent(r.id)}/pdf`} target="_blank" rel="noopener" className={btn}>PDF</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <b>Open</b> — still being added to. <b>Closed</b> — finished. <b className="text-red-700 dark:text-red-300">Void</b> — cancelled by a manager; its totes and pallets aren&apos;t counted as in the warehouse.
            </p>
          </>
        )}
      </Section>

      {/* ── In the warehouse now ─────────────────────────────────────────────────────── */}
      <Section
        id="in-warehouse"
        title={`In the warehouse now (${data.inWarehouseTotal.toLocaleString("en-GB")})`}
        intro={
          data.inWarehouseTotal > inWarehouse.length
            ? `Their totes and pallets not yet catalogued or given back — showing the newest ${inWarehouse.length}.`
            : "Their totes and pallets not yet catalogued or given back, and where each one is."
        }
      >
        {inWarehouse.length === 0 ? (
          <Empty>
            {receipts.length === 0
              ? "Nothing of theirs is in the warehouse — they haven't booked anything in."
              : "Nothing of theirs is waiting in the warehouse — every tote and pallet has been catalogued or given back."}
          </Empty>
        ) : (
          <>
            <ul className="sm:hidden space-y-2">
              {inWarehouse.map(x => (
                <li key={x.id} className={`${box} px-4 py-3 space-y-2`}>
                  <div className="flex items-center justify-between gap-3">
                    <Link href={findHref(x.id)} className={`${mono} text-base font-bold ${link} inline-flex items-center gap-2 min-h-11`}>{x.id} <KindBadge kind={x.kind} /></Link>
                    <StatusBadge status={x.status} />
                  </div>
                  {(x.category || x.description) && (
                    <div className="text-sm text-gray-800 dark:text-gray-100">
                      {x.category && <span className="font-semibold">{x.category}</span>}
                      {x.category && x.description ? " — " : ""}
                      {x.description}
                    </div>
                  )}
                  <div className="text-sm"><Location code={x.locationCode} name={x.locationName} kind={x.locationKind} /></div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Since {ukDateTime(x.since)} · receipt <Link href={receiptHref(x.receiptId)} className={`${mono} ${link}`}>{x.receiptId}</Link>
                  </div>
                </li>
              ))}
            </ul>
            <div className={`${box} hidden sm:block overflow-x-auto`}>
              <table className="w-full">
                <thead className="border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className={th}>Number</th>
                    <th className={th}>What&apos;s in it</th>
                    <th className={th}>Status</th>
                    <th className={th}>Where it is</th>
                    <th className={th}>Since</th>
                    <th className={th}>Receipt</th>
                    <th className={th}><span className="sr-only">Label</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {inWarehouse.map(x => (
                    <tr key={x.id}>
                      <td className={`${td} whitespace-nowrap`}>
                        <Link href={findHref(x.id)} className={`${mono} font-semibold ${link} inline-flex items-center gap-2 min-h-11`}>{x.id} <KindBadge kind={x.kind} /></Link>
                      </td>
                      <td className={`${td} min-w-[12rem]`}>
                        {x.category && <span className="block font-semibold">{x.category}</span>}
                        {x.description && <span className="block text-gray-600 dark:text-gray-300">{x.description}</span>}
                        {!x.category && !x.description && <span className={muted}>—</span>}
                      </td>
                      <td className={td}><StatusBadge status={x.status} /></td>
                      <td className={td}><Location code={x.locationCode} name={x.locationName} kind={x.locationKind} /></td>
                      <td className={`${td} whitespace-nowrap`}>{ukDateTime(x.since)}</td>
                      <td className={td}><Link href={receiptHref(x.receiptId)} className={`${mono} ${link}`}>{x.receiptId}</Link></td>
                      <td className={`${td} text-right`}>
                        <a href={`/api/goods-in/labels?containers=${encodeURIComponent(x.id)}`} target="_blank" rel="noopener" className={`${btn} whitespace-nowrap`} title={`Print the barcode label for ${x.id} again`}>Label</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* ── Lots made from their totes ───────────────────────────────────────────────── */}
      <Section
        id="lots"
        title={`Lots made from their totes (${data.lotTotal.toLocaleString("en-GB")})`}
        intro={
          data.lotTotal > lots.length
            ? `Newest first — showing the latest ${lots.length}. Scan or search a barcode in Find for any other.`
            : "Lots the cataloguers have made from this customer's totes, with the sale each is in and the shelf it is kept on."
        }
      >
        {lots.length === 0 ? (
          <Empty>
            {data.receiptTotal === 0
              ? "No lots yet — nothing has been booked in for them."
              : "No lots have been made from their totes yet. Lots show here once a cataloguer makes them with this customer's tote number on them."}
          </Empty>
        ) : (
          <>
            <ul className="sm:hidden space-y-2">
              {lots.map(l => (
                <li key={l.id} className={`${box} px-4 py-3 space-y-2`}>
                  <div className="flex items-baseline justify-between gap-3">
                    {l.barcode
                      ? <Link href={findHref(l.barcode)} className={`${mono} text-base font-bold ${link} inline-flex items-center min-h-11`}>{l.barcode}</Link>
                      : <span className={`${mono} text-sm ${muted}`}>No barcode yet</span>}
                    {l.tote && <span className={`${mono} text-xs text-gray-500 dark:text-gray-400`}>from {l.tote}</span>}
                  </div>
                  <div className="text-sm text-gray-800 dark:text-gray-100 line-clamp-2">{l.title}</div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><div className="text-xs text-gray-500 dark:text-gray-400">Sale</div><Sale l={l} /></div>
                    <div><div className="text-xs text-gray-500 dark:text-gray-400">Shelf</div><Shelf l={l} /></div>
                  </div>
                </li>
              ))}
            </ul>
            <div className={`${box} hidden sm:block overflow-x-auto`}>
              <table className="w-full">
                <thead className="border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className={th}>Barcode</th>
                    <th className={th}>Title</th>
                    <th className={th}>From tote</th>
                    <th className={th}>Sale</th>
                    <th className={th}>Shelf</th>
                    <th className={th}>Made</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {lots.map(l => (
                    <tr key={l.id}>
                      <td className={`${td} whitespace-nowrap`}>
                        {l.barcode
                          ? <Link href={findHref(l.barcode)} className={`${mono} font-semibold ${link} inline-flex items-center min-h-11`}>{l.barcode}</Link>
                          : <span className={muted}>No barcode yet</span>}
                      </td>
                      <td className={`${td} min-w-[14rem]`}><span className="line-clamp-2">{l.title}</span></td>
                      <td className={`${td} ${mono} whitespace-nowrap`}>{l.tote ?? <span className={muted}>—</span>}</td>
                      <td className={td}><Sale l={l} /></td>
                      <td className={td}><Shelf l={l} /></td>
                      <td className={`${td} whitespace-nowrap`}>{ukDate(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  )
}
