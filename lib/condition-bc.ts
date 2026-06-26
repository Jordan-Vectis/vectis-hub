/**
 * Business Central lookups for a condition report: find the lot, who catalogued
 * it (→ email via the cataloguer directory) and where it currently sits.
 *
 * The lot is matched in the WarehouseItem mirror of BC by auction code + lot
 * number. BC stores the live lot number in `currentLotNo` (`lotNo` is usually 0).
 */

import { prisma } from "@/lib/prisma"
import { lookupCataloguerByCode } from "@/lib/cataloguer-directory"

export type LotCataloguerInfo = {
  found:           boolean
  uniqueId:        string | null
  cataloguerCode:  string | null
  cataloguerName:  string | null
  cataloguerEmail: string | null
  location:        string | null   // e.g. "13D1", or COLLECTED/SHIPPED if gone
  toteNo:          string | null
  binCode:         string | null
  gone:            boolean          // location reads COLLECTED / SHIPPED / DESPATCHED
}

const EMPTY: LotCataloguerInfo = {
  found: false, uniqueId: null, cataloguerCode: null, cataloguerName: null,
  cataloguerEmail: null, location: null, toteNo: null, binCode: null, gone: false,
}

const GONE_LOCATIONS = /^(collected|shipped|despatched|dispatched|sold out)/i

/**
 * Find the BC lot for a condition report and resolve its cataloguer + location.
 * Returns a best-effort result — `found:false` when the lot can't be matched.
 */
export async function lookupLotCataloguer(
  auctionCode: string | null | undefined,
  lotNumber: string | null | undefined,
): Promise<LotCataloguerInfo> {
  const code = auctionCode?.trim()
  const lot  = lotNumber?.trim()
  if (!code || !lot) return EMPTY

  // Match on the live lot number first (currentLotNo), then the raw lotNo.
  const item =
    (await prisma.warehouseItem.findFirst({
      where:  { auctionCode: { equals: code, mode: "insensitive" }, currentLotNo: lot },
      select: { uniqueId: true, cataloguedBy: true, location: true, toteNo: true, binCode: true },
    })) ??
    (await prisma.warehouseItem.findFirst({
      where:  { auctionCode: { equals: code, mode: "insensitive" }, lotNo: lot },
      select: { uniqueId: true, cataloguedBy: true, location: true, toteNo: true, binCode: true },
    }))

  if (!item) return EMPTY

  const cat = lookupCataloguerByCode(item.cataloguedBy)
  const location = item.location?.trim() || null

  return {
    found:           true,
    uniqueId:        item.uniqueId,
    cataloguerCode:  cat?.code  ?? (item.cataloguedBy?.trim() || null),
    cataloguerName:  cat?.name  ?? null,
    cataloguerEmail: cat?.email ?? null,
    location,
    toteNo:          item.toteNo?.trim() || null,
    binCode:         item.binCode?.trim() || null,
    gone:            !!location && GONE_LOCATIONS.test(location),
  }
}
