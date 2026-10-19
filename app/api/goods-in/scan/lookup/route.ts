import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { findCode, goodsHere } from "@/lib/goods-in/lookup-core"
import { normaliseCode, type ContainerKind, type LocationKind } from "@/lib/goods-in/model"
import type { LookupResponse, ScanHere, ScanHitJson, ScanWhere } from "@/lib/goods-in/scan-contract"
import { errorJson, failure } from "../../_lib/shared"
import { scanGate } from "../_lib/scan-gate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/goods-in/scan/lookup?code=X → { code, hit, where, here?, hereTruncated?, containers?, serverTime }
//
// The handheld scanner's Find and Check a location — ONLINE ONLY (the screen says so offline).
// What a code is comes from findCode (lib/goods-in/lookup-core.ts) — Code lookup's own read, so it
// answers exactly as Goods In → Code lookup does: a tote/pallet first, then a lot barcode (the
// newest lot with it), a receipt, a location, a vendor number. Then where it is now:
//   • a tote, pallet or lot → `where`: its location (name, kind, on/off) and when and by whom it was
//     put there (its latest move);
//   • a location → `here`: everything the Hub records there now (goodsHere — the same rows as the
//     location's "Export what's there"), for "expected but not scanned";
//   • a receipt → `containers`: its totes and pallets and where each is.
// Anyone with Warehouse access, checked here (/api is outside the login gate) — the Hub session, or a
// scanner sign-in card (scanGate; that's why it reads lookup-core rather than calling the server
// actions, which take the Hub session alone). Read-only; nothing here touches Business Central.
//
// ⚠ A CARD session is the scanner's, not the Hub's — a lost or photographed card must not become a
// way to look customers up. So for a card: a vendor number answers only that it IS one (no name, no
// contact id) and a receipt has no customer name — the screen only needs the type to say "scan the
// tote instead" — and one card may look up at most CARD_LOOKUPS codes in CARD_WINDOW_MS (far more
// than anyone scanning by hand; it stops a script walking every tote, receipt or vendor number).
// A Hub login answers exactly as before.

const MAX_CODE = 100
/** A handheld lists at most this many things at one location. */
const MAX_HERE = 500

const CARD_LOOKUPS = 600
const CARD_WINDOW_MS = 10 * 60 * 1000
/** In memory, per server, by card (pass id); a restart forgets it. */
const cardLookups = new Map<string, { n: number; since: number }>()

/** Counts one lookup by this card; false when it has used up its allowance for now. */
function cardMayLookUp(passId: string, now: number): boolean {
  if (cardLookups.size > 5000) {
    for (const [k, v] of cardLookups) if (now - v.since > CARD_WINDOW_MS) cardLookups.delete(k)
    if (cardLookups.size > 5000) cardLookups.clear()
  }
  const c = cardLookups.get(passId)
  if (!c || now - c.since > CARD_WINDOW_MS) {
    cardLookups.set(passId, { n: 1, since: now })
    return true
  }
  c.n++
  return c.n <= CARD_LOOKUPS
}

const KINDS = new Set<string>(["storage", "bench", "shelf", "other"])
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export async function GET(req: NextRequest) {
  try {
    const g = await scanGate()
    if (g.res) return g.res
    const byCard = g.me.via === "card"

    // Control characters a scanner can put round a code (CR, tab, GS1 separators) are never part of one.
    const code = normaliseCode((req.nextUrl.searchParams.get("code") ?? "").replace(/[\u0000-\u001F\u007F]/g, ""))
    if (!code) return errorJson("Scan or type a code to look up.", 400)
    if (code.length > MAX_CODE) return errorJson("That code is too long to be a Hub label — scan it again.", 400)
    if (byCard && !cardMayLookUp(g.me.passId ?? g.me.id, Date.now())) {
      return errorJson("This sign-in card has looked up a great many codes in a few minutes — wait ten minutes, then try again. Moves still work.", 429)
    }

    const hit = await findCode(code)
    const out: LookupResponse = { code, hit: null, where: null, serverTime: "" }

    if (hit) {
      // A card session never learns a customer from a vendor number or receipt number (above).
      const shown = !byCard ? hit
        : hit.type === "customer" ? { ...hit, id: "", name: "" }
        : hit.type === "receipt" ? { ...hit, customer: "" }
        : hit
      out.hit = (shown.type === "receipt" ? { ...shown, createdAt: shown.createdAt.toISOString() } : shown) as ScanHitJson

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
        const res = await goodsHere([hit.code])
        const rows: ScanHere[] = res.rows.map(r => ({
          type: r.type, code: r.code, status: r.status, receipt: r.receipt, customer: r.customer,
          what: r.what, sale: r.sale, since: r.since, by: r.by,
        }))
        out.here = rows.slice(0, MAX_HERE)
        out.hereTruncated = res.truncated || rows.length > MAX_HERE
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
