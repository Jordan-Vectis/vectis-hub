import { prisma } from "@/lib/prisma"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { LOCATION_KINDS, type LocationKind } from "@/lib/goods-in/model"
import { Empty, ErrorBox, isMissingTable, NotReady, PageHeader } from "../_components/ui"
import LocationsClient, { type LocationItem } from "./locations-client"

export const dynamic = "force-dynamic"

// Goods In → Locations. Every place a tote, pallet or lot can be — storage, cataloguing benches,
// shelves — with how many totes and pallets are there now and how many lots were last put there.
// Managers and admins add and edit them and can import the warehouse's own location list;
// everyone can print location labels.

const KINDS = new Set(LOCATION_KINDS.map(k => k.value))

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
  try {
    const [locs, containers, lots] = await Promise.all([
      prisma.goodsInLocation.findMany({ orderBy: { code: "asc" } }),
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
    ])
    const toteCount = new Map(containers.map(c => [c.locationCode, c._count._all]))
    const lotCount = new Map(lots.map(l => [l.code, Number(l.n)]))
    rows = locs.map(l => ({
      code: l.code,
      name: l.name,
      kind: (l.kind && KINDS.has(l.kind as LocationKind) ? l.kind : "storage") as LocationKind,
      active: l.active !== false,
      totes: toteCount.get(l.code) ?? 0,
      lots: lotCount.get(l.code) ?? 0,
    }))
  } catch (e) {
    if (isMissingTable(e)) return shell(<NotReady />)
    console.error("goods-in locations page:", e)
    return shell(<ErrorBox>The locations couldn&apos;t be loaded: {String((e as Error)?.message ?? e).slice(0, 200)}</ErrorBox>)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <LocationsClient rows={rows} canEdit={atLeast(me, "manager")} />
    </div>
  )
}
