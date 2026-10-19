import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { getWarehouseRole, type WarehouseRole } from "@/lib/apps"
import { getGoodsInUser } from "@/lib/goods-in/access"

// Goods In → scanner sign-in cards: who is using the handheld scanner screen (/scan). SERVER ONLY
// (a plain module, NOT "use server" — nothing here may be callable from the browser).
//
// Jack, 2026-10-16: "Can you give me a QR code to auto sign in please, as there's no keyboard."
// Each worker prints a card whose QR holds a long random code; scanning it on the scanner signs
// them in, and on a shared scanner the next person scans theirs to switch.
//
// ⚠⚠ The rules (RULES.md → Goods In → handheld scanner → "Scanner sign-in cards"):
//   • A card NEVER holds a password — only CARD_PREFIX + 32 random bytes. The Hub keeps only its
//     SHA-256 (GoodsInScannerPass.tokenHash) and finds a card by that hash. The code itself exists
//     only in the one PDF answered when the card is made — never log it, store it or return it.
//   • A card signs in to the SCANNER ONLY. Its session is the `vectis-scan` cookie, HMAC-signed with
//     a key derived from AUTH_SECRET, and it is read ONLY by getScanUser() / resolveScanUser() here
//     (and dropCardUnderHubLogin, which only ever clears it), used ONLY by the /scan screen and
//     /api/goods-in/scan/*. No other part of the Hub may accept it — a lost or photographed card
//     must never open customers, receipts or anything else.
//   • Only this Hub's own pages may sign a scanner in or make a card (fromThisHub).
//   • Every request checks the card afresh: signature and expiry, the card still exists and isn't
//     cancelled, and its person still has Warehouse access (read from the database, never the cookie).
//   • No AUTH_SECRET / NEXTAUTH_SECRET → no cards and no card sessions (password sign-in still works).

/** Every card code starts with this. The version lets a future card format be told apart. */
export const CARD_PREFIX = "VSC1-"

/** CARD_PREFIX + base64url of 32 random bytes = 43 characters, no padding. */
const CARD_RE = /^VSC1-[A-Za-z0-9_-]{43}$/

/** True when `s` is shaped like a scanner card's code. Pure — safe to copy into client code too. */
export function isCardCode(s: string): boolean {
  return typeof s === "string" && CARD_RE.test(s.trim())
}

/** SHA-256 hex of a card's code — the only form of it the Hub stores. */
export function hashCardCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex")
}

/** A new card's code (for the PDF, once) and its hash (for the database). */
export function newCardCode(): { code: string; hash: string } {
  const code = CARD_PREFIX + randomBytes(32).toString("base64url")
  return { code, hash: hashCardCode(code) }
}

/** The scanner card session cookie. httpOnly, Secure in production, SameSite=Lax, Path=/, 14 hours. */
export const SCAN_COOKIE = "vectis-scan"
const MAX_AGE_S = 14 * 60 * 60
/** pass.lastUsedAt is written at most this often. */
const TOUCH_EVERY_MS = 60 * 60 * 1000
/** A pass id or user id as it may appear in the cookie (uuid / cuid). */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** What a card route answers before Run Migrations has made GoodsInScannerPass. */
export const CARDS_NOT_SET_UP = "Scanner sign-in cards need Run Migrations — an admin needs to press it first. You can still sign in with your username and password."
/** What a card route answers when the Hub has no AUTH_SECRET to sign the scanner session with. */
export const CARDS_NO_SECRET = "Scanner sign-in cards aren't set up on this Hub (it has no sign-in secret) — tell IT. You can still sign in with your username and password."
/** The ONE answer for a card that doesn't exist and one that has been cancelled — the same for both. */
export const CARD_NOT_VALID = "That card has been cancelled or isn't a Vectis card."

export class ScannerPassError extends Error {}

/** True when the Goods In tables (or a column) aren't on this environment yet. */
export const isMissingTable = (e: unknown) =>
  /does not exist|P2021|P2022/i.test(`${(e as { message?: string })?.message ?? ""} ${(e as { code?: string })?.code ?? ""}`)

