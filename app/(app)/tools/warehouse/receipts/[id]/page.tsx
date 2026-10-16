import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getGoodsInUser, atLeast } from "@/lib/goods-in/access"
import { getDepartmentAccess, canSeeAuction } from "@/lib/departments"
import { THROWN_AWAY_NOTE, labelsGivenUp, normaliseCode, type CustomerSnapshot } from "@/lib/goods-in/model"
import { ErrorBox, NotReady, PageHeader, StatusKey, box, isMissingTable, mono, ukDateTime } from "../../_components/ui"
import { CarryOnLink, RECEIPT_STATUS, ReceiptStatusBadge, StatusCounts, kindCounts, receiptStatus } from "../_parts"
import ReceiptActions from "./receipt-actions"
import DraftBanner from "./draft-banner"
import ContainersTable from "./containers-table"
import AddContainers from "./add-containers"
import NotesEditor from "./notes-editor"
import LotList from "./lot-list"
import { CATEGORY_LIST_ID, type ContainerView, type LotView } from "./types"

// Goods In → one receipt. Everything about what a customer handed in on one visit: the customer as
// printed on the day (with a note when their record has changed since), the terms, every tote and
// pallet with where it is and the lots made from it, and the buttons to print, email, add to,
// close or void it. Reads with prisma directly; every write goes through lib/actions/goods-in.
//
// A check-in that hasn't been booked in yet (status "draft") opens here too: a banner offers Carry on
// checking in and Throw it away; its labels can be printed, but the receipt itself can't be printed,
// emailed, closed, voided or added to until it's booked in, and its notes are written at Check & book in.
//
// ⚠ Never shows bank details — the Hub doesn't hold any (the printed receipt's bank form is blank).
// Nothing here reads or writes Business Central.

export const dynamic = "force-dynamic"

type Params = { id: string }

const cleanId = (raw: string) => {
  let s = raw
  try { s = decodeURIComponent(raw) } catch { /* already decoded */ }
  return normaliseCode(s).slice(0, 40)
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { id } = await params
  return { title: `Receipt ${cleanId(id)} · Goods In` }
}

const pounds = (n: number | null | undefined) => (n == null ? "—" : `£${Number.isInteger(n) ? n : n.toFixed(2)}`)
const percent = (n: number | null | undefined) => (n == null ? "—" : `${Number.isInteger(n) ? n : n.toFixed(2)}%`)

/** Words for each customer field, for the "changed since" note. Address lines count as one change. */
const FIELD_WORDS: [keyof CustomerSnapshot, string][] = [
  ["salutation", "title"], ["name", "name"], ["addressLine1", "address"], ["addressLine2", "address"], ["town", "address"],
  ["county", "address"], ["postcode", "address"], ["country", "address"], ["email", "email"], ["mobile", "mobile"],
  ["phone", "phone"], ["vatRegNo", "VAT number"], ["vendorNo", "vendor number"],
]
const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().replace(/\s+/g, " ").toLowerCase() === (b ?? "").trim().replace(/\s+/g, " ").toLowerCase()

function asSnapshot(v: unknown): CustomerSnapshot | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string) : null)
  return {
    salutation: s("salutation"), name: s("name") ?? "", addressLine1: s("addressLine1"), addressLine2: s("addressLine2"),
    town: s("town"), county: s("county"), postcode: s("postcode"), country: s("country"), email: s("email"),
    mobile: s("mobile"), phone: s("phone"), vatRegNo: s("vatRegNo"), vendorNo: s("vendorNo"),
  }
}

