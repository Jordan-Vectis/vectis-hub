import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { lookupCode } from "@/lib/actions/goods-in"
import { goodsAtLocations } from "@/lib/actions/goods-in-locations"
import { normaliseCode, type ContainerKind, type LocationKind } from "@/lib/goods-in/model"
import type { LookupResponse, ScanHere, ScanHitJson, ScanWhere } from "@/lib/goods-in/scan-contract"
import { errorJson, failure, gate } from "../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/goods-in/scan/lookup?code=X → { code, hit, where, here?, hereTruncated?, containers?, serverTime }
//
// The handheld scanner's Find and Check a location — ONLINE ONLY (the screen says so offline).
// What a code is comes from lookupCode (lib/actions/goods-in.ts) itself, so it answers exactly as
// Goods In → Code lookup does: a tote/pallet first, then a lot barcode (the newest lot with it), a
// receipt, a location, a vendor number. Then where it is now:
//   • a tote, pallet or lot → `where`: its location (name, kind, on/off) and when and by whom it was
//     put there (its latest move);
//   • a location → `here`: everything the Hub records there now (goodsAtLocations — the same rows
//     as the location's "Export what's there"), for "expected but not scanned";
//   • a receipt → `containers`: its totes and pallets and where each is.
// Anyone with Warehouse access, checked here (/api is outside the login gate). Read-only; nothing
// here touches Business Central.

const MAX_CODE = 100
/** A handheld lists at most this many things at one location. */
const MAX_HERE = 500

const KINDS = new Set<string>(["storage", "bench", "shelf", "other"])
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export async function GET(req: NextRequest) {
  try {
    const g = await gate("warehouse")
    if (g.res) return g.res

    // Control characters a scanner can put round a code (CR, tab, GS1 separators) are never part of one.
    const code = normaliseCode((req.nextUrl.searchParams.get("code") ?? "").replace(/[\u0000-\u001F\u007F]/g, ""))
    if (!code) return errorJson("Scan or type a code to look up.", 400)
    if (code.length > MAX_CODE) return errorJson("That code is too long to be a Hub label — scan it again.", 400)

    const found = await lookupCode(code)
    if (!found.ok) return errorJson(found.error, /Run Migrations/i.test(found.error) ? 503 : 500)
    const hit = found.data
    const out: LookupResponse = { code, hit: null, where: null, serverTime: "" }

    if (hit) {
      out.hit = (hit.type === "receipt" ? { ...hit, createdAt: hit.createdAt.toISOString() } : hit) as ScanHitJson

      if ((hit.type === "container" || hit.type === "lot") && hit.locationCode) {
        const [loc, last] = await Promise.all([
          prisma.goodsInLocation.findUnique({ where: { code: hit.locationCode }, select: { code: true, name: true, kind: true, active: true } }),
          prisma.goodsInMovement.findFirst({
            where: hit.type === "container" ? { containerId: hit.id } : { lotId: hit.lotId },
            orderBy: { movedAt: "desc" },
            select: { movedAt: true, movedByName: true, locationCode: true },
          }),
        ])
        const sameMove = last && last.locationCode === hit.locationCode
        const where: ScanWhere = {
          code: hit.locationCode,
          name: loc?.name ?? null,
          kind: loc ? ((loc.kind && KINDS.has(loc.kind) ? loc.kind : "storage") as LocationKind) : null,
          active: loc ? loc.active !== false : false,
          since: sameMove ? iso(last.movedAt) : null,
          by: sameMove ? last.movedByName : null,
        }
        out.where = where
      }

      if (hit.type === "location") {
        const res = await goodsAtLocations([hit.code])
        if (!res.ok) return errorJson(res.error, /Run Migrations/i.test(res.error) ? 503 : 500)
        const rows: ScanHere[] = res.data.rows.map(r => ({
          type: r.type, code: r.code, status: r.status, receipt: r.receipt, customer: r.customer,
          what: r.what, sale: r.sale, since: r.since, by: r.by,
        }))
        out.here = rows.slice(0, MAX_HERE)
        out.hereTruncated = res.data.truncated || rows.length > MAX_HERE
      }

      if (hit.type === "receipt") {
        const rows = await prisma.goodsInContainer.findMany({
          where: { receiptId: hit.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, kind: true, status: true, locationCode: true },
          take: MAX_HERE,
        })
        out.containers = rows.map(c => ({ id: c.id, kind: (c.kind === "pallet" ? "pallet" : "tote") as ContainerKind, status: c.status, locationCode: c.locationCode }))
      }
    }

    out.serverTime = new Date().toISOString()
    return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } })
  } catch (e) {
    return failure("scan lookup", e)
  }
}