/** The cookie's signing key: HMAC-SHA256 of a fixed label under the Hub's auth secret. Null when there is no secret. */
function cookieKey(): Buffer | null {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) return null
  return createHmac("sha256", secret).update("vectis-scan-cookie/v1").digest()
}

/** True when this Hub can issue cards and scanner sessions (it has an auth secret). */
export const scannerCardsConfigured = () => cookieKey() !== null

const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload, "utf8").digest("base64url")

/** The cookie's pass and user, when its signature is right and it hasn't expired. Never throws. */
function readCookie(raw: string | undefined, key: Buffer): { passId: string; userId: string } | null {
  if (!raw || raw.length > 300) return null
  const parts = raw.split(".")
  if (parts.length !== 5 || parts[0] !== "v1") return null
  const [, passId, userId, expS, sig] = parts
  if (!ID_RE.test(passId) || !ID_RE.test(userId) || !/^\d{1,12}$/.test(expS)) return null
  const want = Buffer.from(sign(key, parts.slice(0, 4).join(".")), "utf8")
  const got = Buffer.from(sig, "utf8")
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  if (Number(expS) * 1000 <= Date.now()) return null
  return { passId, userId }
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
})

/** Sign this device's scanner in with a card (sets the signed cookie). Route handlers / server actions only. */
export async function startScanSession(passId: string, userId: string): Promise<void> {
  const key = cookieKey()
  if (!key) throw new ScannerPassError(CARDS_NO_SECRET)
  if (!ID_RE.test(passId) || !ID_RE.test(userId)) throw new ScannerPassError("That card's record can't be used to sign in.")
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S
  const payload = `v1.${passId}.${userId}.${exp}`
  const jar = await cookies()
  jar.set(SCAN_COOKIE, `${payload}.${sign(key, payload)}`, cookieOptions(MAX_AGE_S))
}

/** Sign this device's scanner card session out (clears the cookie). Route handlers / server actions only. */
export async function endScanSession(): Promise<void> {
  const jar = await cookies()
  jar.set(SCAN_COOKIE, "", cookieOptions(0))
}

/** A card session younger than this is a card being signed in with right now (its Hub sign-out is still on the way). */
const FRESH_CARD_MS = 2 * 60 * 1000

/**
 * A Hub login is using the scanner (it always counts before a card): end any card session left on
 * this device from BEFORE it, so it can't come back the moment that Hub login signs out — the next
 * person would otherwise open /scan as the last card's person. A card session made in the last
 * couple of minutes is left alone: that is someone signing in with a card while the Hub login is
 * still being signed out (card-sign-in.tsx → finishCardSignIn). Route handlers only (scanGate).
 * Never throws.
 */
export async function dropCardUnderHubLogin(): Promise<void> {
  try {
    const jar = await cookies()
    const raw = jar.get(SCAN_COOKIE)?.value
    if (!raw) return
    const expS = Number(raw.split(".")[3])
    const issuedMs = Number.isFinite(expS) ? expS * 1000 - MAX_AGE_S * 1000 : 0
    if (issuedMs && Date.now() - issuedMs < FRESH_CARD_MS) return
    jar.set(SCAN_COOKIE, "", cookieOptions(0))
  } catch (e) {
    console.error("scanner card: couldn't end an older card session:", (e as Error)?.message ?? e)
  }
}

/**
 * True when a request that signs someone in, or makes a card, came from this Hub's own pages:
 * Sec-Fetch-Site "same-origin" (or "none" — the person's own action); with no Sec-Fetch-Site at all
 * (Safari before 16.4), an Origin header naming this Hub. Another site, a "same-site" neighbour, or
 * no sign of where it came from → false. Stops another site signing a scanner in to its own card
 * (login CSRF) or making cards.
 */
export function fromThisHub(h: Headers): boolean {
  const site = h.get("sec-fetch-site")
  if (site) return site === "same-origin" || site === "none"
  const origin = h.get("origin")
  if (!origin || origin === "null") return false
  let host: string
  try { host = new URL(origin).host.toLowerCase() } catch { return false }
  const first = (v: string | null) => (v ?? "").split(",")[0].trim().toLowerCase()
  const ours = new Set([first(h.get("x-forwarded-host")), first(h.get("host"))].filter(Boolean))
  for (const v of [process.env.NEXTAUTH_URL, process.env.AUTH_URL]) {
    try { if (v) ours.add(new URL(v).host.toLowerCase()) } catch { /* not a URL */ }
  }
  return ours.has(host)
}

