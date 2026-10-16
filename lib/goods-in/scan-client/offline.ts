// The handheld scanner — its service worker (app/(scanner)/scan/sw/route.ts serves the script). It
// keeps a copy of the /scan screen, the files it is built from, and the Hub's list of locations, so
// the screen still opens and scans still queue in a Wi-Fi dead spot. Registered ONLY from /scan,
// with scope /scan, so nothing else in the Hub is ever served from it. Browser only; every step is
// optional — a browser without service workers simply has no offline copy.

const SCRIPT = "/scan/sw"
const SCOPE = "/scan"

function controller(): ServiceWorker | null {
  try {
    return typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker.controller : null
  } catch {
    return null
  }
}

/** Ask the service worker something and wait (briefly) for its answer. */
function ask<T>(worker: ServiceWorker | null, message: Record<string, unknown>, timeoutMs = 3000): Promise<T | null> {
  return new Promise(resolve => {
    if (!worker || typeof MessageChannel === "undefined") { resolve(null); return }
    const ch = new MessageChannel()
    const timer = setTimeout(() => resolve(null), timeoutMs)
    ch.port1.onmessage = e => { clearTimeout(timer); resolve((e.data ?? null) as T | null) }
    try {
      worker.postMessage(message, [ch.port2])
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

/** The files this page was built from (Next's static chunks, CSS and fonts) — what the worker should keep. */
function pageFiles(): string[] {
  const out = new Set<string>()
  const add = (u: string | null | undefined) => {
    if (!u) return
    try {
      const url = new URL(u, location.href)
      if (url.origin === location.origin && url.pathname.startsWith("/_next/static/")) out.add(url.href)
    } catch { /* not a URL */ }
  }
  try {
    for (const e of performance.getEntriesByType("resource")) add(e.name)
  } catch { /* no timing API */ }
  try {
    document.querySelectorAll<HTMLScriptElement>("script[src]").forEach(s => add(s.src))
    document.querySelectorAll<HTMLLinkElement>("link[href]").forEach(l => add(l.href))
  } catch { /* ignore */ }
  return [...out]
}

/**
 * Register the worker (once per page load) and tell it which files this page needs. `onServed` is
 * told straight away whether THIS page was served from the worker's saved copy (the Hub couldn't
 * be reached) — for the screen's "opened from the saved copy" strip.
 */
export async function startOffline(onServed?: (fromCache: boolean) => void): Promise<{ fromCache: boolean; supported: boolean }> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return { fromCache: false, supported: false }
  let fromCache = false
  try {
    // How was this page served? Only the worker that served it knows.
    const was = await ask<{ fromCache?: boolean }>(controller(), { type: "served-from-cache?" }, 1500)
    fromCache = !!was?.fromCache
  } catch { /* unknown — assume not */ }
  try { onServed?.(fromCache) } catch { /* the screen's problem */ }
  try {
    await navigator.serviceWorker.register(SCRIPT, { scope: SCOPE, updateViaCache: "none" })
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(r => setTimeout(() => r(null), 10_000)),
    ])
    const worker = reg?.active ?? controller()
    // A page that came from the Hub just now is the current build: the worker keeps its files and
    // lets go of older builds'. One that came from the saved copy only tops up.
    void ask(worker, { type: "keep", urls: pageFiles(), fresh: !fromCache }, 60_000)
  } catch (e) {
    console.warn("scanner: offline copy unavailable:", e)
  }
  return { fromCache, supported: true }
}

/** Forget the saved copy of the screen and the locations (signing out / switching user — they're one person's). */
export async function forgetOfflineCopy(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    const workers = (regs ?? []).filter(r => new URL(r.scope).pathname.startsWith(SCOPE)).map(r => r.active).filter(Boolean) as ServiceWorker[]
    await Promise.all(workers.map(w => ask(w, { type: "forget" }, 3000)))
  } catch {
    // Nothing saved, or no workers here.
  }
}
