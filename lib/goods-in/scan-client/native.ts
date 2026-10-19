// The handheld scanner — talking to the Android app (scanner-app/, Capacitor), when the screen is
// running inside it. Browser only, and every call degrades to "not there" in a plain browser.
//
// The Hub's page does NOT bundle @capacitor/core: the app loads the Hub from its server address and
// Capacitor injects its bridge into the page. That bridge gives `window.Capacitor` with, for every
// native plugin, `Capacitor.Plugins.<Name>` (methods + addListener) and the lower-level
// nativePromise / nativeCallback. This file uses whichever is there.

type ListenerHandle = { remove?: () => unknown }
type PluginProxy = Record<string, unknown> & { addListener?: (event: string, cb: (data: unknown) => void) => ListenerHandle | Promise<ListenerHandle> }
type CapacitorBridge = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  isPluginAvailable?: (name: string) => boolean
  registerPlugin?: (name: string) => PluginProxy
  Plugins?: Record<string, PluginProxy | undefined>
  PluginHeaders?: { name: string }[]
  nativeCallback?: (plugin: string, method: string, options: unknown, cb: (data: unknown, err?: unknown) => void) => string | Promise<string>
  nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<unknown>
}

function bridge(): CapacitorBridge | null {
  if (typeof window === "undefined") return null
  const c = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor
  return c && typeof c === "object" ? c : null
}

/** True inside the Android app (Capacitor's bridge says it is a native platform). */
export function isNativeApp(): boolean {
  try {
    return !!bridge()?.isNativePlatform?.()
  } catch {
    return false
  }
}

/** True when the app has the named native plugin. */
export function hasPlugin(name: string): boolean {
  const c = bridge()
  if (!c || !isNativeApp()) return false
  try {
    if (c.Plugins && Object.prototype.hasOwnProperty.call(c.Plugins, name)) return true
  } catch { /* fall through */ }
  try {
    if (Array.isArray(c.PluginHeaders) && c.PluginHeaders.some(h => h?.name === name)) return true
  } catch { /* fall through */ }
  try {
    return !!c.isPluginAvailable?.(name)
  } catch {
    return false
  }
}

function proxy(name: string): PluginProxy | null {
  const c = bridge()
  if (!c) return null
  try {
    const p = c.Plugins?.[name]
    if (p) return p
  } catch { /* fall through */ }
  try {
    if (typeof c.registerPlugin === "function") return c.registerPlugin(name)
  } catch { /* fall through */ }
  return null
}

/** Call a native plugin method. Resolves undefined when it isn't there or fails — never throws. */
export async function callPlugin(name: string, method: string, options: Record<string, unknown> = {}): Promise<unknown> {
  if (!hasPlugin(name)) return undefined
  try {
    const p = proxy(name)
    const fn = p?.[method]
    if (typeof fn === "function") return await (fn as (o: unknown) => unknown).call(p, options)
    const c = bridge()
    if (typeof c?.nativePromise === "function") return await c.nativePromise(name, method, options)
  } catch {
    // A plugin that refuses (or a method the installed app doesn't have yet) is the same as no plugin.
  }
  return undefined
}

/** Listen for a native plugin's event. Returns the function that stops listening (always safe to call). */
export function listenPlugin(name: string, event: string, cb: (data: unknown) => void): () => void {
  if (!hasPlugin(name)) return () => {}
  let stopped = false
  let remove: (() => void) | null = null
  try {
    const p = proxy(name)
    if (p && typeof p.addListener === "function") {
      const h = p.addListener(event, data => { if (!stopped) cb(data) })
      remove = () => { void Promise.resolve(h).then(x => x?.remove?.()).catch(() => {}) }
    } else {
      const c = bridge()
      if (typeof c?.nativeCallback === "function") {
        const id = c.nativeCallback(name, "addListener", { eventName: event }, data => { if (!stopped && data != null) cb(data) })
        remove = () => {
          void Promise.resolve(id)
            .then(callbackId => c.nativePromise?.(name, "removeListener", { eventName: event, callbackId }))
            .catch(() => {})
        }
      }
    }
  } catch {
    remove = null
  }
  return () => {
    stopped = true
    try { remove?.() } catch { /* already gone */ }
  }
}
