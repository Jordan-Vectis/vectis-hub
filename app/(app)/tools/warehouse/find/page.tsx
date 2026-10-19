import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import type { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { canSeeAuction, getDepartmentAccess } from "@/lib/departments"
import { lookupCode } from "@/lib/actions/goods-in"
import { normaliseCode } from "@/lib/goods-in/model"
import { box, btn, btnGo, mono, th, td, ErrorBox, KindBadge, NotReady, PageHeader, StatusBadge, StatusKey, isMissingTable, ukDate, ukDateTime } from "../_components/ui"
import { kindWord, plural } from "../move/words"
import { MarkCatalogued } from "../bench/bench-actions"
import { CarryOnLink, ReceiptStatusBadge } from "../receipts/_parts"
import FindBox from "./find-box"

// Goods In → Find. One box for anything: a tote or pallet, a lot barcode, a receipt, a location or
// a vendor number. What it is gets worked out on the server (lookupCode); a receipt or a customer
// goes straight to its own page, everything else gets a full card here. Read-only — the only
// write on this screen is the bench's "Mark catalogued" button on a tote that is at a bench.
//
// ⚠ A sale is linked only for someone whose departments let them open it (lib/departments.ts —
// RULES "Departments gate which sales a cataloguer sees"); anyone else sees the sale code as text.
//
// A tote or pallet on a check-in that hasn't been booked in yet (a draft receipt) says so plainly —
// "Not booked in yet", with Carry on checking in — rather than reading as booked in. Its label can
// still be printed (labels are allowed for a draft).

export const dynamic = "force-dynamic"

type Place = { code: string; name: string | null; kind: string | null; active: boolean | null }
type Move = { id: string; locationCode: string; fromCode: string | null; note: string | null; movedByName: string | null; movedAt: Date }
type ToteLot = { id: string; barcode: string | null; title: string; status: string; auctionId: string; auctionCode: string | null; auctionType: string | null; shelf: string | null; shelvedAt: Date | null }
type PlaceLot = { lotId: string; moveBarcode: string | null; movedAt: Date; movedByName: string | null; barcode: string | null; title: string | null; status: string | null; auctionId: string | null; auctionCode: string | null; auctionType: string | null }
type LooseLot = {
  id: string; barcode: string | null; title: string; status: string; tote: string | null; receipt: string | null; vendor: string | null
  receiptUniqueId: string | null; auctionId: string; auctionCode: string | null; auctionType: string | null; total: number
}

const MOVE_SELECT = { id: true, lotId: true, locationCode: true, fromCode: true, note: true, movedByName: true, movedAt: true } as const
const LOT_STATUS: Record<string, string> = { ENTERED: "Entered", REVIEWED: "Reviewed", PUBLISHED: "Published", SOLD: "Sold", UNSOLD: "Unsold", WITHDRAWN: "Withdrawn" }
const lotStatus = (s: string | null | undefined) => (s ? LOT_STATUS[s] ?? s : "—")
const strings = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))]
const findHref = (code: string) => `/tools/warehouse/find?q=${encodeURIComponent(code)}`

// ─── Reading ──────────────────────────────────────────────────────────────────────────────

/** The lots made from a tote (CatalogueLot.tote, compared upper case without spaces) and each one's shelf — its latest move. */
function lotsFromTote(id: string) {
  return prisma.$queryRaw<ToteLot[]>`
    SELECT l."id", l."barcode", l."title", l."status", l."auctionId", a."code" AS "auctionCode", a."auctionType",
           s."locationCode" AS "shelf", s."movedAt" AS "shelvedAt"
    FROM "CatalogueLot" l
    LEFT JOIN "CatalogueAuction" a ON a."id" = l."auctionId"
    LEFT JOIN LATERAL (
      SELECT m."locationCode", m."movedAt" FROM "GoodsInMovement" m
      WHERE m."lotId" = l."id" ORDER BY m."movedAt" DESC LIMIT 1
    ) s ON true
    WHERE upper(replace(btrim(l."tote"), ' ', '')) = ${id}
    ORDER BY l."createdAt" ASC
    LIMIT 500`
}

async function placesFor(codes: string[]): Promise<Record<string, Place>> {
  if (!codes.length) return {}
  const rows = await prisma.goodsInLocation.findMany({ where: { code: { in: codes } }, select: { code: true, name: true, kind: true, active: true } })
  return Object.fromEntries(rows.map(r => [r.code, r]))
}

