import { tidyCode } from "./device"

// The handheld scanner — scanner sign-in cards, the browser's half. A card is a printed QR code that
// signs one person in to the SCANNER only (/scan and /api/goods-in/scan/*, never the rest of the Hub).
// The QR holds a long random code — never a password — and the Hub keeps only its hash
// (lib/goods-in/scanner-pass.ts, the server's half, which this must agree with).
//
//   POST   /api/goods-in/scan/pass { code } → 200 { ok, name } and the scanner's own session cookie set
//   DELETE /api/goods-in/scan/pass          → that cookie cleared (always 200)
//
// ⚠ A card's code is a secret: it is never logged, never shown on screen, never kept on the device
// and never put in a URL — it goes once, in the body of the POST, and is forgotten. Browser only.

/** Every card code starts with this (lib/goods-in/scanner-pass.ts CARD_PREFIX — keep the two the same). */
export const CARD_PREFIX = "VSC1-"

/** CARD_PREFIX + base64url (no padding) of 32 random bytes = 43 characters. Case-sensitive. */
const CARD_RE = /^VSC1-[A-Za-z0-9_-]{43}$/

/** A card's code exactly as printed — the only shape worth sending to the Hub. (Same rule as the server's isCardCode.) */
export function isCardCode(s: string): boolean {
  return CARD_RE.test(s)
}

/**
 * A card's code, even one a keyboard-style scanner has read in capitals — for recognising a card
 * scanned where an item was expected (it is never an item), never for signing in with.
 */
export function looksLikeCard(s: string): boolean {
  return /^VSC1-[A-Z0-9_-]{43}$/i.test(tidyCode(s))
}

export type CardSignIn =
  | { ok: true; name: string }
  | { ok: false; kind: "refused" | "no-access" | "not-ready" | "too-many" | "offline" | "server"; message: string }

const PASS_URL = "/api/goods-in/scan/pass"

async function send(init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  try {
    return await fetch(PASS_URL, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      // JSON only: inside the app, Capacitor only rewrites requests that ask for HTML.
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: ctl?.signal,
    })
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Sign in to the scanner with a card's code (exactly as scanned). Never throws. */
export async function signInWithCard(code: string): Promise<CardSignIn> {
  let res: Response
  try {
    res = await send({ method: "POST", body: JSON.stringify({ code }) }, 15_000)
  } catch {
    return { ok: false, kind: "offline", message: "The Hub couldn't be reached — signing in needs the Wi-Fi. Scan the card again when it's back." }
  }
  let body: { ok?: unknown; name?: unknown; error?: unknown } | null = null
  try { body = await res.json() } catch { body = null }
  const said = typeof body?.error === "string" && body.error ? body.error : null
  if (res.ok && body?.ok === true) return { ok: true, name: typeof body.name === "string" && body.name ? body.name : "you" }
  const s = res.status
  // One message for a card the Hub doesn't know and one that was cancelled — on purpose (the Hub says the same for both).
  if (s === 401) return { ok: false, kind: "refused", message: "That card has been cancelled or isn't a Vectis card." }
  if (s === 403) return { ok: false, kind: "no-access", message: said ?? "That card's owner doesn't have Goods In access. Ask a Warehouse manager." }
  if (s === 503) return { ok: false, kind: "not-ready", message: said ?? "Scanner sign-in cards need Run Migrations — sign in with username and password for now." }
  if (s === 429) return { ok: false, kind: "too-many", message: said ?? "Too many tries — wait a few minutes, then scan the card again." }
  if (s === 400) return { ok: false, kind: "refused", message: "That card couldn't be read — scan it again." }
  if (s === 0 || s === 502 || s === 504) return { ok: false, kind: "offline", message: "The Hub didn't answer — check the Wi-Fi and scan the card again." }
  return { ok: false, kind: "server", message: said ?? `Signing in didn't work just now (the Hub answered ${s}). Scan the card again.` }
}

/** End this scanner's card session (signing out, or someone signing in with a password). True when the Hub said so. Never throws. */
export async function endCardSession(): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await send({ method: "DELETE" }, 10_000)
      if (res.ok) return true
    } catch {
      // Try once more.
    }
  }
  return false
}