export default async function ReceiptPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ tote?: string }> }) {
  const { id: rawId } = await params
  const sp = await searchParams
  const id = cleanId(rawId)

  const me = await getGoodsInUser()
  if (!me) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PageHeader title={`Receipt ${id}`} back={{ href: "/tools/warehouse/receipts", label: "Receipts" }} />
        <ErrorBox>Your account doesn&apos;t have Warehouse access.</ErrorBox>
      </div>
    )
  }

  let problem: "migrate" | string | null = null
  let loaded: Awaited<ReturnType<typeof load>> = null
  try {
    loaded = await load(id, me)
  } catch (e) {
    if (isMissingTable(e)) problem = "migrate"
    else {
      console.error("goods-in receipt page error:", e)
      problem = String((e as { message?: string })?.message ?? e).slice(0, 300)
    }
  }

  if (problem) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PageHeader title={`Receipt ${id}`} back={{ href: "/tools/warehouse/receipts", label: "Receipts" }} />
        {problem === "migrate" ? <NotReady /> : <ErrorBox>Couldn&apos;t load this receipt: {problem}</ErrorBox>}
      </div>
    )
  }
  // Outside the try: notFound() works by throwing.
  if (!loaded) notFound()

  const { r, containers, otherLots, snap, live, changed, liveName } = loaded
  const status = receiptStatus(r.status)
  const isVoid = status === "void"
  const isDraft = status === "draft"
  // A check-in thrown away after labels were printed (or a tote moved) is kept as void with this note
  // (discardCheckIn's wording). It was never booked in, so it isn't offered back as a booked receipt.
  const thrownAway = isVoid && (r.notes ?? "").includes(THROWN_AWAY_NOTE)
  const lotsMade = containers.reduce((n, c) => n + c.lots.length, 0)
  const labelsPrinted = containers.filter(c => c.labelPrintedAt).length
  const highlightRaw = sp.tote ? normaliseCode(sp.tote) : null
  const highlight = highlightRaw && containers.some(c => c.id === highlightRaw) ? highlightRaw : null
  const shown = snap ?? live
  const customerName = shown.name || liveName

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={`Receipt ${r.id}`}
        back={{ href: "/tools/warehouse/receipts", label: "Receipts" }}
        intro={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ReceiptStatusBadge status={r.status} />
            <span>{isDraft ? "Check-in started" : "Booked"} {ukDateTime(r.createdAt)}{r.createdByName ? <> by <span className="font-medium text-gray-700 dark:text-gray-200">{r.createdByName}</span></> : null}</span>
            <span aria-hidden>·</span>
            <span className="font-medium text-gray-700 dark:text-gray-200">{customerName}</span>
            {r.vendorNo && <span className={mono}>({r.vendorNo})</span>}
            {!isVoid && !isDraft && <span className="basis-full text-xs">{RECEIPT_STATUS[status].label}: {RECEIPT_STATUS[status].help}</span>}
          </span>
        }
      />

      {isVoid && (
        <div role="note" className="mb-4 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 px-4 py-3 text-sm leading-relaxed">
          {thrownAway ? (
            <>
              <p className="font-semibold">This check-in was thrown away before it was booked in</p>
              <p>Nothing on it was booked in. It&apos;s kept, marked void, because labels had been printed for it or a tote had been moved — the notes below name them, so a stray labelled tote can be traced. Throw any of those labels away.</p>
            </>
          ) : (
            <>
              <p className="font-semibold">This receipt is void</p>
              <p>{RECEIPT_STATUS.void.help} It can&apos;t be printed, emailed or added to.{atLeast(me, "manager") ? " You can restore it below." : " A manager can restore it."}</p>
            </>
          )}
        </div>
      )}

      {isDraft && (
        <DraftBanner
          id={r.id}
          customer={customerName}
          startedBy={r.createdByName}
          // Labels printed for totes still on it, and for ones taken off it after printing (the notes record those).
          printed={[...new Set([...containers.filter(c => c.labelPrintedAt).map(c => c.id), ...labelsGivenUp(r.notes)])]}
          moved={containers.some(c => !!c.movedAt || !!c.locationCode)}
          rows={containers.length}
        />
      )}

      <ReceiptActions
        id={r.id}
        status={status}
        canVoid={atLeast(me, "manager") && !thrownAway}
        snapshotEmail={snap?.email ?? null}
        liveEmail={live.email && !same(live.email, snap?.email) ? live.email : null}
        containerCount={containers.length}
        unprintedLabels={containers.filter(c => !c.labelPrintedAt).map(c => c.id)}
        userName={me.name}
      />

      {/* What has gone out, and when (a check-in not booked in yet has only labels to print) */}
      {(!isDraft || containers.length > 0) && (
        <p className="-mt-3 mb-6 text-sm text-gray-600 dark:text-gray-300 flex flex-wrap gap-x-3 gap-y-1">
          {!isDraft && (
            <>
              <span>{r.printedAt ? <>Printed <b className="font-semibold">{ukDateTime(r.printedAt)}</b></> : <span className="text-gray-500 dark:text-gray-400">Not printed yet</span>}</span>
              <span aria-hidden className="text-gray-400">·</span>
              <span>{r.emailedAt ? <>Emailed{r.emailedTo ? <> to <b className="font-semibold break-all">{r.emailedTo}</b></> : null} <b className="font-semibold">{ukDateTime(r.emailedAt)}</b></> : <span className="text-gray-500 dark:text-gray-400">Not emailed yet</span>}</span>
            </>
          )}
          {containers.length > 0 && (
            <>
              {!isDraft && <span aria-hidden className="text-gray-400">·</span>}
              <span className={labelsPrinted < containers.length ? "text-amber-700 dark:text-amber-300" : undefined}>
                Labels printed for {labelsPrinted} of {containers.length}
              </span>
            </>
          )}
        </p>
      )}

      {/* ── Totes & pallets ── */}
      <section className="mb-8" aria-labelledby="totes-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="totes-heading" className="text-lg font-bold text-gray-900 dark:text-white">Totes &amp; pallets</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {kindCounts(containers)}
              {containers.length > 0 && <> · {lotsMade === 0 ? "no lots made yet" : `${lotsMade} lot${lotsMade === 1 ? "" : "s"} made so far`}</>}
            </p>
          </div>
          {containers.length > 0 && !isDraft && <StatusCounts containers={containers} />}
        </div>

        <datalist id={CATEGORY_LIST_ID}>
          {loaded.categories.map(c => <option key={c} value={c} />)}
        </datalist>

        {containers.length === 0 ? (
          <div className={`${box} px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400`}>
            No totes or pallets on this receipt.{status === "open" ? " Add them below." : isDraft ? " Add them when you carry on checking in." : ""}
          </div>
        ) : (
          <ContainersTable receiptId={r.id} containers={containers} highlight={highlight} isVoid={isVoid} isDraft={isDraft} />
        )}

        <div className="mt-4">
          {status === "open" && <AddContainers receiptId={r.id} categoriesListId={CATEGORY_LIST_ID} />}
          {isDraft && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              To add, change or remove totes and pallets, <CarryOnLink receiptId={r.id} className="inline-flex items-center min-h-11 font-medium text-indigo-700 dark:text-indigo-300 underline">carry on checking in</CarryOnLink>.
            </p>
          )}
          {status === "closed" && (
            <p className="text-sm text-gray-500 dark:text-gray-400">This receipt is closed. Reopen it (button at the top) to add more totes or pallets.</p>
          )}
        </div>

        {containers.length > 0 && (
          <div className={`${box} mt-4 p-4`}>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">What the statuses mean</p>
            <StatusKey />
          </div>
        )}
      </section>

      {otherLots.length > 0 && (
        <section className="mb-8" aria-labelledby="other-lots-heading">
          <h2 id="other-lots-heading" className="text-lg font-bold text-gray-900 dark:text-white">Other lots on this receipt</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            {otherLots.length} lot{otherLots.length === 1 ? " carries" : "s carry"} receipt <span className={mono}>{r.id}</span> but no tote from the list above — usually because the tote was cleared on the lot.
          </p>
          <LotList lots={otherLots} />
        </section>
      )}

      {/* ── Customer, terms, notes ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <section className={`${box} p-4`} aria-labelledby="cust-heading">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
            <h2 id="cust-heading" className="text-base font-bold text-gray-900 dark:text-white">Customer</h2>
            <Link href={`/tools/warehouse/customers/${encodeURIComponent(r.contactId)}`} className="text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:underline inline-flex items-center min-h-11 -my-2">
              Open their record →
            </Link>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {isDraft
              ? "As it will go on the receipt — brought up to date from their record when it's booked in."
              : snap ? "As printed on the receipt." : "No copy was kept on this receipt — this is their record as it is now."}
          </p>

          <p className="font-semibold text-gray-900 dark:text-white">{[shown.salutation, shown.name || liveName].filter(Boolean).join(" ")}</p>
          <address className="not-italic text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            {[shown.addressLine1, shown.addressLine2, shown.town, shown.county, shown.postcode, shown.country].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
            {![shown.addressLine1, shown.addressLine2, shown.town, shown.postcode].some(Boolean) && <div className="text-gray-500 dark:text-gray-400">No address given</div>}
          </address>

          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Vendor no.</dt>
            <dd className={`${mono} text-gray-900 dark:text-white`}>{shown.vendorNo ?? r.vendorNo ?? "—"}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Email</dt>
            <dd className="break-all">{shown.email ? <a href={`mailto:${shown.email}`} className="text-indigo-700 dark:text-indigo-300 hover:underline">{shown.email}</a> : <span className="text-gray-500 dark:text-gray-400">—</span>}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Mobile</dt>
            <dd>{shown.mobile ? <a href={`tel:${shown.mobile.replace(/\s+/g, "")}`} className="text-indigo-700 dark:text-indigo-300 hover:underline">{shown.mobile}</a> : <span className="text-gray-500 dark:text-gray-400">—</span>}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Phone</dt>
            <dd>{shown.phone ? <a href={`tel:${shown.phone.replace(/\s+/g, "")}`} className="text-indigo-700 dark:text-indigo-300 hover:underline">{shown.phone}</a> : <span className="text-gray-500 dark:text-gray-400">—</span>}</dd>
            {shown.vatRegNo && (
              <>
                <dt className="text-gray-500 dark:text-gray-400">VAT reg. no.</dt>
                <dd className={mono}>{shown.vatRegNo}</dd>
              </>
            )}
          </dl>

          {!isDraft && snap && changed.length > 0 && (
            <div role="note" className="mt-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
              <p>
                <b>Their record has changed since this was booked</b> — {changed.join(", ")}. The receipt keeps the details as they were on the day.
              </p>
              <Link href={`/tools/warehouse/customers/${encodeURIComponent(r.contactId)}`} className="underline font-medium inline-flex items-center min-h-8">See their details now</Link>
            </div>
          )}
        </section>

        <section className={`${box} p-4`} aria-labelledby="terms-heading">
          <h2 id="terms-heading" className="text-base font-bold text-gray-900 dark:text-white mb-1">Terms</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {isDraft
              ? "The terms it will be booked in on. They can be changed for this receipt at Check & book in."
              : "Agreed when the goods were booked in, as printed on the receipt."}
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Commission</dt>
            <dd className="font-semibold text-gray-900 dark:text-white tabular-nums">{percent(r.commission)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Lotting fee</dt>
            <dd className="font-semibold text-gray-900 dark:text-white tabular-nums">{pounds(r.lottingFee)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Photography</dt>
            <dd className="font-semibold text-gray-900 dark:text-white tabular-nums">{pounds(r.photographyFee)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Unsold fee</dt>
            <dd className="font-semibold text-gray-900 dark:text-white tabular-nums">{pounds(r.unsoldFee)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Reserve</dt>
            <dd className="text-gray-900 dark:text-white">{r.reservePercent == null ? "—" : <><b className="tabular-nums">{r.reservePercent}%</b> of the bottom estimate</>}</dd>
          </dl>
          <ul className="mt-4 space-y-1.5 text-sm">
            <li className="flex items-start gap-2">
              <span aria-hidden className={r.ownerConfirmed ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-gray-500 dark:text-gray-400"}>{r.ownerConfirmed ? "✓" : "○"}</span>
              <span className={r.ownerConfirmed ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}>
                {r.ownerConfirmed ? "Confirmed they are the legal owner" : isDraft ? "“Legal owner” not ticked yet" : "Didn't tick “legal owner”"}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden className={r.agentConfirmed ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-gray-500 dark:text-gray-400"}>{r.agentConfirmed ? "✓" : "○"}</span>
              <span className={r.agentConfirmed ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}>
                {r.agentConfirmed ? "Acting as agent for the legal owner" : "Not acting as an agent"}
              </span>
            </li>
          </ul>
        </section>

        <section className={`${box} p-4 md:col-span-2 xl:col-span-1`} aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="text-base font-bold text-gray-900 dark:text-white mb-3">Notes</h2>
          {isDraft ? (
            // A draft's notes are written on the Check in screen (the receipt can't be changed from here until it's booked in).
            <>
              <p className={`text-sm whitespace-pre-line ${r.notes ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400 italic"}`}>{r.notes || "None yet"}</p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Notes are added at Check &amp; book in. Staff only — not printed on the receipt.</p>
            </>
          ) : (
            <NotesEditor receiptId={r.id} notes={r.notes} />
          )}
        </section>
      </div>
    </div>
  )
}

// ─── Loading ──────────────────────────────────────────────────────────────────────────────

async function load(id: string, me: { id: string; role: string }) {
  if (!id) return null
  const r = await prisma.goodsInReceipt.findUnique({
    where: { id },
    include: {
      contact: {
        select: {
          id: true, name: true, salutation: true, email: true, phone: true, addressLine1: true, addressLine2: true, postcode: true,
          goodsInCustomer: { select: { vendorNo: true, mobile: true, town: true, county: true, country: true, vatRegNo: true } },
        },
      },
      containers: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  })
  if (!r) return null

  const ids = r.containers.map(c => c.id)
  const [lots, catRows, access] = await Promise.all([
    prisma.catalogueLot.findMany({
      where: {
        OR: [
          ...ids.map(t => ({ tote: { equals: t, mode: "insensitive" as const } })),
          { receipt: { equals: r.id, mode: "insensitive" as const } },
        ],
      },
      select: {
        id: true, barcode: true, title: true, tote: true, receipt: true, auctionId: true,
        auction: { select: { id: true, code: true, name: true, auctionType: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 5000,
    }),
    prisma.goodsInContainer.groupBy({
      by: ["category"],
      where: { category: { not: null } },
      _count: { category: true },
      orderBy: { _count: { category: "desc" } },
      take: 80,
    }),
    getDepartmentAccess(me.id, me.role),
  ])

  // Each lot's shelf: its latest Goods In move.
  const lotIds = lots.map(l => l.id)
  const moves = lotIds.length
    ? await prisma.goodsInMovement.findMany({
        where: { lotId: { in: lotIds } },
        orderBy: { movedAt: "desc" },
        select: { lotId: true, locationCode: true, movedAt: true },
      })
    : []
  const shelf = new Map<string, { code: string; at: Date }>()
  for (const m of moves) if (m.lotId && !shelf.has(m.lotId)) shelf.set(m.lotId, { code: m.locationCode, at: m.movedAt })

  const codes = [...new Set(r.containers.map(c => c.locationCode).filter((c): c is string => !!c))]
  const locs = codes.length ? await prisma.goodsInLocation.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } }) : []
  const locName = new Map(locs.map(l => [l.code, l.name]))

  const idSet = new Set(ids)
  const byTote = new Map<string, LotView[]>()
  const otherLots: LotView[] = []
  for (const l of lots) {
    const view: LotView = {
      id: l.id, barcode: l.barcode, title: l.title, auctionId: l.auctionId,
      auctionCode: l.auction?.code ?? null, auctionName: l.auction?.name ?? null,
      canOpenSale: !!l.auction && canSeeAuction(access, { id: l.auction.id, auctionType: l.auction.auctionType }),
      shelf: shelf.get(l.id)?.code ?? null, shelvedAt: shelf.get(l.id)?.at.toISOString() ?? null,
    }
    const tote = l.tote ? normaliseCode(l.tote) : ""
    if (tote && idSet.has(tote)) {
      const list = byTote.get(tote) ?? []
      list.push(view)
      byTote.set(tote, list)
    } else {
      otherLots.push(view)
    }
  }

  const containers: ContainerView[] = r.containers.map(c => ({
    id: c.id, kind: c.kind, category: c.category, description: c.description, status: c.status,
    locationCode: c.locationCode, locationKind: c.locationKind, locationName: c.locationCode ? locName.get(c.locationCode) ?? null : null,
    movedAt: c.movedAt?.toISOString() ?? null, labelPrintedAt: c.labelPrintedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(), createdByName: c.createdByName,
    lots: byTote.get(c.id) ?? [],
  }))

  // The customer as printed (the snapshot) and as their record stands now.
  const g = r.contact.goodsInCustomer
  const live: CustomerSnapshot = {
    salutation: r.contact.salutation, name: r.contact.name, addressLine1: r.contact.addressLine1, addressLine2: r.contact.addressLine2,
    town: g?.town ?? null, county: g?.county ?? null, postcode: r.contact.postcode, country: g?.country ?? null,
    email: r.contact.email, mobile: g?.mobile ?? null, phone: r.contact.phone, vatRegNo: g?.vatRegNo ?? null, vendorNo: g?.vendorNo ?? null,
  }
  const snap = asSnapshot(r.customer)
  const changed = snap ? [...new Set(FIELD_WORDS.filter(([k]) => !same(snap[k], live[k])).map(([, w]) => w))] : []

  const categories = catRows.map(c => c.category).filter((c): c is string => !!c)

  return { r, containers, otherLots, snap, live, changed, liveName: r.contact.name, categories }
}