/** A person's Warehouse tier, as getGoodsInUser judges it — null when they have no Warehouse access. */
export function warehouseTierOf(u: { role: string; allowedApps: string[]; appPermissions: unknown }): WarehouseRole | null {
  if (u.role !== "ADMIN" && !u.allowedApps.includes("WAREHOUSE")) return null
  return getWarehouseRole(u.role, u.appPermissions as Record<string, { role: string }> | null)
}

export type ScanUser = { id: string; name: string; tier: WarehouseRole; via: "hub" | "card"; passId?: string }

/** Who is using /scan, or why nobody is: signed out (no Hub session, no good card) or no Warehouse access. */
export type ScanWho = { user: ScanUser; why?: undefined } | { user: null; why: "signed-out" | "no-access" }

/** The card session's person — a ScanUser, "no-access" (a good card whose person lost Warehouse access), or null. */
async function cardUser(): Promise<ScanUser | "no-access" | null> {
  const key = cookieKey()
  if (!key) return null
  const jar = await cookies()
  const c = readCookie(jar.get(SCAN_COOKIE)?.value, key)
  if (!c) return null
  const found = await Promise.all([
    prisma.goodsInScannerPass.findUnique({ where: { id: c.passId }, select: { userId: true, revokedAt: true, lastUsedAt: true } }),
    prisma.user.findUnique({ where: { id: c.userId }, select: { name: true, role: true, allowedApps: true, appPermissions: true } }),
  ]).catch((e: unknown) => {
    // Not migrated yet: card sessions simply don't count.
    if (isMissingTable(e)) return null
    throw e
  })
  if (!found) return null
  const [pass, u] = found
  if (!pass || pass.revokedAt || pass.userId !== c.userId || !u) return null
  const tier = warehouseTierOf(u)
  if (!tier) return "no-access"
  if (!pass.lastUsedAt || Date.now() - pass.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.goodsInScannerPass
      .updateMany({ where: { id: c.passId, revokedAt: null }, data: { lastUsedAt: new Date() } })
      .catch((e: unknown) => console.error("scanner card: couldn't note when it was last used:", (e as Error)?.message ?? e))
  }
  return { id: c.userId, name: u.name, tier, via: "card", passId: c.passId }
}

/**
 * As getScanUser, but says WHY there is nobody, and throws on an unexpected database error (so an
 * API route can answer 500/503 rather than "signed out"). The same rule as getScanUser: used ONLY
 * by the /scan screen and /api/goods-in/scan/*.
 *
 * The Hub session wins whenever there is one (judged on the effective session, exactly as
 * getGoodsInUser — an admin viewing as someone is them); a card session only counts with no Hub
 * session at all. So signing in with a card on a device that has a Hub session needs a signOut too.
 */
export async function resolveScanUser(): Promise<ScanWho> {
  const me = await getGoodsInUser()
  if (me) return { user: { id: me.id, name: me.name ?? "", tier: me.whRole, via: "hub" } }
  if (await getEffectiveSession()) return { user: null, why: "no-access" }
  const card = await cardUser()
  if (card === "no-access") return { user: null, why: "no-access" }
  if (card) return { user: card }
  return { user: null, why: "signed-out" }
}

/**
 * The person using /scan: the normal Hub session (effective session, as getGoodsInUser) if there
 * is one, otherwise a valid scanner card session (signature + expiry OK, pass exists and not
 * revoked, user still has Warehouse access — read fresh from the DB). null otherwise. Touches
 * pass.lastUsedAt at most once an hour. Never throws (missing table → card sessions simply don't
 * count). ⚠ Used ONLY by the /scan screen and /api/goods-in/scan/*.
 */
export async function getScanUser(): Promise<ScanUser | null> {
  try {
    return (await resolveScanUser()).user
  } catch (e) {
    console.error("scanner sign-in check failed:", (e as Error)?.message ?? e)
    return null
  }
}
