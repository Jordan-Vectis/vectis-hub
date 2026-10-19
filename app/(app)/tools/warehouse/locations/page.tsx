import { prisma } from "@/lib/prisma"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { Empty, ErrorBox, isMissingTable, NotReady, PageHeader } from "../_components/ui"
import { asKind } from "./chips"
import type { LocationItem } from "./filters"
import LocationsClient from "./locations-client"

export const dynamic = "force-dynamic"

// Goods In → Locations. Every place a tote, pallet or lot can be — storage, cataloguing benches,
// shelves — with how many totes and pallets are there now, how many lots were last put there,
// and when anything last moved in or out. Everyone can filter, export and print labels;
// managers and admins add, change, switch off and remove them (all checked again on the server).

const iso = (d: Date | string | null | undefined) => {
  if (!d) return null
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

/** The moment the list was read — the "not used in 30 days" filters count back from it. */
const readAt = () => Date.now()

export default async function LocationsPage() {
  const me = await getGoodsInUser()
  const shell = (body: React.ReactNode) => (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader title="Locations" back={{ href: "/tools/warehouse", label: "Goods In" }} />
      {body}
    </div>
  )
  if (!me) return shell(<Empty>Your account doesn&apos;t have Warehouse access.</Empty>)

  let rows: LocationItem[]
  let asOf: number
  try {
    const [locs, containers, lots, usage] = await Promise.all([
      prisma.goodsInLocation.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true, kind: true, active: true, createdAt: true } }),
      // Totes and pallets there now. A returned one has gone back to the customer, whatever its last location says.
      prisma.goodsInContainer.groupBy({
        by: ["locationCode"],
        _count: { _all: true },
        where: { locationCode: { not: null }, OR: [{ status: null }, { status: { not: "returned" } }] },
      }),
      // Lots whose latest move was to each location (a lot's shelf is its latest move).
      prisma.$queryRaw<{ code: string; n: number }[]>`
        SELECT "locationCode" AS code, COUNT(*)::int AS n
        FROM (
          SELECT DISTINCT ON ("lotId") "lotId", "locationCode"
          FROM "GoodsInMovement"
          WHERE "lotId" IS NOT NULL
          ORDER BY "lotId", "movedAt" DESC
        ) latest
        GROUP BY "locationCode"`,
      // When each location was last used — the latest move INTO or OUT OF it — and whether it was
      // ever used at all (any move, or any tote or pallet, even a returned one, recorded there).
      // History stores codes as text, so this is matched on the code, not a key.
      prisma.$queryRaw<{ code: string; at: Date | null }[]>`
        SELECT code, MAX(at) AS at
        FROM (
          SELECT "locationCode" AS code, "movedAt" AS at FROM "GoodsInMovement"
          UNION ALL
          SELECT "fromCode" AS code, "movedAt" AS at FROM "GoodsInMovement" WHERE "fromCode" IS NOT NULL
          UNION ALL
          SELECT "locationCode" AS code, NULL::timestamp(3) AS at FROM "GoodsInContainer" WHERE "locationCode" IS NOT NULL
        ) used
        GROUP BY code`,
    ])
    const toteCount = new Map(containers.map(c => [c.locationCode, c._count._all]))
    const lotCount = new Map(lots.map(l => [l.code, Number(l.n)]))
    const lastUsed = new Map(usage.map(u => [u.code, iso(u.at)]))
    rows = locs.map(l => ({
      code: l.code,
      name: l.name,
      kind: asKind(l.kind),
      active: l.active !== false,
      totes: toteCount.get(l.code) ?? 0,
      lots: lotCount.get(l.code) ?? 0,
      createdAt: iso(l.createdAt) ?? new Date(0).toISOString(),
      lastUsedAt: lastUsed.get(l.code) ?? null,
      everUsed: lastUsed.has(l.code),
    }))
    asOf = readAt()
  } catch (e) {
    if (isMissingTable(e)) return shell(<NotReady />)
    console.error("goods-in locations page:", e)
    return shell(<ErrorBox>The locations couldn&apos;t be loaded: {String((e as Error)?.message ?? e).slice(0, 200)}</ErrorBox>)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <LocationsClient rows={rows} canEdit={atLeast(me, "manager")} asOf={asOf} />
    </div>
  )
}
