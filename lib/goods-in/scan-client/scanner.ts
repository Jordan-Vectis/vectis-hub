import { cleanCode } from "./device"
import { callPlugin, hasPlugin, listenPlugin } from "./native"

// The handheld scanner — where scans come from. ONE module for every way a code arrives:
//
//   · Inside the Android app with a Newland scanner: the app's NewlandScanner plugin hands each scan
//     over as a `scan` event ({ code }). Nothing is typed anywhere, so a scan can never land in the
//     wrong box — it goes to the screen's one scan handler whatever has the cursor.
//   · The app can also deliver a scan with a window event (WINDOW_SCAN_EVENT, detail { code }) —
//     the fallback it uses if the page hasn't registered a listener with the plugin. ⚠ The event is
//     cancelable and taking it means preventDefault(): the app shows "Scan not taken — scan it
//     again" for one nobody prevented, and a worker who scans a location twice can set it to stay.
//   · Anywhere else (a plain browser, other brands set to keyboard output, or the app with "take
//     scans directly" switched off): keyboard-style. A visually quiet box keeps the cursor, with
//     inputMode="none" so no on-screen keyboard pops up; Enter (or Tab) ends a scan, and a code that
//     arrives with neither is taken once it stops arriving. Keys typed into the screen's own text
//     boxes (the note, Type a code, signing in) are left alone — they are typing, not scans —
//     EXCEPT a scanner's burst: BURST_MIN or more keys each under BURST_GAP_MS apart, ended by Enter
//     or Tab, is a scan whatever box it landed in (the cursor was left in the note, say). It is cut
//     back out of that box and handled as a scan, so it is never lost and never sent as a note.
//
// Browser only. Every path is wrapped so a missing plugin or a refused focus can never stop a scan.

export const NEWLAND_PLUGIN = "NewlandScanner"
export const WINDOW_SCAN_EVENT = "vectis-scan"

export type ScanSource = "scanner" | "keyboard"
export type ScannerMode = "native" | "keyboard"

export type ScannerOptions = {
  /** The visually quiet box keyboard-style scanners type into. */
  input: HTMLInputElement | null
  onScan: (code: string, source: ScanSource) => void
  /** True while something else needs the keyboard (signing in): scans go to onIgnored instead. */
  isPaused?: () => boolean
  onIgnored?: (code: string) => void
  onMode?: (mode: ScannerMode) => void
}

/** Inputs that take no typing — a scan "typed" into one of these is still a scan. */
const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"])

/** A box someone is typing in (not our own scan box). */
function isTextField(el: Element | null, own: HTMLInputElement | null): boolean {
  if (!el || el === own) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !NOT_TYPED.has(el.type)
  return (el as HTMLElement).isContentEditable === true
}

/** The code inside whatever the native side sent. */
function codeFrom(data: unknown): string {
  if (typeof data === "string") return cleanCode(data)
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>
    for (const k of ["code", "barcode", "data", "value"]) if (typeof d[k] === "string") return cleanCode(d[k] as string)
  }
  return ""
}

/** A keyboard-style scan with no Enter at the end is taken once characters stop arriving for this long. */
const IDLE_MS = 400
/** The same code from two different sources this close together is one scan (a device set to output both ways). */
const DOUBLE_MS = 400
/** A keyboard-style scanner types this fast; a person can't keep it up for BURST_MIN keys. */
const BURST_GAP_MS = 40
/** Keys in a burst, ended by Enter or Tab, for it to count as a scan typed into one of the screen's own boxes. */
const BURST_MIN = 4
/** Keys that come between a scanner's characters without being part of the code. */
const IGNORED_KEYS = new Set(["Shift", "CapsLock"])

/** Set a box's value so React sees it (its onChange runs), as if it had been typed. */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  try {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event("input", { bubbles: true }))
  } catch { /* the box keeps the text; the scan is still taken */ }
}

/** Take a scanned run back out of the box it was typed into (it went in at the cursor — usually the end). */
function cutRun(el: HTMLInputElement | HTMLTextAreaElement, run: string) {
  const v = el.value
  if (!run || !v) return
  const at = v.endsWith(run) ? v.length - run.length : v.lastIndexOf(run)
  if (at < 0) return
  setFieldValue(el, v.slice(0, at) + v.slice(at + run.length))
}