async function loadContainer(id: string) {
  const c = await prisma.goodsInContainer.findUnique({
    where: { id },
    include: {
      receipt: { select: { id: true, createdAt: true, status: true, vendorNo: true, contactId: true, contact: { select: { name: true } } } },
      movements: { orderBy: { movedAt: "desc" }, take: 200, select: MOVE_SELECT },
    },
  })
  if (!c) return null
  const [lots, places] = await Promise.all([
    lotsFromTote(id),
    placesFor(strings([c.locationCode, ...c.movements.flatMap(m => [m.locationCode, m.fromCode])])),
  ])
  return { c, lots, places }
}

async function loadLots(where: Prisma.CatalogueLotWhereInput) {
  const lots = await prisma.catalogueLot.findMany({
    where,
    select: {
      id: true, barcode: true, title: true, status: true, tote: true, receipt: true, vendor: true, receiptUniqueId: true,
      category: true, subCategory: true, createdAt: true, createdByName: true, auctionId: true,
      auction: { select: { code: true, name: true, auctionDate: true, auctionType: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  })
  const ids = lots.map(l => l.id)
  const toteIds = strings(lots.map(l => (l.tote ? normaliseCode(l.tote) : null)))
  // (An empty `in` list simply matches nothing.)
  const [moves, containers] = await Promise.all([
    prisma.goodsInMovement.findMany({ where: { lotId: { in: ids } }, orderBy: { movedAt: "desc" }, take: 500, select: MOVE_SELECT }),
    prisma.goodsInContainer.findMany({ where: { id: { in: toteIds } }, select: { id: true, receiptId: true, locationCode: true, status: true } }),
  ])
  const receiptIds = strings([...lots.map(l => (l.receipt ? normaliseCode(l.receipt) : null)), ...containers.map(c => c.receiptId)])
  const [receipts, places] = await Promise.all([
    prisma.goodsInReceipt.findMany({ where: { id: { in: receiptIds } }, select: { id: true, status: true, contactId: true, contact: { select: { name: true } } } }),
    placesFor(strings([...moves.flatMap(m => [m.locationCode, m.fromCode]), ...containers.map(c => c.locationCode)])),
  ])
  return { lots, moves, containers, receipts, places }
}

async function loadLocation(code: string) {
  const [place, containers, lots] = await Promise.all([
    prisma.goodsInLocation.findUnique({ where: { code }, select: { code: true, name: true, kind: true, active: true } }),
    prisma.goodsInContainer.findMany({
      where: { locationCode: code },
      select: { id: true, kind: true, category: true, description: true, status: true, movedAt: true, receiptId: true, receipt: { select: { status: true, contactId: true, contact: { select: { name: true } } } } },
      orderBy: { movedAt: "desc" },
      take: 500,
    }),
    // Lots whose LATEST move is to this location — a lot moved on since is somewhere else now.
    prisma.$queryRaw<PlaceLot[]>`
      SELECT cur."lotId", cur."barcode" AS "moveBarcode", cur."movedAt", cur."movedByName",
             l."barcode", l."title", l."status", l."auctionId", a."code" AS "auctionCode", a."auctionType"
      FROM (
        SELECT DISTINCT ON (m."lotId") m."lotId", m."barcode", m."locationCode", m."movedAt", m."movedByName"
        FROM "GoodsInMovement" m
        WHERE m."lotId" IN (SELECT "lotId" FROM "GoodsInMovement" WHERE "locationCode" = ${code} AND "lotId" IS NOT NULL)
        ORDER BY m."lotId", m."movedAt" DESC
      ) cur
      LEFT JOIN "CatalogueLot" l ON l."id" = cur."lotId"
      LEFT JOIN "CatalogueAuction" a ON a."id" = l."auctionId"
      WHERE cur."locationCode" = ${code}
      ORDER BY cur."movedAt" DESC
      LIMIT 1000`,
  ])
  return { place, containers, lots }
}

/** Lots that carry the code as their tote, receipt, unique ID or vendor — e.g. goods booked in before Goods In existed. */
function loadLoose(code: string) {
  return prisma.$queryRaw<LooseLot[]>`
    SELECT l."id", l."barcode", l."title", l."status", l."tote", l."receipt", l."vendor", l."receiptUniqueId", l."auctionId",
           a."code" AS "auctionCode", a."auctionType", count(*) OVER ()::int AS "total"
    FROM "CatalogueLot" l
    LEFT JOIN "CatalogueAuction" a ON a."id" = l."auctionId"
    WHERE upper(replace(btrim(l."tote"), ' ', '')) = ${code}
       OR upper(replace(btrim(l."receipt"), ' ', '')) = ${code}
       OR upper(replace(btrim(l."receiptUniqueId"), ' ', '')) = ${code}
       OR upper(replace(btrim(l."vendor"), ' ', '')) = ${code}
    ORDER BY a."code" DESC NULLS LAST, l."barcode" ASC
    LIMIT 200`
}

type ContainerData = NonNullable<Awaited<ReturnType<typeof loadContainer>>>
type LotsData = Awaited<ReturnType<typeof loadLots>>
type LocationData = Awaited<ReturnType<typeof loadLocation>>

type Found =
  | { kind: "error"; error: string }
  | { kind: "notready" }
  | { kind: "redirect"; href: string }
  | { kind: "none"; code: string }
  | ({ kind: "container" } & ContainerData)
  | ({ kind: "lots"; code: string } & LotsData)
  | ({ kind: "location"; code: string } & LocationData)
  | { kind: "loose"; code: string; lots: LooseLot[] }

async function find(code: string): Promise<Found> {
  const res = await lookupCode(code)
  if (!res.ok) return /Run Migrations/i.test(res.error) ? { kind: "notready" } : { kind: "error", error: res.error }
  const hit = res.data
  if (hit) {
    switch (hit.type) {
      case "receipt": return { kind: "redirect", href: `/tools/warehouse/receipts/${encodeURIComponent(hit.id)}` }
      case "customer": return { kind: "redirect", href: `/tools/warehouse/customers/${encodeURIComponent(hit.id)}` }
      case "container": {
        const d = await loadContainer(hit.id)
        return d ? { kind: "container", ...d } : { kind: "none", code }
      }
      case "lot": {
        const d = await loadLots({ barcode: { equals: code, mode: "insensitive" } })
        return d.lots.length ? { kind: "lots", code, ...d } : { kind: "none", code }
      }
      case "location": return { kind: "location", code: hit.code, ...(await loadLocation(hit.code)) }
    }
  }
  // Nothing in Goods In answers to it. A lot's unique ID (R000016-413) still finds the lot itself;
  // otherwise, lots that carry it as their tote, receipt or vendor number.
  const byUid = await prisma.catalogueLot.findMany({ where: { receiptUniqueId: { equals: code, mode: "insensitive" } }, select: { id: true }, take: 10 })
  if (byUid.length) return { kind: "lots", code, ...(await loadLots({ id: { in: byUid.map(l => l.id) } })) }
  const loose = await loadLoose(code)
  return loose.length ? { kind: "loose", code, lots: loose } : { kind: "none", code }
}

// ─── The page ─────────────────────────────────────────────────────────────────────────────

export default async function FindPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const sp = await searchParams
  const raw = ((Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "").trim()
  const code = normaliseCode(raw)
  const user = await getGoodsInUser()

  const header = (
    <PageHeader
      title="Find"
      back={{ href: "/tools/warehouse", label: "Goods In" }}
      intro="Scan or type anything — a tote or pallet, a lot barcode, a receipt, a location or a vendor number — to see what it is and where it is."
    />
  )
  const shell = (body: ReactNode) => (
    <div className="p-4 sm:p-6 lg:p-8">
      {header}
      {body}
    </div>
  )

  if (!user) return shell(<ErrorBox>Your account doesn&apos;t have Warehouse access.</ErrorBox>)

  const searchBox = (
    <section className={`${box} p-4 sm:p-5`}>
      <div className="max-w-2xl"><FindBox current={code || null} /></div>
    </section>
  )

  if (!code) {
    return shell(
      <div className="space-y-6">
        {searchBox}
        <section className={`${box} p-5`}>
          <h2 className="font-semibold text-gray-900 dark:text-white mb-3">What you can scan or type here</h2>
          <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-200 leading-relaxed max-w-3xl">
            <li><b>A tote or pallet</b> <span className={`${mono} text-gray-500 dark:text-gray-400`}>T027657 · P000123</span> — its receipt and customer, where it is now, everywhere it has been, and the lots made from it.</li>
            <li><b>A lot barcode</b> <span className={`${mono} text-gray-500 dark:text-gray-400`}>F066001</span> — its sale, the tote and receipt it came from, and which shelf it is on.</li>
            <li><b>A location</b> <span className={`${mono} text-gray-500 dark:text-gray-400`}>BENCH12 · A10A1</span> — every tote, pallet and lot there right now.</li>
            <li><b>A receipt</b> <span className={`${mono} text-gray-500 dark:text-gray-400`}>R010244</span> — opens the receipt.</li>
            <li><b>A vendor number</b> — opens the customer.</li>
          </ul>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Capitals and spaces don&apos;t matter. To look a customer up by name, use <Link href="/tools/warehouse/customers" className="underline">Customers</Link>.</p>
        </section>
      </div>,
    )
  }

  let found: Found
  let canOpen: CanOpen = () => false
  try {
    const access = await getDepartmentAccess(user.id, user.role)
    canOpen = (auctionId, auctionType) => !!auctionId && canSeeAuction(access, { id: auctionId, auctionType: auctionType ?? null })
    found = await find(code)
  } catch (e) {
    if (isMissingTable(e)) return shell(<NotReady />)
    console.error("goods-in find page:", e)
    found = { kind: "error", error: `The search couldn't be finished just now — try again. (${String((e as Error)?.message ?? e).slice(0, 160)})` }
  }
  // Outside the try: redirect() works by throwing.
  if (found.kind === "redirect") redirect(found.href)

  return shell(
    <div className="space-y-6">
      {searchBox}
      <Result found={found} raw={raw} canOpen={canOpen} />
    </div>,
  )
}

function Result({ found, raw, canOpen }: { found: Found; raw: string; canOpen: CanOpen }) {
  switch (found.kind) {
    case "notready": return <NotReady />
    case "error": return <ErrorBox>{found.error}</ErrorBox>
    case "container": return <ContainerView d={found} canOpen={canOpen} />
    case "lots": return <LotsView d={found} code={found.code} canOpen={canOpen} />
    case "location": return <LocationView d={found} code={found.code} canOpen={canOpen} />
    case "loose": return <LooseView code={found.code} lots={found.lots} canOpen={canOpen} />
    case "none": return <NothingFound code={found.code} raw={raw} />
    case "redirect": return null
  }
}

// ─── Bits shared by the cards ─────────────────────────────────────────────────────────────

/** May this person open that sale? (Their departments — lib/departments.ts.) */
type CanOpen = (auctionId: string | null | undefined, auctionType: string | null | undefined) => boolean

/** A lot's sale code: a link to the sale for someone allowed to open it, plain text for anyone else. */
function SaleCode({ auctionId, code, open }: { auctionId: string | null; code: string; open: boolean }) {
  return open && auctionId
    ? <Link href={`/tools/cataloguing/auctions/${encodeURIComponent(auctionId)}`} className={`${mono} text-xs text-indigo-700 dark:text-indigo-300 hover:underline`}>{code}</Link>
    : <span className={`${mono} text-xs text-gray-600 dark:text-gray-300`}>{code}</span>
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400">{k}</dt>
          <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className={`${box} overflow-hidden min-w-0`}>
      <h2 className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 font-semibold text-gray-900 dark:text-white">
        {title}
        {count != null && <span className="font-normal text-gray-500 dark:text-gray-400"> ({count.toLocaleString("en-GB")})</span>}
      </h2>
      {children}
    </section>
  )
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">{children}</p>

/** A location code that opens what is there, with its kind ("bench") beside it. */
function PlaceLink({ code, places }: { code: string; places: Record<string, Place> }) {
  const p = places[code]
  return (
    <span className="whitespace-nowrap">
      <Link href={findHref(code)} className={`${mono} font-semibold underline-offset-2 hover:underline`}>{code}</Link>
      {p && <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">({kindWord(p.kind)})</span>}
    </span>
  )
}

const LotBadge = () => (
  <span className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Lot</span>
)

/** Every move, newest first — a list on phones, a table with columns from a tablet up. */
function MoveHistory({ moves, places }: { moves: Move[]; places: Record<string, Place> }) {
  return (
    <>
      <ol className="sm:hidden divide-y divide-gray-200 dark:divide-gray-800">
        {moves.map((m, i) => (
          <li key={m.id} className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200 space-y-0.5">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {ukDateTime(m.movedAt)}{m.movedByName ? ` · ${m.movedByName}` : ""}
              {i === 0 && <span className="ml-2 font-semibold text-indigo-700 dark:text-indigo-300">Latest</span>}
            </p>
            <p>
              {m.fromCode ? <PlaceLink code={m.fromCode} places={places} /> : <span className="text-gray-500 dark:text-gray-400">Not anywhere</span>}
              <span aria-hidden className="mx-2 text-gray-400">→</span>
              <PlaceLink code={m.locationCode} places={places} />
            </p>
            {m.note && <p className="text-xs text-gray-600 dark:text-gray-300">{m.note}</p>}
          </li>
        ))}
      </ol>
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              <th className={th}>When</th>
              <th className={th}>From</th>
              <th className={th}>To</th>
              <th className={th}>By</th>
              <th className={th}>Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {moves.map((m, i) => (
              <tr key={m.id}>
                <td className={`${td} whitespace-nowrap`}>
                  {ukDateTime(m.movedAt)}
                  {i === 0 && <span className="ml-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">Latest</span>}
                </td>
                <td className={td}>{m.fromCode ? <PlaceLink code={m.fromCode} places={places} /> : <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                <td className={td}><PlaceLink code={m.locationCode} places={places} /></td>
                <td className={`${td} whitespace-nowrap`}>{m.movedByName ?? "—"}</td>
                <td className={td}>{m.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── A tote or pallet ─────────────────────────────────────────────────────────────────────

function ContainerView({ d, canOpen }: { d: ContainerData; canOpen: CanOpen }) {
  const { c, lots, places } = d
  const here = c.locationCode ? places[c.locationCode] : null
  const atBench = c.locationKind === "bench" && !!c.locationCode
  const shelved = lots.filter(l => l.shelf).length
  const isDraft = c.receipt.status === "draft"
  return (
    <div className="space-y-4">
      <section className={`${box} p-4 sm:p-5 space-y-4`}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className={`${mono} text-3xl font-bold text-gray-900 dark:text-white`}>{c.id}</h2>
          <KindBadge kind={c.kind} />
          {isDraft ? <DraftChips status={c.status} /> : <StatusBadge status={c.status} />}
          <div className="ml-auto flex flex-wrap gap-2">
            <Link href={`/tools/warehouse/move?item=${encodeURIComponent(c.id)}`} className={btnGo}>Move it</Link>
            {/* A voided receipt's labels aren't printed (the labels route refuses them too). */}
            {c.receipt.status !== "void" && <a href={`/api/goods-in/labels?containers=${encodeURIComponent(c.id)}`} target="_blank" rel="noopener" className={btn}>Print its label</a>}
          </div>
        </div>
        {isDraft && (
          <div role="note" className="rounded-lg border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="min-w-0 flex-1 basis-64">
              <b>Not booked in yet.</b> {c.id} is on check-in <span className={`${mono} font-semibold`}>{c.receipt.id}</span> for {c.receipt.contact.name}, which hasn&apos;t been booked in.
            </p>
            <CarryOnLink receiptId={c.receipt.id} className={btnGo} />
          </div>
        )}
        <Facts
          items={[
            [
              "Where it is now",
              c.locationCode ? (
                <>
                  <PlaceLink code={c.locationCode} places={places} />
                  {here?.name && <span className="text-gray-600 dark:text-gray-300"> · {here.name}</span>}
                  {c.movedAt && <span className="block text-xs text-gray-500 dark:text-gray-400">since {ukDateTime(c.movedAt)}</span>}
                </>
              ) : (
                "Not put anywhere yet"
              ),
            ],
            ["Customer", <Link key="c" href={`/tools/warehouse/customers/${encodeURIComponent(c.receipt.contactId)}`} className="font-semibold underline-offset-2 hover:underline">{c.receipt.contact.name}</Link>],
            [
              "Receipt",
              <span key="r">
                <Link href={`/tools/warehouse/receipts/${encodeURIComponent(c.receipt.id)}`} className={`${mono} font-semibold underline-offset-2 hover:underline`}>{c.receipt.id}</Link>
                <span className="text-gray-500 dark:text-gray-400">{isDraft ? ` · check-in started ${ukDate(c.receipt.createdAt)}, not booked in yet` : ` · booked in ${ukDate(c.receipt.createdAt)}`}</span>
                {c.receipt.status === "void" && <span className="ml-1 font-semibold text-red-700 dark:text-red-300">(voided)</span>}
              </span>,
            ],
            ["Category", c.category ?? "—"],
            ["Description", c.description ?? "—"],
            ["Vendor no.", c.receipt.vendorNo ? <span className={mono}>{c.receipt.vendorNo}</span> : "—"],
            ["Lots made from it", lots.length === 0 ? "None yet" : `${plural(lots.length, "lot")}${shelved ? ` · ${shelved.toLocaleString("en-GB")} on a shelf` : ""}`],
            [isDraft ? "Numbered by" : "Booked in by", c.createdByName ?? "—"],
            ["Label printed", c.labelPrintedAt ? ukDateTime(c.labelPrintedAt) : "Not yet"],
          ]}
        />
        {atBench && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
              {c.status === "catalogued" ? "Marked catalogued — move it off the bench when it's cleared." : "At a bench being catalogued. Mark it catalogued once all its lots are made."}
            </p>
            <MarkCatalogued id={c.id} status={c.status} lots={lots.length} />
          </div>
        )}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <StatusKey />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2 items-start">
        <Section title="Where it has been" count={c.movements.length}>
          {c.movements.length === 0 ? <Quiet>Not moved yet — it hasn&apos;t been put anywhere since it was {isDraft ? "numbered" : "booked in"}.</Quiet> : <MoveHistory moves={c.movements} places={places} />}
        </Section>
        <Section title="Lots made from it" count={lots.length}>
          {lots.length === 0 ? (
            <Quiet>No lots have been made from {c.id} yet. Lots appear here when a cataloguer enters this tote number on a lot in the Add Lot wizard.</Quiet>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {lots.map(l => (
                <li key={l.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {l.barcode ? (
                    <Link href={findHref(l.barcode)} className={`${mono} font-bold text-gray-900 dark:text-white hover:underline`}>{l.barcode}</Link>
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-gray-400">No barcode</span>
                  )}
                  <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200 break-words">{l.title}</span>
                  {l.auctionCode && <SaleCode auctionId={l.auctionId} code={l.auctionCode} open={canOpen(l.auctionId, l.auctionType)} />}
                  <span className="basis-full text-xs text-gray-500 dark:text-gray-400">
                    {lotStatus(l.status)} ·{" "}
                    {l.shelf ? <>on shelf <Link href={findHref(l.shelf)} className={`${mono} font-semibold hover:underline`}>{l.shelf}</Link> since {ukDateTime(l.shelvedAt)}</> : "not shelved yet"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}

/** A tote on a check-in not booked in yet: "Not booked in yet", plus where it has got to if it has been moved. */
function DraftChips({ status }: { status: string | null }) {
  return (
    <>
      <ReceiptStatusBadge status="draft" />
      {status && status !== "booked" && <StatusBadge status={status} />}
    </>
  )
}

// ─── A lot ────────────────────────────────────────────────────────────────────────────────

function LotsView({ d, code, canOpen }: { d: LotsData; code: string; canOpen: CanOpen }) {
  return (
    <div className="space-y-6">
      {d.lots.length > 1 && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {plural(d.lots.length, "lot")} carry <span className={`${mono} font-semibold`}>{code}</span> — a barcode can be used again in a later sale. Newest first.
        </p>
      )}
      {d.lots.map(lot => <LotCard key={lot.id} lot={lot} d={d} canOpenSale={canOpen(lot.auctionId, lot.auction?.auctionType)} />)}
    </div>
  )
}

function LotCard({ lot, d, canOpenSale }: { lot: LotsData["lots"][number]; d: LotsData; canOpenSale: boolean }) {
  const moves = d.moves.filter(m => m.lotId === lot.id)
  const shelf = moves[0] ?? null
  const toteId = lot.tote ? normaliseCode(lot.tote) : null
  const tote = toteId ? d.containers.find(c => c.id === toteId) ?? null : null
  const receiptId = lot.receipt ? normaliseCode(lot.receipt) : tote?.receiptId ?? null
  const receipt = receiptId ? d.receipts.find(r => r.id === receiptId) ?? null : null
  const id = lot.barcode ?? lot.receiptUniqueId
  return (
    <div className="space-y-4">
      <section className={`${box} p-4 sm:p-5 space-y-4`}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className={`${mono} text-3xl font-bold text-gray-900 dark:text-white`}>{id ?? "No barcode"}</h2>
          <LotBadge />
          <span className="text-sm text-gray-600 dark:text-gray-300">{lotStatus(lot.status)}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {lot.barcode && <Link href={`/tools/warehouse/move?item=${encodeURIComponent(lot.barcode)}`} className={btnGo}>Move it</Link>}
            {canOpenSale && <Link href={`/tools/cataloguing/auctions/${encodeURIComponent(lot.auctionId)}`} className={btn}>Open the sale</Link>}
          </div>
        </div>
        <p className="text-lg font-semibold text-gray-900 dark:text-white break-words">{lot.title}</p>
        <Facts
          items={[
            [
              "Shelf now",
              shelf ? (
                <>
                  <PlaceLink code={shelf.locationCode} places={d.places} />
                  <span className="block text-xs text-gray-500 dark:text-gray-400">since {ukDateTime(shelf.movedAt)}{shelf.movedByName ? ` · ${shelf.movedByName}` : ""}</span>
                </>
              ) : (
                "Not shelved yet"
              ),
            ],
            [
              "Sale",
              lot.auction ? (
                <span key="s">
                  <span className={`${mono} font-semibold`}>{lot.auction.code}</span> — {lot.auction.name}
                  {lot.auction.auctionDate && <span className="text-gray-500 dark:text-gray-400"> · {ukDate(lot.auction.auctionDate)}</span>}
                </span>
              ) : "—",
            ],
            [
              "Tote",
              lot.tote ? (
                <span key="t">
                  <Link href={findHref(lot.tote)} className={`${mono} font-semibold underline-offset-2 hover:underline`}>{toteId}</Link>
                  {tote && <span className="text-gray-500 dark:text-gray-400"> · {tote.locationCode ? <>now at <PlaceLink code={tote.locationCode} places={d.places} /></> : "not put anywhere"}</span>}
                </span>
              ) : "—",
            ],
            [
              "Receipt",
              receiptId ? (
                receipt ? (
                  <span key="r">
                    <Link href={`/tools/warehouse/receipts/${encodeURIComponent(receipt.id)}`} className={`${mono} font-semibold underline-offset-2 hover:underline`}>{receipt.id}</Link>
                    {receipt.status === "draft" && <span className="ml-1 font-semibold text-amber-700 dark:text-amber-300">(not booked in yet)</span>}
                  </span>
                ) : (
                  <Link key="r" href={findHref(receiptId)} className={`${mono} font-semibold underline-offset-2 hover:underline`}>{receiptId}</Link>
                )
              ) : "—",
            ],
            ["Customer", receipt ? <Link key="c" href={`/tools/warehouse/customers/${encodeURIComponent(receipt.contactId)}`} className="font-semibold underline-offset-2 hover:underline">{receipt.contact.name}</Link> : "—"],
            ["Vendor no.", lot.vendor ? <span className={mono}>{lot.vendor}</span> : "—"],
            ["Unique ID", lot.receiptUniqueId ? <span className={mono}>{lot.receiptUniqueId}</span> : "—"],
            ["Category", [lot.category, lot.subCategory].filter(Boolean).join(" › ") || "—"],
            ["Entered", `${ukDateTime(lot.createdAt)}${lot.createdByName ? ` by ${lot.createdByName}` : ""}`],
          ]}
        />
      </section>
      <Section title="Shelf history" count={moves.length}>
        {moves.length === 0 ? <Quiet>Never moved — it hasn&apos;t been put on a shelf yet.</Quiet> : <MoveHistory moves={moves} places={d.places} />}
      </Section>
    </div>
  )
}

// ─── A location ───────────────────────────────────────────────────────────────────────────

function LocationView({ d, code, canOpen }: { d: LocationData; code: string; canOpen: CanOpen }) {
  const { place, containers, lots } = d
  const empty = containers.length === 0 && lots.length === 0
  return (
    <div className="space-y-4">
      <section className={`${box} p-4 sm:p-5 space-y-3`}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className={`${mono} text-3xl font-bold text-gray-900 dark:text-white`}>{code}</h2>
          <span className="text-sm text-gray-600 dark:text-gray-300">
            {kindWord(place?.kind)}{place?.name ? ` · ${place.name}` : ""}
          </span>
          {place?.active === false && <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">switched off — nothing can be moved here</span>}
          <div className="ml-auto flex flex-wrap gap-2">
            {place?.active !== false && <Link href={`/tools/warehouse/move?to=${encodeURIComponent(code)}`} className={btnGo}>Move things here</Link>}
            <a href={`/api/goods-in/labels?locations=${encodeURIComponent(code)}`} target="_blank" rel="noopener" className={btn}>Print location label</a>
            <Link href={`/tools/warehouse/locations/${encodeURIComponent(code)}`} className={btn}>Manage this location</Link>
          </div>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-200">
          {empty
            ? <>Nothing is at <span className={`${mono} font-semibold`}>{code}</span> right now.</>
            : <>{plural(containers.length, "tote or pallet", "totes and pallets")} and {plural(lots.length, "lot")} here now.</>}
        </p>
      </section>

      {!empty && (
        <>
          <div className="grid gap-4 xl:grid-cols-2 items-start">
            <Section title="Totes and pallets here" count={containers.length}>
              {containers.length === 0 ? (
                <Quiet>No totes or pallets.</Quiet>
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                  {containers.map(c => (
                    <li key={c.id} className="px-4 py-3 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={findHref(c.id)} className={`${mono} font-bold text-gray-900 dark:text-white hover:underline`}>{c.id}</Link>
                        <KindBadge kind={c.kind} />
                        {c.receipt.status === "draft" ? <DraftChips status={c.status} /> : <StatusBadge status={c.status} />}
                        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">since {ukDateTime(c.movedAt)}</span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-200 break-words">
                        <Link href={`/tools/warehouse/customers/${encodeURIComponent(c.receipt.contactId)}`} className="hover:underline">{c.receipt.contact.name}</Link>
                        <span className="text-gray-400"> · </span>
                        <Link href={`/tools/warehouse/receipts/${encodeURIComponent(c.receiptId)}`} className={`${mono} hover:underline`}>{c.receiptId}</Link>
                        {(c.category || c.description) && <span className="text-gray-600 dark:text-gray-300"> · {[c.category, c.description].filter(Boolean).join(" — ")}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Lots here" count={lots.length}>
              {lots.length === 0 ? (
                <Quiet>No lots.</Quiet>
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                  {lots.map(l => {
                    const bc = l.barcode ?? l.moveBarcode
                    return (
                      <li key={l.lotId} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        {bc ? <Link href={findHref(bc)} className={`${mono} font-bold text-gray-900 dark:text-white hover:underline`}>{bc}</Link> : <span className="text-xs text-gray-500 dark:text-gray-400">No barcode</span>}
                        <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200 break-words">{l.title ?? "This lot is no longer in the Hub"}</span>
                        {l.auctionCode && <SaleCode auctionId={l.auctionId} code={l.auctionCode} open={canOpen(l.auctionId, l.auctionType)} />}
                        <span className="basis-full text-xs text-gray-500 dark:text-gray-400">
                          {lotStatus(l.status)} · here since {ukDateTime(l.movedAt)}{l.movedByName ? ` · ${l.movedByName}` : ""}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Section>
          </div>
          {containers.length > 0 && <StatusKey />}
          {(containers.length >= 500 || lots.length >= 1000) && (
            <p className="text-xs text-gray-500 dark:text-gray-400">Showing the first {containers.length >= 500 ? "500 totes and pallets" : ""}{containers.length >= 500 && lots.length >= 1000 ? " and " : ""}{lots.length >= 1000 ? "1,000 lots" : ""} — there are more here.</p>
          )}
        </>
      )}
    </div>
  )
}

// ─── Lots that only carry the code, and nothing at all ────────────────────────────────────

function LooseView({ code, lots, canOpen }: { code: string; lots: LooseLot[]; canOpen: CanOpen }) {
  const total = Number(lots[0]?.total ?? lots.length)
  const matched = (l: LooseLot) => {
    const as: string[] = []
    if (l.tote && normaliseCode(l.tote) === code) as.push("tote")
    if (l.receipt && normaliseCode(l.receipt) === code) as.push("receipt")
    if (l.receiptUniqueId && normaliseCode(l.receiptUniqueId) === code) as.push("unique ID")
    if (l.vendor && normaliseCode(l.vendor) === code) as.push("vendor no.")
    return as.join(", ")
  }
  return (
    <div className="space-y-4">
      <section className={`${box} p-4 sm:p-5 text-sm text-gray-700 dark:text-gray-200 leading-relaxed`}>
        <p className="text-lg font-semibold text-gray-900 dark:text-white">
          <span className={mono}>{code}</span> isn&apos;t a tote, pallet, receipt, location or customer in Goods In
        </p>
        <p className="mt-1">
          But {plural(total, "lot")} in the Hub {total === 1 ? "carries" : "carry"} it — most likely goods booked in before Goods In started. They are listed below; there is no move history for them here.
        </p>
      </section>
      <Section title={`Lots carrying ${code}`} count={total}>
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {lots.map(l => (
            <li key={l.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {l.barcode ? <Link href={findHref(l.barcode)} className={`${mono} font-bold text-gray-900 dark:text-white hover:underline`}>{l.barcode}</Link> : <span className="text-xs text-gray-500 dark:text-gray-400">No barcode</span>}
              <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200 break-words">{l.title}</span>
              {l.auctionCode && <SaleCode auctionId={l.auctionId} code={l.auctionCode} open={canOpen(l.auctionId, l.auctionType)} />}
              <span className="basis-full text-xs text-gray-500 dark:text-gray-400">{lotStatus(l.status)} · matched as its {matched(l) || "code"}</span>
            </li>
          ))}
        </ul>
        {total > lots.length && <Quiet>Showing the first {lots.length.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}.</Quiet>}
      </Section>
    </div>
  )
}

function NothingFound({ code, raw }: { code: string; raw: string }) {
  // Words with spaces and no digits look like a name — point at the customer search instead.
  const looksLikeName = /\s/.test(raw.trim()) && !/\d/.test(raw)
  return (
    <section role="status" className="rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-5 space-y-2 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
      <p className="text-xl font-bold text-gray-900 dark:text-white">
        Nothing found for <span className={`${mono} break-all`}>{code}</span>
      </p>
      <p>It isn&apos;t a tote, pallet, lot barcode, receipt, location or vendor number the Hub knows, and no lot carries it as a tote, receipt or vendor number.</p>
      <p>Check the label and scan again — a creased or faded label can misread — or type the code in.</p>
      {looksLikeName && (
        <p>
          Looking for a customer by name? Use <Link href="/tools/warehouse/customers" className="font-semibold underline">Customers</Link>.
        </p>
      )}
    </section>
  )
}
