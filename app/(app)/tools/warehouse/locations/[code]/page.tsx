import Link from "next/link"
import type { ReactNode } from "react"
import type { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { canSeeAuction, getDepartmentAccess } from "@/lib/departments"
import { normaliseCode } from "@/lib/goods-in/model"
import { LOCATION_AREAS, defaultLocationName, parseLocationCode } from "@/lib/goods-in/location-codes"
import { box, btn, mono, th, td, Empty, ErrorBox, KindBadge, NotReady, PageHeader, StatusBadge, StatusKey, isMissingTable, ukDate, ukDateTime } from "../../_components/ui"
import { MOVE_SELECT, MoveKindChip, findHref, moveItem, moveKind, type MoveRow } from "../../history/move-parts"
import { plural } from "../../move/words"
import { KIND, KindChip, OffChip, asKind } from "../chips"
import type { Expected } from "./check-here"
import LocationActions from "./location-actions"
import { StrandedGoods } from "./move-everything"

// Goods In → Locations → one location. Everything about a single place in the warehouse: what its
// code means, when it was added and last used, what is there right now (totes and pallets, and the
// lots whose latest move was to it), and the latest moves in and out. Everyone can print its label
// and move everything at it somewhere else; managers also rename it, change its kind, switch it off
// or on, and remove it (location-actions.tsx — every write is a server action that returns
// { ok, error }).
//
// ⚠ A sale is linked only for someone whose departments let them open it (lib/departments.ts —
// RULES "Departments gate which sales a cataloguer sees"); anyone else sees the sale code as text.
// ⚠ History stores location codes as text with no link to GoodsInLocation, so a code that is no
// longer a location can still have goods and moves recorded against it — the "no such location"
// panel says so and points at Find. Nothing here touches Business Central.

export const dynamic = "force-dynamic"

type Params = { code: string }

const LIST = "/tools/warehouse/locations"
const MAX_CONTAINERS = 500
const MAX_LOTS = 1000
const RECENT_MOVES = 50

/** The code from the address: decoded (a / in a code arrives as %2F) and normalised the way codes are stored. */
const cleanCode = (raw: string) => {
  let s = raw
  try { s = decodeURIComponent(raw) } catch { /* already decoded */ }
  return normaliseCode(s).slice(0, 40)
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { code } = await params
  return { title: `Location ${cleanCode(code)} · Goods In` }
}

const LOT_STATUS: Record<string, string> = { ENTERED: "Entered", REVIEWED: "Reviewed", PUBLISHED: "Published", SOLD: "Sold", UNSOLD: "Unsold", WITHDRAWN: "Withdrawn" }
const lotStatus = (s: string | null | undefined) => (s ? LOT_STATUS[s] ?? s : "—")
const n = (x: number) => x.toLocaleString("en-GB")

/** "Aisle 10 · Bay A · Shelf 1" — what a code says about where it is. */
function codeMeaning(code: string): { text: string; area: string } {
  const p = parseLocationCode(code)
  const area = LOCATION_AREAS.find(a => a.value === p.area)?.label ?? "Named areas"
  switch (p.area) {
    case "aisle": return { area, text: [`Aisle ${p.aisle}`, `Bay ${p.bay}`, p.shelf ? `Shelf ${p.shelf}` : null].filter(Boolean).join(" · ") }
    case "bench": return { area, text: `Bench ${p.bench}` }
    case "cabinet": return { area, text: [`Cabinet ${p.cabinet}`, p.shelf ? `Shelf ${p.shelf}` : null].filter(Boolean).join(" · ") }
    default: return { area, text: "A named area — not an aisle, bench or cabinet code" }
  }
}

// ─── Reading ──────────────────────────────────────────────────────────────────────────────

type HereLot = {
  lotId: string; moveBarcode: string | null; movedAt: Date; movedByName: string | null
  barcode: string | null; title: string | null; status: string | null
  auctionId: string | null; auctionCode: string | null; auctionType: string | null; total: number
}
type LotInfo = { title: string; auction: string | null }

async function load(code: string) {
  // Goods here NOW: a tote or pallet whose location is this code and which hasn't gone back to the
  // customer (a null status counts as here — the same rule as the Locations list and Remove).
  const live: Prisma.GoodsInContainerWhereInput = { locationCode: code, OR: [{ status: null }, { status: { not: "returned" } }] }
  // A move INTO or OUT OF this exact code.
  const touches: Prisma.GoodsInMovementWhereInput = { OR: [{ locationCode: code }, { fromCode: code }] }
  const [place, containers, containerCount, returnedCount, lots, moves, moveCount] = await Promise.all([
    prisma.goodsInLocation.findUnique({ where: { code }, select: { code: true, name: true, kind: true, active: true, createdAt: true } }),
    prisma.goodsInContainer.findMany({
      where: live,
      select: { id: true, kind: true, category: true, description: true, status: true, movedAt: true, receiptId: true, receipt: { select: { contactId: true, contact: { select: { name: true } } } } },
      orderBy: [{ movedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: MAX_CONTAINERS,
    }),
    prisma.goodsInContainer.count({ where: live }),
    prisma.goodsInContainer.count({ where: { locationCode: code, status: "returned" } }),
    // Lots whose LATEST move is to this location — a lot moved on since is somewhere else now.
    prisma.$queryRaw<HereLot[]>`
      SELECT cur."lotId", cur."barcode" AS "moveBarcode", cur."movedAt", cur."movedByName",
             l."barcode", l."title", l."status", l."auctionId", a."code" AS "auctionCode", a."auctionType",
             count(*) OVER ()::int AS "total"
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
      LIMIT ${MAX_LOTS}`,
    prisma.goodsInMovement.findMany({ where: touches, orderBy: [{ movedAt: "desc" }, { id: "desc" }], take: RECENT_MOVES, select: MOVE_SELECT }),
    prisma.goodsInMovement.count({ where: touches }),
  ])
  return { place, containers, containerCount, returnedCount, lots, lotCount: Number(lots[0]?.total ?? 0), moves, moveCount }
}

type Loaded = Awaited<ReturnType<typeof load>>

/** The lots' titles for the moves list, so a barcode on its own isn't a mystery. Nice to have — never fails the page. */
async function lotTitles(moves: MoveRow[]): Promise<Map<string, LotInfo>> {
  const out = new Map<string, LotInfo>()
  const ids = [...new Set(moves.map(m => m.lotId).filter((x): x is string => !!x))]
  if (!ids.length) return out
  try {
    const found = await prisma.catalogueLot.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, auction: { select: { code: true } } } })
    for (const l of found) out.set(l.id, { title: l.title, auction: l.auction?.code ?? null })
  } catch (e) {
    console.error("goods-in location page lot titles:", e)
  }
  return out
}

