// The handheld scanner — this device: its id, which Hub it is pointed at, and ids for new scans.
// Browser only (every storage access in try/catch: a private window or a locked-down WebView can
// refuse it, and that must never stop a scan).

/** A random v4 uuid — the id a scan keeps for ever, so the Hub can tell a replay from a new scan. */
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  } catch {
    // Not a secure context — fall through to getRandomValues.
  }
  const b = new Uint8Array(16)
  try {
    crypto.getRandomValues(b)
  } catch {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256)
  }
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const DEVICE_KEY = "vectis-scan-device-id"
let memoryDeviceId: string | null = null

/** This device's id, made once and kept in localStorage (sent with every sync, recorded on every scan). */
export function deviceId(): string {
  try {
    const v = localStorage.getItem(DEVICE_KEY)
    if (v && /^[0-9a-f-]{36}$/i.test(v)) return v
  } catch {
    // Storage refused — an id for this page only.
  }
  if (memoryDeviceId) return memoryDeviceId
  const id = newId()
  memoryDeviceId = id
  try { localStorage.setItem(DEVICE_KEY, id) } catch { /* kept for this page only */ }
  return id
}

export type HubKind = "production" | "staging" | "sandbox" | "local" | "other"
export type HubInfo = { kind: HubKind; label: string }

/**
 * Which Hub this screen is talking to, from the address (or the Hub's own word from bootstrap).
 * Shown in the status bar so nobody scans a morning's shelving into the test Hub.
 */
export function hubInfo(host: string, said?: string | null): HubInfo {
  const s = (said ?? "").toLowerCase()
  const h = host.toLowerCase()
  const pick = (k: HubKind): HubInfo => ({
    kind: k,
    label: k === "production" ? "Live Hub" : k === "staging" ? "Staging" : k === "sandbox" ? "Sandbox" : k === "local" ? "This computer" : host || "Unknown Hub",
  })
  if (s === "production" || s === "staging" || s === "sandbox") return pick(s)
  if (!h) return pick("other")
  if (h.includes("sandbox")) return pick("sandbox")
  if (h.includes("staging")) return pick("staging")
  if (h.includes("production")) return pick("production")
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost") || h.endsWith(".test")) return pick("local")
  return pick("other")
}

/** Strip what a scanner may add around a code (control characters, spaces) and upper-case it, as the Hub does. */
export function cleanCode(raw: string): string {
  return raw.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, "").toUpperCase()
}

/** Tote, pallet and lot barcode shapes: T027657, P000001, F066001, R000016-413. Anything else is checked against the locations. */
const ITEM_SHAPES = [/^[A-Z]{1,2}\d{5,8}$/, /^[A-Z]\d{4,7}-\d{1,6}$/]
export const looksLikeItem = (code: string) => ITEM_SHAPES.some(r => r.test(code))
