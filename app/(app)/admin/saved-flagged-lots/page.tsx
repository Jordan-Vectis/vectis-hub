import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import SavedFlagsClient, { type SavedBatch, type SavedFlagRow } from "./saved-flags-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Saved Flagged Lots" }

// Admin → Saved Flagged Lots.
//
// ⚠ WHY THIS EXISTS. Re-running the AI overwrites CatalogueLot.aiFlagNote with a bare update
// that does not go through the lot change log, so the previous run's flags vanish without trace.
// Jack, 2026-08-19: "we are about to overwrite them but we cant loose the data." A save here
// freezes them, and this page reads them back laid out the way the Review tab lays them out.
//
// Everything is try/caught: the table only exists after Run Migrations, and an admin page that
// 500s before the button is pressed is worse than one that says it is not set up yet.

async function loadBatches(): Promise<SavedBatch[]> {
  try {
    // ⚠ Grouped in SQL, not by fetching rows and counting them here. An earlier version pulled
    // 2,000 rows and tallied them in memory, which is fine on staging and silently WRONG on
    // production data: one save of a big sale can exceed the cap, and the list would then
    // under-report how many lots it holds — on the one screen whose entire job is telling you
    // your data is safe.
    const grouped = await prisma.savedAiFlag.groupBy({
      by:      ["batchId"],
      _count:  { _all: true },
      _max:    { savedAt: true },
      orderBy: { _max: { savedAt: "desc" } },
      take:    100,
    })
    if (!grouped.length) return []
    const ids = grouped.map(g => g.batchId)

    const [meta, aiCounts, sales] = await Promise.all([
      prisma.savedAiFlag.findMany({
        where:    { batchId: { in: ids } },
        distinct: ["batchId"],
        select:   { batchId: true, label: true, savedByName: true, savedAt: true },
      }),
      prisma.savedAiFlag.groupBy({
        by:     ["batchId"],
        where:  { batchId: { in: ids }, aiFlagNote: { not: null } },
        _count: { _all: true },
      }),
      prisma.savedAiFlag.findMany({
        where:    { batchId: { in: ids } },
        distinct: ["batchId", "auctionCode"],
        select:   { batchId: true, auctionCode: true, auctionName: true },
        take:     2000,
      }),
    ])

    const metaBy  = new Map(meta.map(m => [m.batchId, m]))
    const aiBy    = new Map(aiCounts.map(a => [a.batchId, a._count._all]))
    const salesBy = new Map<string, string[]>()
    for (const row of sales) {
      const label = [row.auctionCode, row.auctionName].filter(Boolean).join(" — ")
      if (!label) continue
      const arr = salesBy.get(row.batchId) ?? []
      if (!arr.includes(label)) arr.push(label)
      salesBy.set(row.batchId, arr)
    }

    return grouped.map(g => {
      const m = metaBy.get(g.batchId)
      return {
        batchId:     g.batchId,
        label:       m?.label ?? "",
        savedAt:     (g._max.savedAt ?? m?.savedAt ?? new Date()).toISOString(),
        savedByName: m?.savedByName ?? "",
        sales:       salesBy.get(g.batchId) ?? [],
        lots:        g._count._all,
        aiFlags:     aiBy.get(g.batchId) ?? 0,
      }
    })
  } catch { return [] }
}

const BATCH_PAGE = 2000

async function loadBatch(batchId: string): Promise<SavedFlagRow[]> {
  try {
    const rows = await prisma.savedAiFlag.findMany({
      where:   { batchId },
      orderBy: [{ auctionCode: "asc" }, { barcode: "asc" }],
      take:    BATCH_PAGE,
    })
    return rows.map(r => ({
      id: r.id, lotId: r.lotId,
      auctionCode: r.auctionCode, auctionName: r.auctionName,
      barcode: r.barcode, receiptUniqueId: r.receiptUniqueId, title: r.title,
      keyPoints: r.keyPoints, description: r.description,
      condition: r.condition, category: r.category, subCategory: r.subCategory, brand: r.brand,
      estimateLow: r.estimateLow, estimateHigh: r.estimateHigh,
      aiEstimateLow: r.aiEstimateLow, aiEstimateHigh: r.aiEstimateHigh,
      imageUrls: r.imageUrls, cataloguedBy: r.cataloguedBy,
      aiFlagNote: r.aiFlagNote, reviewFlag: r.reviewFlag,
      reviewFlaggedBy: r.reviewFlaggedBy,
      reviewFlaggedAt: r.reviewFlaggedAt?.toISOString() ?? null,
      kpFixNote: r.kpFixNote, kpFixedBy: r.kpFixedBy,
      kpFixedAt: r.kpFixedAt?.toISOString() ?? null,
      kpMode: r.kpMode === "relaxed" ? "relaxed" : "strict",
      savedAt: r.savedAt.toISOString(), savedByName: r.savedByName,
    }))
  } catch { return [] }
}

/** The sales a save can be taken from, newest first. */
async function loadAuctions() {
  try {
    const rows = await prisma.catalogueAuction.findMany({
      orderBy: [{ auctionDate: "desc" }, { createdAt: "desc" }],
      take:    200,
      select:  { id: true, code: true, name: true },
    })
    return rows.map(a => ({ id: a.id, label: [a.code, a.name].filter(Boolean).join(" — ") }))
  } catch { return [] }
}

export default async function SavedFlaggedLotsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id }, select: { role: true },
  })
  if (dbUser?.role !== "ADMIN") redirect("/hub")

  const { batch } = await searchParams
  const [batches, auctions, rows] = await Promise.all([
    loadBatches(),
    loadAuctions(),
    batch ? loadBatch(batch) : Promise.resolve([]),
  ])

  return (
    <SavedFlagsClient
      batches={batches}
      auctions={auctions}
      openBatch={batch ?? null}
      rows={rows}
    />
  )
}