/** Start listening for scans. Returns the function that stops (call it on unmount). */
export function startScanner(o: ScannerOptions): () => void {
  const input = o.input
  const paused = () => {
    try { return !!o.isPaused?.() } catch { return false }
  }
  let stopped = false
  let last = { code: "", at: 0, source: "" as ScanSource | "" }

  const emit = (code: string, source: ScanSource) => {
    if (stopped || !code) return
    const now = Date.now()
    if (code === last.code && source !== last.source && now - last.at < DOUBLE_MS) return
    last = { code, at: now, source }
    if (paused()) { o.onIgnored?.(code); return }
    try { o.onScan(code, source) } catch (e) { console.error("scanner: scan handler failed", e) }
  }

  // ── Keyboard-style ────────────────────────────────────────────────────────────────────────
  let idle: ReturnType<typeof setTimeout> | null = null
  const finish = () => {
    if (idle) { clearTimeout(idle); idle = null }
    if (!input) return
    const code = cleanCode(input.value)
    input.value = ""
    if (code) emit(code, "keyboard")
  }
  const refocus = () => {
    if (stopped || !input || paused()) return
    if (typeof document === "undefined" || document.visibilityState === "hidden") return
    const a = document.activeElement
    if (a === input || isTextField(a, input)) return
    try { input.focus({ preventScroll: true }) } catch { /* not focusable right now */ }
  }
  const soon = () => { setTimeout(refocus, 60) }

  const onInputKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || (e.key === "Tab" && input?.value)) {
      e.preventDefault()
      finish()
    }
  }
  const onInput = () => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(finish, IDLE_MS)
  }

  // A scanner's burst typed into one of the screen's own boxes (see the top of this file).
  let burst: { el: Element; text: string; at: number } | null = null
  const onFieldKey = (e: KeyboardEvent, el: Element) => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || e.isComposing) { burst = null; return }
    if (IGNORED_KEYS.has(e.key)) return
    // When the key was pressed (the event's own time), not when this handler got to it: keys queued
    // behind a busy moment must not look like a burst.
    const now = e.timeStamp > 0 ? e.timeStamp : performance.now()
    const quick = !!burst && burst.el === el && now - burst.at <= BURST_GAP_MS
    if (e.key.length === 1) {
      burst = quick && burst ? { el, text: burst.text + e.key, at: now } : { el, text: e.key, at: now }
      return
    }
    if ((e.key === "Enter" || e.key === "Tab") && quick && burst && burst.text.length >= BURST_MIN) {
      const run = burst.text
      burst = null
      // Not the box's own Enter (Type a code's Go, a form's submit) and not a Tab to the next field.
      e.preventDefault()
      e.stopPropagation()
      cutRun(el, run)
      // Scanning has started again: give the cursor back to the scan box for the codes after this one
      // (not while signing in — that box is still wanted, and onIgnored says the scan wasn't used).
      if (!paused()) {
        try { (el as HTMLElement).blur() } catch { /* ignore */ }
        soon()
      }
      const code = cleanCode(run)
      if (code) emit(code, "keyboard")
      return
    }
    burst = null
  }

  // A key typed while a button (or nothing) has the cursor is the start of a scan: send the cursor to
  // the scan box first, so the characters land there — and the scanner's Enter can't press the button.
  const onAnyKey = (e: KeyboardEvent) => {
    if (!input || e.target === input || e.ctrlKey || e.metaKey || e.altKey) return
    const active = document.activeElement
    if (active && isTextField(active, input)) { onFieldKey(e, active); return }
    burst = null
    if (e.key.length === 1 && e.key !== " ") {
      if (!paused()) { try { input.focus({ preventScroll: true }) } catch { /* ignore */ } }
    } else if (e.key === "Enter" && input.value) {
      e.preventDefault()
      finish()
    }
  }

  if (input) {
    input.addEventListener("keydown", onInputKey)
    input.addEventListener("input", onInput)
    input.addEventListener("blur", soon)
  }
  window.addEventListener("keydown", onAnyKey, true)
  document.addEventListener("pointerup", soon, true)
  document.addEventListener("visibilitychange", soon)
  window.addEventListener("focus", soon)
  soon()

  // ── Native (the Android app) ─────────────────────────────────────────────────────────────
  let offNative: () => void = () => {}
  const native = hasPlugin(NEWLAND_PLUGIN)
  if (native) offNative = listenPlugin(NEWLAND_PLUGIN, "scan", data => emit(codeFrom(data), "scanner"))
  const onWindowScan = (e: Event) => {
    const code = codeFrom((e as CustomEvent).detail)
    if (!code) return
    // Taken — even while paused (signing in), when onIgnored says what happened to it — so the app
    // doesn't also say "Scan not taken — scan it again".
    e.preventDefault()
    emit(code, "scanner")
  }
  window.addEventListener(WINDOW_SCAN_EVENT, onWindowScan)
  try { o.onMode?.(native ? "native" : "keyboard") } catch { /* ignore */ }

  return () => {
    stopped = true
    if (idle) clearTimeout(idle)
    offNative()
    if (input) {
      input.removeEventListener("keydown", onInputKey)
      input.removeEventListener("input", onInput)
      input.removeEventListener("blur", soon)
    }
    window.removeEventListener("keydown", onAnyKey, true)
    document.removeEventListener("pointerup", soon, true)
    document.removeEventListener("visibilitychange", soon)
    window.removeEventListener("focus", soon)
    window.removeEventListener(WINDOW_SCAN_EVENT, onWindowScan)
  }
}

/** Whether the app's Newland scanner service answered (null = not in the app / no plugin). */
export async function nativeScannerAvailable(): Promise<boolean | null> {
  if (!hasPlugin(NEWLAND_PLUGIN)) return null
  const r = await callPlugin(NEWLAND_PLUGIN, "isAvailable")
  if (typeof r === "boolean") return r
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>
    for (const k of ["available", "value", "ok"]) if (typeof o[k] === "boolean") return o[k] as boolean
  }
  return null
}

/**
 * Ask the app to take scans straight from the scanner (on) or leave the scanner typing like a
 * keyboard (off — keyboard-style scanning then picks them up). False when not in the app.
 */
export async function setTakeScansDirectly(on: boolean): Promise<boolean> {
  if (!hasPlugin(NEWLAND_PLUGIN)) return false
  await callPlugin(NEWLAND_PLUGIN, "setTakeScansDirectly", { on })
  return true
}
