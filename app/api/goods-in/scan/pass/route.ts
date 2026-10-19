import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  CARD_NOT_VALID, CARDS_NO_SECRET, CARDS_NOT_SET_UP, endScanSession, fromThisHub, hashCardCode, isCardCode, isMissingTable,
  scannerCardsConfigured, startScanSession, warehouseTierOf,
} from "@/lib/goods-in/scanner-pass"
import { errorJson, failure } from "../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST   /api/goods-in/scan/pass  { code } (JSON only) → 200 { ok: true, name } with the scanner card cookie set
//                                           | 401 unknown or cancelled card (ONE message for both)
//                                           | 403 its person has no Warehouse access, or not from this Hub
//                                           | 415 not JSON | 429 too many bad cards from here
//                                           | 503 not migrated / no sign-in secret
// DELETE /api/goods-in/scan/pass → clears the scanner card cookie (sign out of the scanner). Always 200.
//
// Scanning a sign-in card on the handheld scanner (lib/goods-in/scanner-pass.ts has the rules). The
// card is found by the SHA-256 of its code — the code itself is never stored, logged or answered.
// A card signs in to the SCANNER only: the cookie set here is read by getScanUser() alone, which
// only /scan and /api/goods-in/scan/* use. Open to the signed-out on purpose (that's the point —
// /api is outside the login gate anyway). Nothing here touches Business Central.
//
// ⚠ Only this Hub's own pages may sign a scanner in (fromThisHub), and only with a JSON body — so
// another site can't post a form that signs someone's scanner in to ITS card (a JSON post from
// another site needs a CORS preflight, which this route never answers).

/** Bad card tries from one address in WINDOW_MS before it is told to wait. */
const MAX_FAILS = 20
const WINDOW_MS = 5 * 60 * 1000
/**
 * ⚠ ADVISORY: a 256-bit code can't be guessed, so this is not what keeps cards safe — it only tells
 * a flood of bad codes to back off. A GOOD card always signs in, however many bad ones came from the
 * same address: every scanner in the warehouse shares one public address, and a few people scanning
 * an old cancelled card must never lock everyone's valid card out. In memory, per server; a restart
 * forgets it.
 */
const fails = new Map<string, { n: number; since: number }>()

/**
 * The address Railway's proxy saw: the LAST X-Forwarded-For entry (the one the proxy added). The
 * first entries are whatever the client sent and could be anything.
 */
function addressOf(req: NextRequest): string {
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map(s => s.trim()).filter(Boolean)
  return (hops[hops.length - 1] || req.headers.get("x-real-ip") || "unknown").slice(0, 64)
}

function tooMany(ip: string, now: number): boolean {
  const f = fails.get(ip)
  if (!f) return false
  if (now - f.since > WINDOW_MS) { fails.delete(ip); return false }
  return f.n >= MAX_FAILS
}

function noteFail(ip: string, now: number) {
  if (fails.size > 5000) {
    for (const [k, v] of fails) if (now - v.since > WINDOW_MS) fails.delete(k)
    if (fails.size > 5000) fails.clear()
  }
  const f = fails.get(ip)
  if (!f || now - f.since > WINDOW_MS) fails.set(ip, { n: 1, since: now })
  else f.n++
}

/** A card that didn't work: the one message — or, after too many from here, "wait". */
function badCard(ip: string, now: number) {
  noteFail(ip, now)
  if (tooMany(ip, now)) return errorJson(`${CARD_NOT_VALID} Too many cards that didn't work have been scanned here — wait five minutes before trying another.`, 429)
  return errorJson(CARD_NOT_VALID, 401)
}

/** Control characters a scanner can put round a code (CR, tab, GS1 separators) — never part of one. */
const clean = (v: string) => v.replace(/[\u0000-\u001F\u007F]/g, "").trim()

export async function POST(req: NextRequest) {
  try {
    if (!fromThisHub(req.headers)) return errorJson("That sign-in didn't come from the Hub's scanner screen.", 403)
    if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) {
      return errorJson("That sign-in didn't come from the Hub's scanner screen.", 415)
    }
    if (!scannerCardsConfigured()) return errorJson(CARDS_NO_SECRET, 503)
    const ip = addressOf(req)
    const now = Date.now()

    const body = (await req.json().catch(() => null)) as { code?: unknown } | null
    const code = clean((body && typeof body.code === "string" ? body.code : "").slice(0, 200))
    if (!isCardCode(code)) return badCard(ip, now)

    // Looked up FIRST, so a good card is never turned away by the limiter (above).
    let pass: { id: string; userId: string; revokedAt: Date | null } | null
    try {
      pass = await prisma.goodsInScannerPass.findUnique({ where: { tokenHash: hashCardCode(code) }, select: { id: true, userId: true, revokedAt: true } })
    } catch (e) {
      if (isMissingTable(e)) return errorJson(CARDS_NOT_SET_UP, 503)
      throw e
    }
    const u = pass && !pass.revokedAt
      ? await prisma.user.findUnique({ where: { id: pass.userId }, select: { name: true, role: true, allowedApps: true, appPermissions: true } })
      : null
    if (!pass || pass.revokedAt || !u) return badCard(ip, now)
    if (!warehouseTierOf(u)) {
      return errorJson(`This card is ${u.name}'s, and their account doesn't have Warehouse access any more — ask a Warehouse manager.`, 403)
    }

    // Cancelled a moment ago (between the read and now)? Then it doesn't sign in.
    const touched = await prisma.goodsInScannerPass.updateMany({ where: { id: pass.id, revokedAt: null }, data: { lastUsedAt: new Date() } })
    if (touched.count === 0) return badCard(ip, now)
    await startScanSession(pass.id, pass.userId)
    return NextResponse.json({ ok: true, name: u.name }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    return failure("scanner card sign-in", e)
  }
}

export async function DELETE() {
  try {
    await endScanSession()
  } catch (e) {
    console.error("goods-in scanner card sign-out error:", (e as Error)?.message ?? e)
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}
