import { prisma } from "@/lib/prisma"

// Cataloguing timing logs only store a loose `lotId` (not a FK). To show the real
// barcode in the reports — and to flag logs whose lot was deleted or transferred
// to another auction (the phantom-count cause) — we resolve each log's lotId to
// its current lot here.

export type LotRef = {
  barcode: string | null      // the lot's barcode (or receipt unique id) to display
  movedToCode: string | null  // set when the lot now lives in a DIFFERENT auction than the log
  lotDeleted: boolean         // true when the lot no longer exists at all
}

type LotInfo = { barcode: string | null; receiptUniqueId: string | null; auctionId: string; code: string }

export async function buildLotMap(logs: { lotId: string | null }[]): Promise<Map<string, LotInfo>> {
  const ids = [...new Set(logs.map(l => l.lotId).filter((x): x is string => !!x))]
  if (ids.length === 0) return new Map()
  const lots = await prisma.catalogueLot.findMany({
    where:  { id: { in: ids } },
    select: { id: true, barcode: true, receiptUniqueId: true, auctionId: true, auction: { select: { code: true } } },
  })
  return new Map(lots.map(l => [l.id, { barcode: l.barcode, receiptUniqueId: l.receiptUniqueId, auctionId: l.auctionId, code: l.auction.code }]))
}

export function lotRef(map: Map<string, LotInfo>, log: { lotId: string | null; auctionId: string }): LotRef {
  if (!log.lotId) return { barcode: null, movedToCode: null, lotDeleted: false }
  const lot = map.get(log.lotId)
  if (!lot) return { barcode: null, movedToCode: null, lotDeleted: true }
  return {
    barcode:     lot.barcode || lot.receiptUniqueId || null,
    movedToCode: lot.auctionId !== log.auctionId ? lot.code : null,
    lotDeleted:  false,
  }
}
