import type { BootstrapResponse, LookupResponse, ScanAck, ScanAckResponse, ScanEvent, SyncResponse } from "./types"

// The handheld scanner — the calls to the Hub (lib/goods-in/scan-contract.ts), plus sending the
// failed-scan pop-up's acknowledgements (POST /api/goods-in/scan/acks). Browser only.
// Every failure becomes a ScanApiError with a `kind` the screen can say plainly — never a bare
// network error — and every call has a time limit: a Wi-Fi dead spot can leave a request hanging
// for minutes otherwise.

export type ApiErrorKind =
  | "offline"      // no network, or the request never got an answer
  | "signed-out"   // 401
  | "no-access"    // 403
  | "not-ready"    // 503 (Run Migrations), or the scanner's routes aren't on this Hub yet (404)
  | "refused"      // 400 — the Hub couldn't read what was sent (nothing applied)
  | "server"       // 5xx or anything else unexpected

export class ScanApiError extends Error {
  constructor(readonly kind: ApiErrorKind, message: string, readonly status = 0) {
    super(message)
  }
}

const SYNC_URL = "/api/goods-in/scan/sync"
const BOOTSTRAP_URL = "/api/goods-in/scan/bootstrap"
const LOOKUP_URL = "/api/goods-in/scan/lookup"
const ACKS_URL = "/api/goods-in/scan/acks"

async function call<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ body: T; res: Response }> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  // The caller's own signal (the sync engine letting go of a call) stops it too.
  const outer = init.signal ?? null
  const letGo = () => ctl?.abort()
  if (outer && ctl) {
    if (outer.aborted) ctl.abort()
    else outer.addEventListener("abort", letGo, { once: true })
  }
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      // JSON only: inside the app, Capacitor only rewrites requests that ask for HTML.
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
      signal: ctl?.signal ?? outer,
    })
  } catch {
    throw new ScanApiError("offline", "The Hub couldn't be reached — no Wi-Fi, or it didn't answer in time.")
  } finally {
    if (timer) clearTimeout(timer)
    outer?.removeEventListener("abort", letGo)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const said = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : null
  if (res.ok && body && typeof body === "object") return { body: body as T, res }
  const s = res.status
  if (s === 401) throw new ScanApiError("signed-out", said ?? "You've been signed out — sign in again to send scans.", s)
  if (s === 403) throw new ScanApiError("no-access", said ?? "This account doesn't have Goods In access.", s)
  if (s === 503) throw new ScanApiError("not-ready", said ?? "The Hub isn't ready for the scanner yet.", s)
  if (s === 404) throw new ScanApiError("not-ready", "This Hub doesn't have the scanner's service yet — it arrives with the next update.", s)
  if (s === 400) throw new ScanApiError("refused", said ?? "The Hub couldn't read what was sent.", s)
  if (s === 0 || s === 502 || s === 504) throw new ScanApiError("offline", said ?? "The Hub didn't answer — check the Wi-Fi.", s)
  throw new ScanApiError("server", said ?? `The Hub answered with an error (${s}).`, s)
}

/** Send scans (≤ MAX_SCAN_EVENTS, in scan order). */
export async function postSync(deviceId: string, events: ScanEvent[]): Promise<SyncResponse> {
  const { body } = await call<SyncResponse>(SYNC_URL, { method: "POST", body: JSON.stringify({ deviceId, events }) }, 50_000)
  if (!Array.isArray(body.results)) throw new ScanApiError("server", "The Hub's answer didn't say what happened to the scans — they're kept and will be sent again.")
  return body
}

/** Who is signed in, which Hub, and every location. `fromCache` = the service worker's saved copy (offline). */
export async function getBootstrap(): Promise<{ data: BootstrapResponse; fromCache: boolean }> {
  const { body, res } = await call<BootstrapResponse>(BOOTSTRAP_URL, { method: "GET" }, 12_000)
  if (!body.user || !Array.isArray(body.locations)) throw new ScanApiError("server", "The Hub's answer about locations didn't make sense.")
  return { data: body, fromCache: res.headers.get("x-scan-from-cache") === "1" }
}

/**
 * Send acknowledged failed scans (≤ MAX_SCAN_ACKS) — { deviceId, acks } → { results: { id, ok, error?, keep? }[] }.
 * 503 = the Hub's table isn't there yet (Run Migrations): nothing stored, and they stay queued. The
 * Hub stops starting new ones about 15 s in, well inside this call's 30 s (app/api/goods-in/scan/acks).
 * `signal` lets the sync engine let go of it when a scan is waiting to go (scans first); the Hub
 * stores each once, so sending them again after that is safe.
 */
export async function postAcks(deviceId: string, acks: ScanAck[], signal?: AbortSignal): Promise<ScanAckResponse> {
  const { body } = await call<ScanAckResponse>(ACKS_URL, { method: "POST", body: JSON.stringify({ deviceId, acks }), signal }, 30_000)
  if (!Array.isArray(body.results)) throw new ScanApiError("server", "The Hub's answer didn't say what happened to the acknowledgements — they're kept and will be sent again.")
  return body
}

/** What a code is and where it is now (online only). */
export async function lookup(code: string): Promise<LookupResponse> {
  const { body } = await call<LookupResponse>(`${LOOKUP_URL}?code=${encodeURIComponent(code)}`, { method: "GET" }, 12_000)
  return body
}