/** May this person open that sale? (Their departments — lib/departments.ts.) */
type CanOpen = (auctionId: string | null | undefined, auctionType: string | null | undefined) => boolean

// ─── The page ─────────────────────────────────────────────────────────────────────────────

export default async function LocationPage({ params }: { params: Promise<Params> }) {
  const { code: raw } = await params
  const code = cleanCode(raw)
  const me = await getGoodsInUser()

  const shell = (body: ReactNode, title = code ? `Location ${code}` : "Location") => (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader title={title} back={{ href: LIST, label: "Locations" }} />
      {body}
    </div>
  )

  if (!me) return shell(<Empty>Your account doesn&apos;t have Warehouse access.</Empty>)

  let d: Loaded | null = null
  let canOpen: CanOpen = () => false
  try {
    if (code) {
      const [access, loaded] = await Promise.all([getDepartmentAccess(me.id, me.role), load(code)])
      canOpen = (auctionId, auctionType) => !!auctionId && canSeeAuction(access, { id: auctionId, auctionType: auctionType ?? null })
      d = loaded
    }
  } catch (e) {
    if (isMissingTable(e)) return shell(<NotReady />)
    console.error("goods-in location page:", e)
    return shell(<ErrorBox>This location couldn&apos;t be loaded just now — refresh the page to try again. ({String((e as Error)?.message ?? e).slice(0, 160)})</ErrorBox>)
  }

  if (!d || !d.place) return shell(<NoSuchLocation code={code} d={d} />, "Location")

  const { place, containers, containerCount, returnedCount, lots, lotCount, moves, moveCount } = d
  const kind = asKind(place.kind)
  const active = place.active !== false
  const meaning = codeMeaning(code)
  const lastUsed = moves[0]?.movedAt ?? null
  const everUsed = moveCount > 0 || containerCount > 0 || returnedCount > 0
  const titles = await lotTitles(moves)
  // What the Hub records here, for "Check what's here" — a lot with no barcode can't be scanned.
  const expected: Expected[] = [
    ...containers.map(c => ({ code: c.id, kind: (c.kind === "pallet" ? "pallet" : "tote") as Expected["kind"], label: [c.category, c.description].filter(Boolean).join(" — ") || c.receipt.contact.name })),
    ...lots.flatMap(l => {
      const bc = l.barcode ?? l.moveBarcode
      return bc ? [{ code: bc, kind: "lot" as const, label: l.title }] : []
    }),
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ── The location ── */}
      <div>
        <Link href={LIST} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-1 inline-flex items-center gap-1 min-h-11">← Locations</Link>
        <section className={`${box} p-4 sm:p-5 space-y-4`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className={`${mono} text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white break-all`}>{code}</h1>
            <KindChip kind={kind} />
            {!active && <OffChip />}
          </div>
          <p className="text-base text-gray-700 dark:text-gray-200 break-words">
            {place.name ?? <span className="text-gray-500 dark:text-gray-400">No name</span>}
          </p>
          <Facts
            items={[
              ["What the code means", <span key="m">{meaning.text}<span className="block text-xs text-gray-500 dark:text-gray-400">{meaning.area}</span></span>],
              ["Kind", <span key="k">{KIND[kind].label}<span className="block text-xs text-gray-500 dark:text-gray-400">{KIND[kind].help}</span></span>],
              ["In use", active ? "Yes — things can be moved here" : <span key="a" className="text-amber-700 dark:text-amber-300">Switched off — kept for its history; nothing new can be moved here</span>],
              ["Here now", `${plural(containerCount, "tote or pallet", "totes and pallets")} · ${plural(lotCount, "lot")}`],
              ["Last used", lastUsed ? ukDateTime(lastUsed) : "Never — nothing has been moved in or out"],
              ["Moves in and out", <span key="mv">{plural(moveCount, "move")}{returnedCount > 0 && <span className="block text-xs text-gray-500 dark:text-gray-400">{plural(returnedCount, "returned tote or pallet", "returned totes and pallets")} last recorded here</span>}</span>],
              ["Added", ukDate(place.createdAt)],
            ]}
          />
          <LocationActions
            code={code}
            name={place.name}
            kind={kind}
            active={active}
            totes={containerCount}
            lots={lotCount}
            everUsed={everUsed}
            moveCount={moveCount}
            canEdit={atLeast(me, "manager")}
            defaultName={defaultLocationName(code)}
            expected={expected}
          />
        </section>
      </div>

      {/* ── What's here now ── */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">What&apos;s here now</h2>
        {containerCount === 0 && lotCount === 0 ? (
          <Empty>Nothing is at <span className={`${mono} font-semibold`}>{code}</span> right now.</Empty>
        ) : (
          <div className="grid gap-4 2xl:grid-cols-2 items-start">
            <Section title="Totes and pallets" count={containerCount}>
              {containers.length === 0 ? <Quiet>No totes or pallets.</Quiet> : <Containers rows={containers} />}
              {containerCount > containers.length && <Quiet>Showing the newest {n(containers.length)} of {n(containerCount)}.</Quiet>}
            </Section>
            <Section id="lots" title="Lots" count={lotCount}>
              {lots.length === 0 ? <Quiet>No lots — none has this as its latest move.</Quiet> : <Lots rows={lots} canOpen={canOpen} />}
              {lotCount > lots.length && <Quiet>Showing the newest {n(lots.length)} of {n(lotCount)}.</Quiet>}
            </Section>
          </div>
        )}
        {containerCount > 0 && <StatusKey />}
      </div>

      {/* ── Recent moves ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent moves in and out</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {moveCount > moves.length ? `The latest ${n(moves.length)} of ${n(moveCount)}, newest first.` : "Newest first."} <b>In</b> — moved here. <b>Out</b> — moved away from here.
            </p>
          </div>
          {moveCount > 0 && (
            <Link href={`/tools/warehouse/history?location=${encodeURIComponent(code)}`} className={btn}>
              See them all in History
            </Link>
          )}
        </div>
        {moves.length === 0 ? (
          <Empty>Nothing has been moved in or out of <span className={`${mono} font-semibold`}>{code}</span> yet.</Empty>
        ) : (
          <>
            <MoveCards rows={moves} code={code} titles={titles} />
            <MoveTable rows={moves} code={code} titles={titles} />
            {moveCount > moves.length && (
              <p className="text-xs text-gray-500 dark:text-gray-400">History also lists moves for any location whose code starts with {code}.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Bits ─────────────────────────────────────────────────────────────────────────────────

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400">{k}</dt>
          <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ id, title, count, children }: { id?: string; title: string; count: number; children: ReactNode }) {
  return (
    <section id={id} className={`${box} overflow-hidden min-w-0 scroll-mt-4`}>
      <h3 className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 font-semibold text-gray-900 dark:text-white">
        {title} <span className="font-normal text-gray-500 dark:text-gray-400">({n(count)})</span>
      </h3>
      {children}
    </section>
  )
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">{children}</p>

// Every link is a 44px tap target (RULES design rule 5): in a card it is that tall itself; in a
// table cell it gets the height from padding pulled back with a negative margin, so rows stay neat.
const tapCard = "inline-flex items-center min-h-11"
const tapCell = "inline-block py-3 -my-3"

/** A lot's sale code: a link to the sale for someone allowed to open it, plain text for anyone else. */
function SaleCode({ auctionId, code, open, tap }: { auctionId: string | null; code: string; open: boolean; tap: string }) {
  return open && auctionId
    ? <Link href={`/tools/cataloguing/auctions/${encodeURIComponent(auctionId)}`} className={`${mono} ${tap} text-xs text-indigo-700 dark:text-indigo-300 hover:underline`}>{code}</Link>
    : <span className={`${mono} text-xs text-gray-600 dark:text-gray-300`}>{code}</span>
}

const codeLink = `${mono} font-bold text-indigo-700 dark:text-indigo-300 hover:underline`

/** A location code on this page opens that location's own page (History's version opens Find). */
function PlaceLink({ code, tap }: { code: string; tap: string }) {
  return (
    <Link href={`${LIST}/${encodeURIComponent(code)}`} className={`${mono} ${tap} font-semibold text-gray-900 dark:text-white underline decoration-gray-300 dark:decoration-gray-600 underline-offset-2 hover:decoration-indigo-500`}>
      {code}
    </Link>
  )
}

/** "A1B2 → BENCH3". A tote's first move has no "from" — it was on its receipt, not anywhere yet. */
function FromTo({ m, tap }: { m: MoveRow; tap: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {m.fromCode ? <PlaceLink code={m.fromCode} tap={tap} /> : <span className="text-gray-500 dark:text-gray-400 italic">{m.containerId ? "Booked in" : "First move"}</span>}
      <span aria-hidden className="text-gray-500 dark:text-gray-400">→</span>
      <span className="sr-only">to</span>
      <PlaceLink code={m.locationCode} tap={tap} />
    </span>
  )
}

// ─── Totes and pallets here ──────────────────────────────────────────────────────────────

type ContainerRow = Loaded["containers"][number]

function Containers({ rows }: { rows: ContainerRow[] }) {
  return (
    <>
      {/* Phones: cards */}
      <ul className="md:hidden divide-y divide-gray-200 dark:divide-gray-800">
        {rows.map(c => (
          <li key={c.id} className="px-4 py-2 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={findHref(c.id)} className={`${codeLink} ${tapCard}`}>{c.id}</Link>
              <KindBadge kind={c.kind} />
              <StatusBadge status={c.status} />
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-200 break-words">
              <Link href={`/tools/warehouse/customers/${encodeURIComponent(c.receipt.contactId)}`} className={`${tapCard} hover:underline`}>{c.receipt.contact.name}</Link>
              <span className="text-gray-400"> · </span>
              <Link href={`/tools/warehouse/receipts/${encodeURIComponent(c.receiptId)}`} className={`${mono} ${tapCard} hover:underline`}>{c.receiptId}</Link>
            </p>
            {(c.category || c.description) && <p className="text-sm text-gray-600 dark:text-gray-300 break-words">{[c.category, c.description].filter(Boolean).join(" — ")}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400">Here since {ukDateTime(c.movedAt)}</p>
          </li>
        ))}
      </ul>
      {/* Tablets and desktops: a table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              <th className={th}>Tote or pallet</th>
              <th className={th}>Status</th>
              <th className={th}>Customer</th>
              <th className={th}>Receipt</th>
              <th className={th}>What</th>
              <th className={th}>Here since</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map(c => (
              <tr key={c.id}>
                <td className={`${td} whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-2"><Link href={findHref(c.id)} className={`${codeLink} ${tapCell}`}>{c.id}</Link><KindBadge kind={c.kind} /></span>
                </td>
                <td className={td}><StatusBadge status={c.status} /></td>
                <td className={td}><Link href={`/tools/warehouse/customers/${encodeURIComponent(c.receipt.contactId)}`} className={`${tapCell} hover:underline`}>{c.receipt.contact.name}</Link></td>
                <td className={td}><Link href={`/tools/warehouse/receipts/${encodeURIComponent(c.receiptId)}`} className={`${mono} ${tapCell} hover:underline`}>{c.receiptId}</Link></td>
                <td className={`${td} min-w-40 max-w-sm break-words text-gray-600 dark:text-gray-300`}>{[c.category, c.description].filter(Boolean).join(" — ") || "—"}</td>
                <td className={`${td} whitespace-nowrap text-gray-600 dark:text-gray-300`}>{ukDateTime(c.movedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── Lots here ───────────────────────────────────────────────────────────────────────────

function Lots({ rows, canOpen }: { rows: HereLot[]; canOpen: CanOpen }) {
  return (
    <>
      <ul className="md:hidden divide-y divide-gray-200 dark:divide-gray-800">
        {rows.map(l => {
          const bc = l.barcode ?? l.moveBarcode
          return (
            <li key={l.lotId} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {bc ? <Link href={findHref(bc)} className={`${codeLink} ${tapCard}`}>{bc}</Link> : <span className="text-xs text-gray-500 dark:text-gray-400">No barcode</span>}
              <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200 break-words">{l.title ?? "This lot is no longer in the Hub"}</span>
              {l.auctionCode && <SaleCode auctionId={l.auctionId} code={l.auctionCode} open={canOpen(l.auctionId, l.auctionType)} tap={tapCard} />}
              <span className="basis-full text-xs text-gray-500 dark:text-gray-400">
                {lotStatus(l.status)} · here since {ukDateTime(l.movedAt)}{l.movedByName ? ` · ${l.movedByName}` : ""}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              <th className={th}>Barcode</th>
              <th className={th}>Lot</th>
              <th className={th}>Sale</th>
              <th className={th}>Status</th>
              <th className={th}>Here since</th>
              <th className={th}>Put here by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map(l => {
              const bc = l.barcode ?? l.moveBarcode
              return (
                <tr key={l.lotId}>
                  <td className={`${td} whitespace-nowrap`}>{bc ? <Link href={findHref(bc)} className={`${codeLink} ${tapCell}`}>{bc}</Link> : <span className="text-gray-500 dark:text-gray-400">No barcode</span>}</td>
                  <td className={`${td} min-w-48 max-w-md break-words`}>{l.title ?? <span className="text-gray-500 dark:text-gray-400">This lot is no longer in the Hub</span>}</td>
                  <td className={`${td} whitespace-nowrap`}>{l.auctionCode ? <SaleCode auctionId={l.auctionId} code={l.auctionCode} open={canOpen(l.auctionId, l.auctionType)} tap={tapCell} /> : "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>{lotStatus(l.status)}</td>
                  <td className={`${td} whitespace-nowrap text-gray-600 dark:text-gray-300`}>{ukDateTime(l.movedAt)}</td>
                  <td className={td}>{l.movedByName ?? "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── Moves in and out ────────────────────────────────────────────────────────────────────

/** In (moved here) or Out (moved away) — the word is the key, so no colour needs explaining. */
function Direction({ m, code }: { m: MoveRow; code: string }) {
  const into = m.locationCode === code
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${into ? "border-emerald-300 text-emerald-800 dark:border-emerald-700 dark:text-emerald-200" : "border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200"}`}>
      {into ? "In" : "Out"}
    </span>
  )
}

function ItemCell({ m, titles, tap }: { m: MoveRow; titles: Map<string, LotInfo>; tap: string }) {
  const item = moveItem(m)
  const lot = m.lotId ? titles.get(m.lotId) : undefined
  return (
    <div className="min-w-0">
      <Link href={findHref(item)} className={`${codeLink} ${tap}`}>{item}</Link>
      {lot && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1 max-w-xs break-words" title={lot.title}>
          {lot.auction && <span className={`${mono} mr-1.5`}>{lot.auction}</span>}{lot.title}
        </p>
      )}
    </div>
  )
}

function MoveCards({ rows, code, titles }: { rows: MoveRow[]; code: string; titles: Map<string, LotInfo> }) {
  return (
    <ul className="md:hidden space-y-2">
      {rows.map(m => (
        <li key={m.id} className={`${box} p-3`}>
          <div className="flex items-center gap-2">
            <Direction m={m} code={code} />
            <div className="min-w-0 flex-1"><ItemCell m={m} titles={titles} tap={tapCard} /></div>
            <MoveKindChip kind={moveKind(m)} />
          </div>
          <div className="text-sm"><FromTo m={m} tap={tapCard} /></div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{ukDateTime(m.movedAt)}{m.movedByName ? ` · ${m.movedByName}` : ""}</p>
          {m.note && <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words border-t border-gray-100 dark:border-gray-800 pt-2">{m.note}</p>}
        </li>
      ))}
    </ul>
  )
}

function MoveTable({ rows, code, titles }: { rows: MoveRow[]; code: string; titles: Map<string, LotInfo> }) {
  return (
    <div className={`${box} hidden md:block overflow-x-auto`}>
      <table className="w-full">
        <thead className="border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th className={th}><span className="sr-only">In or out</span></th>
            <th className={th}>When</th>
            <th className={th}>Item</th>
            <th className={th}>Kind</th>
            <th className={th}>From → To</th>
            <th className={th}>Who</th>
            <th className={th}>Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(m => (
            <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className={td}><Direction m={m} code={code} /></td>
              <td className={`${td} whitespace-nowrap text-gray-600 dark:text-gray-300`}>{ukDateTime(m.movedAt)}</td>
              <td className={td}><ItemCell m={m} titles={titles} tap={tapCell} /></td>
              <td className={td}><MoveKindChip kind={moveKind(m)} /></td>
              <td className={`${td} whitespace-nowrap`}><FromTo m={m} tap={tapCell} /></td>
              <td className={td}>{m.movedByName || "—"}</td>
              <td className={`${td} min-w-48 max-w-md whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300`}>{m.note || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── No such location ────────────────────────────────────────────────────────────────────

function NoSuchLocation({ code, d }: { code: string; d: Loaded | null }) {
  // History keeps codes as text, so a removed (or never-added) code can still have records against it.
  const records = [
    d?.containerCount ? `${plural(d.containerCount, "tote or pallet", "totes and pallets")} recorded there` : null,
    d?.lotCount ? `${plural(d.lotCount, "lot")} whose latest move was there` : null,
    d?.moveCount ? `${plural(d.moveCount, "move")} in or out` : null,
  ].filter((x): x is string => !!x)
  return (
    <section role="status" className="rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-5 space-y-3 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
      <p className="text-xl font-bold text-gray-900 dark:text-white">
        {code ? <>There&apos;s no location <span className={`${mono} break-all`}>{code}</span></> : "That isn't a location code"}
      </p>
      <p>It isn&apos;t one of the Goods In locations. It may have been removed, or the code may be mistyped.</p>
      {code && records.length > 0 && (
        <p>Goods In still has records for it — {records.join(", ")}. Find shows them{d && (d.containerCount > 0 || d.lotCount > 0) ? ", and they can all be moved to a real location in one go" : ""}.</p>
      )}
      {/* Rendered even when nothing is left, so the result of a move survives the refresh after it. */}
      {code && <StrandedGoods code={code} totes={d?.containerCount ?? 0} lots={d?.lotCount ?? 0} />}
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href={code ? `${LIST}?q=${encodeURIComponent(code)}` : LIST} className={btn}>Look in Locations</Link>
        {code && <Link href={findHref(code)} className={btn}>Find {code}</Link>}
      </div>
    </section>
  )
}
