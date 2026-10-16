import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { LocationKind } from "@/lib/goods-in/model"
import { SCANNER_NOT_SET_UP, type BootstrapResponse } from "@/lib/goods-in/scan-contract"
import { failure, gate, isMissingTable } from "../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/goods-in/scan/bootstrap → { user, hub, locations, serverTime, ready, notice? }
//
// What the handheld scanner screen (/scan) needs before the first scan, and caches so it can still
// recognise a location code with no Wi-Fi: who is signed in (their id is stamped on every scan as
// scannedBy), which Hub this is, and every Goods In location with its kind and on/off setting.
// `ready` is false until Run Migrations has made the scanner's table — the sync answers 503 and
// applies nothing until then. Anyone with Warehouse access, checked here (/api is outside the login
// gate). Read-only; nothing here touches Business Central.

const KINDS = new Set<string>(["storage", "bench", "shelf", "other"])

export async function GET() {
  try {
    const g = await gate("warehouse")
    if (g.res) return g.res
    const me = g.me

    const [locs, ready] = await Promise.all([
      prisma.goodsInLocation.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true, kind: true, active: true } }),
      prisma.goodsInScanEvent.findFirst({ select: { id: true } }).then(() => true, (e: unknown) => {
        if (isMissingTable(e)) return false
        throw e
      }),
    ])

    const body: BootstrapResponse = {
      user: { id: me.id, name: me.name, tier: me.whRole },
      hub: process.env.RAILWAY_ENVIRONMENT_NAME || (process.env.NODE_ENV === "production" ? "unknown" : "development"),
      locations: locs.map(l => ({
        code: l.code,
        name: l.name,
        kind: (l.kind && KINDS.has(l.kind) ? l.kind : "storage") as LocationKind,
        active: l.active !== false,
      })),
      serverTime: new Date().toISOString(),
      ready,
      ...(ready ? {} : { notice: SCANNER_NOT_SET_UP }),
    }
    // Private and never kept by the browser's HTTP cache — the screen's service worker keeps its
    // own copy, per device, for offline use.
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } })
  } catch (e) {
    return failure("scan bootstrap", e)
  }
}
