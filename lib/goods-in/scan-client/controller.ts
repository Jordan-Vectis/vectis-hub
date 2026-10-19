import type { LocationKind } from "@/lib/goods-in/model"
import { getBootstrap, lookup, ScanApiError } from "./api"
import { cleanCode, deviceId, hubInfo, looksLikeItem, newId, type HubInfo } from "./device"
import { looksLikeCard } from "./card"
import { signal, unlockSound, type Sound, type Tone } from "./feedback"
import { isNativeApp } from "./native"
import { forgetOfflineCopy, startOffline } from "./offline"
import { nativeScannerAvailable, setTakeScansDirectly, type ScannerMode, type ScanSource } from "./scanner"
import { openScanStore, type ScanStore, type StoreKind } from "./store"
import { SyncEngine, type Answered, type SyncState } from "./sync"
import { RECENT_SHOWN, SCANNER_NOT_SET_UP, type BootstrapResponse, type LookupResponse, type ScanHere, type ScanLocation, type StoredScan } from "./types"

// The handheld scanner's brain — everything the /scan screen does, outside React. The screen
// subscribes to its snapshot (useSyncExternalStore) and calls its methods; it holds no rules itself.
//
// Every scan, whichever way it arrived (scanner.ts), goes through scan() and is handled strictly
// one after another: a scanner can fire the next code before the last has been dealt with, and
// that scan must neither be lost nor overtake.
//
//   Put away / Move — a scan is a LOCATION (a code on the Hub's list, kept on the device so it
//     works offline) or an ITEM (tote, pallet, lot barcode):
//       · item, nothing set            → it waits for a location
//       · location with an item waiting → the move is queued
//       · location with nothing waiting → "location stays set": every item after it goes there,
//                                          until another location is scanned or Done is pressed
//       · item with a location set     → the move is queued straight away
//       · a second item while one waits → the new one waits instead (nothing moved)
//     Moves are QUEUED on the device and sent in order (sync.ts) — the screen never waits for the
//     Hub to answer before the next scan. The Hub's answer comes back on the scan's row, and a
//     refused or stale one turns the banner red/amber and stays listed until it is dismissed.
//   Find — online only: what a code is and where it is now.
//   Check a location — online: scan a location, then everything on it; ticks off what the Hub
//     records there, and says what's recorded elsewhere (one tap queues "Move it here") and what
//     the Hub doesn't know.
//
// A scanner sign-in card (card.ts) scanned here is never an item: it is turned away before it is
// queued or looked up ("That's a sign-in card — press Switch user…"); signing in with one happens in
// the Switch user panel, which takes the scans while it is open (app/(scanner)/scan/scan-app.tsx).
//
// Two guards for a shared device left lying about: a location that stays set is let go after
// PIN_IDLE_MS without a scan (the next item waits for a location instead of going there), and after
// IDLE_ASK_MS without a scan or a tap the next one asks "Still <name>?" before anything is recorded
// against them — and so does the first scan on a screen opened from the saved copy (no Wi-Fi, so
// nobody could check who is signed in). The app's Back button is offered here first ("vectis:back"):
// it cancels signing in, puts down a waiting item, or lets go of a location that stays set, before it
// leaves a screen.
//
// SIGNED OUT while the screen is open (the card was cancelled or its 14 hours ran out, the Hub login
// ended, or the person lost Goods In access): whichever call hears it first — a send, the bootstrap or
// a lookup — calls sessionEnded(), which stops taking scans and reloads /scan, where the layout shows
// "Scan your sign-in card" (or the no-access message). The queue on the device is left as it is: the
// same person signing in again sends their scans; anyone else sees "N scans by … still waiting".
//
// Browser only. Nothing here touches Business Central.

/** Who is scanning — `via` says how they signed in: their Hub login, or a scanner sign-in card (card.ts). */
export type Me = { id: string; name: string; tier: string; via: "hub" | "card" }
export type Screen = "home" | "move" | "find" | "check"
export type BannerTone = Tone | "info"
export type Banner = {
  tone: BannerTone
  title: string
  detail: string | null
  code: string | null
  /** The scan this banner is about, so the Hub's answer can update it in place. */
  scanId: string | null
  actions: { id: string; label: string }[]
}
export type Place = { code: string; name: string | null; kind: LocationKind | null; active: boolean }
export type FindState =
  | { status: "idle" }
  | { status: "looking"; code: string }
  | { status: "done"; code: string; res: LookupResponse }
  | { status: "failed"; code: string; message: string; offline: boolean }
export type CheckExtra = {
  code: string
  state: "checking" | "elsewhere" | "not-goods" | "unknown" | "offline" | "queued" | "moved" | "failed"
  what: string | null
  where: string | null
  scanId: string | null
}
export type CheckState = {
  place: Place
  status: "loading" | "ready" | "failed"
  error: string | null
  expected: ScanHere[]
  truncated: boolean
  /** Codes ticked off (what the Hub records here AND someone scanned). */
  found: string[]
  /** Everything scanned that the Hub doesn't record here, newest first. */
  extras: CheckExtra[]
}
export type WaitingOther = { userId: string; name: string; n: number }
export type SwitchState = "idle" | "sending" | "open"

export type Snapshot = {
  started: boolean
  screen: Screen
  banner: Banner | null
  pinned: Place | null
  pinnedCount: number
  pending: string | null
  note: string
  find: FindState
  check: CheckState | null
  /** Newest first, not counting problems. */
  recent: StoredScan[]
  /** Refused or stale and not dismissed yet, newest first. */
  problems: StoredScan[]
  sendingIds: ReadonlySet<string>
  waitingMine: number
  waitingOthers: WaitingOther[]
  online: boolean
  fromCache: boolean
  sync: SyncState
  locationCount: number
  locationsAt: number | null
  notice: string | null
  hub: HubInfo
  storeKind: StoreKind | null
  scannerMode: ScannerMode
  nativeAvailable: boolean | null
  takeDirect: boolean
  sound: boolean
  /** The Hub says someone else is signed in on this device now (another tab / the sign-in page). */
  userMismatch: string | null
  switching: SwitchState
  /** Nothing has been scanned or tapped for a while: "Still <name>?" is asked before the next scan. */
  stillYou: boolean
  /** How far out this device's clock is (Hub minus device, ms) when that's more than CLOCK_WARN_MS; else null. */
  clockOffMs: number | null
  /** False when the browser wouldn't promise to keep this scanner's saved scans (plain browsers only); null = not known. */
  persisted: boolean | null
}

const SOUND_KEY = "vectis-scan-sound"
const DIRECT_KEY = "vectis-scan-direct"
const BOOT_KEY = "bootstrap"
const BOOT_REFRESH_MS = 10 * 60_000
const PROBE_MS = 30_000
/** The same item to the same place this soon again is a double read, not a new move. */
const REPEAT_MS = 15_000
/** A device clock further out than this is corrected with the Hub's time. */
const CLOCK_SLACK_MS = 60_000
/** …and further out than this, the screen says so (scans would be refused or called stale without the correction). */
const CLOCK_WARN_MS = 5 * 60_000
const CLOCK_KEY = "clock"
/** A saved clock correction older than this isn't trusted (the clock may have been put right since). */
const CLOCK_KEEP_MS = 7 * 86_400_000
/** A location that stays set is let go after this long without a scan. */
const PIN_IDLE_MS = 10 * 60_000
/** After this long without a scan or a tap, the next scan asks "Still <name>?" first. */
const IDLE_ASK_MS = 20 * 60_000
/** When this page last reloaded because the Hub said its person was signed out (sessionStorage) — so it can never loop. */
const ENDED_KEY = "vectis-scan-ended-at"
const ENDED_AGAIN_MS = 30_000

const EMPTY_SYNC: SyncState = { sending: false, problem: null, lastOkAt: null, nextTryAt: null }
const NO_IDS: ReadonlySet<string> = new Set()

const isProblem = (s: StoredScan) => (s.status === "refused" || s.status === "stale") && !s.dismissed
/** "Already there" is the Hub refusing a move nobody needed — said plainly, never a problem to dismiss. */
export const isAlreadyThere = (s: Pick<StoredScan, "status" | "message">) => s.status === "refused" && /\balready at\b/i.test(s.message ?? "")

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === "1"
  } catch {
    return fallback
  }
}
function writePref(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? "1" : "0") } catch { /* this page only */ }
}

const kindWord = (k: LocationKind | null | undefined) => (k === "bench" ? "bench" : k === "shelf" ? "shelf" : k === "storage" ? "storage" : k === "other" ? "other" : "location")
const placeLine = (p: Place) => `${p.code}${p.kind ? ` (${kindWord(p.kind)})` : ""}`

/** "10:42" — London clock time, for a scan on this device. */
function clockTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ""
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(d)
  } catch {
    return d.toISOString().slice(11, 16)
  }
}

/** "12 minutes", "3 hours", "2 days" — how far out a clock is. */
export function howFar(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000)
  if (m < 90) return `${m} ${m === 1 ? "minute" : "minutes"}`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hours`
  const d = Math.round(h / 24)
  return `${d} days`
}

export class ScanController {
  readonly me: Me
  private store: ScanStore | null = null
  /** Scans that arrived before the store was open, waiting for it. */
  private whenOpen: (() => void)[] = []
  private engine: SyncEngine | null = null
  private scans: StoredScan[] = []
  private locations = new Map<string, ScanLocation>()
  private chain: Promise<void> = Promise.resolve()
  private actions = new Map<string, () => void | Promise<void>>()
  private listeners = new Set<() => void>()
  private gen = 0
  /** True while this screen has a history entry of its own pushed (away from Home). */
  private pushed = false
  private lastSeq = 0
  private clockOffset = 0
  /** The Hub has told this page its time (so a saved correction must not overwrite it). */
  private clockLive = false
  private lastScanAt = 0
  private lastActivityAt = 0
  /** A location that stayed set and was let go at the start of this scan (PIN_IDLE_MS) — said once. */
  private letGo: string | null = null
  private netOkAt = 0
  private netFailAt = 0
  private bootAt = 0
  private timers: ReturnType<typeof setInterval>[] = []
  /** The Hub has said this person is signed out here, and the page is going back to the sign-in screen. */
  private ended = false
  private channel: BroadcastChannel | null = null
  private cleanup: (() => void)[] = []
  private s: Snapshot
  private readonly initial: Snapshot

  constructor(me: Me) {
    this.me = me
    this.initial = {
      started: false,
      screen: "home",
      banner: null,
      pinned: null,
      pinnedCount: 0,
      pending: null,
      note: "",
      find: { status: "idle" },
      check: null,
      recent: [],
      problems: [],
      sendingIds: NO_IDS,
      waitingMine: 0,
      waitingOthers: [],
      online: true,
      fromCache: false,
      sync: EMPTY_SYNC,
      locationCount: 0,
      locationsAt: null,
      notice: null,
      hub: { kind: "other", label: "" },
      storeKind: null,
      scannerMode: "keyboard",
      nativeAvailable: null,
      takeDirect: true,
      sound: true,
      userMismatch: null,
      switching: "idle",
      stillYou: false,
      clockOffMs: null,
      persisted: null,
    }
    this.s = this.initial
  }

  // ── The React side ─────────────────────────────────────────────────────────────────────────

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  getSnapshot = () => this.s
  getServerSnapshot = () => this.initial

  private set(patch: Partial<Snapshot>) {
    this.s = { ...this.s, ...patch }
    for (const fn of this.listeners) {
      try { fn() } catch { /* a listener's own problem */ }
    }
  }

  // ── Start and stop (mount / unmount) ───────────────────────────────────────────────────────

  start() {
    const gen = ++this.gen
    this.lastActivityAt = Date.now()
    this.set({
      hub: hubInfo(location.hostname),
      sound: readPref(SOUND_KEY, true),
      takeDirect: readPref(DIRECT_KEY, true),
      online: navigator.onLine !== false,
    })
    // A ?s= left in the address by the history entries below: the screen always opens on Home.
    // ⚠ Deferred: Next's App Router patches history.pushState/replaceState (so its own state rides
    // along on every entry) in an effect that runs AFTER this component's. Called before that, the
    // entry would lack Next's state and going back to it would reload the page.
    if (location.search) {
      const t = setTimeout(() => {
        try { if (gen === this.gen) window.history.replaceState({ scanScreen: "home" }, "", location.pathname) } catch { /* ignore */ }
      }, 0)
      this.cleanup.push(() => clearTimeout(t))
    }

    const onPop = (e: PopStateEvent) => {
      const want = (e.state as { scanScreen?: Screen } | null)?.scanScreen ?? "home"
      this.pushed = want !== "home"
      this.go(want, false)
    }
    const onOnline = () => { this.set({ online: true }); void this.refreshBoot() }
    const onOffline = () => { this.netFailAt = Date.now(); this.set({ online: false }) }
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - this.bootAt > BOOT_REFRESH_MS / 2) void this.refreshBoot()
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (this.s.storeKind === "memory" && this.s.waitingMine > 0) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    const onFirstTouch = () => {
      unlockSound()
      // A tap is activity — unless the scanner has lain untouched long enough to ask who has it now.
      if (Date.now() - this.lastActivityAt > IDLE_ASK_MS) this.askStillYou()
      else this.lastActivityAt = Date.now()
    }
    // The app's Back button (scanner-app MainActivity) asks here first: step back within this screen's
    // own flow, and only otherwise let the app go back a page (or ask before closing).
    const onBack = (e: Event) => {
      if (this.s.stillYou) { e.preventDefault(); return } // answer "Still …?" first
      if (this.s.switching === "open") { this.cancelSwitch(); e.preventDefault(); return }
      if (this.s.screen === "move" && this.s.pending) { this.notThisOne(); e.preventDefault(); return }
      if (this.s.screen === "move" && this.s.pinned) { this.done(); e.preventDefault() }
    }
    window.addEventListener("vectis:back", onBack)
    window.addEventListener("popstate", onPop)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("beforeunload", onUnload)
    window.addEventListener("pointerdown", onFirstTouch, { capture: true })
    this.cleanup.push(() => {
      window.removeEventListener("vectis:back", onBack)
      window.removeEventListener("popstate", onPop)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("beforeunload", onUnload)
      window.removeEventListener("pointerdown", onFirstTouch, { capture: true })
    })

    try {
      this.channel = new BroadcastChannel("vectis-scan")
      this.channel.onmessage = () => { void this.reload() }
    } catch {
      this.channel = null
    }

    void (async () => {
      const store = await openScanStore()
      if (gen !== this.gen) return
      this.store = store
      this.set({ storeKind: store.kind })
      for (const w of this.whenOpen.splice(0)) w()
      try {
        const saved = await store.getKV<{ data: BootstrapResponse; savedAt: number }>(BOOT_KEY)
        if (saved?.data && gen === this.gen) this.applyBoot(saved.data, true, saved.savedAt)
      } catch { /* none saved */ }
      // The clock correction learnt last time, so a scanner that opens with no Wi-Fi still stamps
      // its scans with the Hub's time rather than a wrong clock's.
      try {
        const c = await store.getKV<{ offset: number; at: number }>(CLOCK_KEY)
        if (c && Number.isFinite(c.offset) && Number.isFinite(c.at) && Math.abs(Date.now() - c.at) < CLOCK_KEEP_MS && !this.clockLive && gen === this.gen) this.useOffset(c.offset)
      } catch { /* none saved */ }
      void this.askToKeep(gen)
      await this.reload()
      try { await store.prune() } catch { /* next time */ }
      if (gen !== this.gen) return
      this.engine = new SyncEngine({
        store,
        deviceId: deviceId(),
        userId: this.me.id,
        onAnswered: a => { void this.answered(a) },
        onState: st => this.onSyncState(st),
        onSending: ids => this.set({ sendingIds: ids.size ? new Set(ids) : NO_IDS }),
      })
      this.engine.start()
      this.set({ started: true })
      void this.refreshBoot()
      void startOffline(fromCache => {
        // Only while the Hub hasn't answered since this page opened.
        if (gen === this.gen && fromCache && !this.bootAt) {
          // Opened from the saved copy: nobody could check who is signed in (their card may have been
          // cancelled or run out overnight), so the first scan or tap asks "Still <name>?" first.
          this.lastActivityAt = 0
          this.set({ fromCache: true })
        }
      })
      void this.checkNative()
    })()

    // Keep the location list fresh, and keep testing a dead connection.
    this.timers.push(setInterval(() => {
      const offline = !this.s.online
      if (offline || Date.now() - this.bootAt > BOOT_REFRESH_MS) void this.refreshBoot()
    }, PROBE_MS))
  }

  stop() {
    this.gen++
    this.engine?.stop()
    this.engine = null
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    for (const c of this.cleanup) c()
    this.cleanup = []
    try { this.channel?.close() } catch { /* ignore */ }
    this.channel = null
  }

  // ── Storage ────────────────────────────────────────────────────────────────────────────────

  private async reload() {
    if (!this.store) return
    try {
      this.scans = await this.store.all()
    } catch {
      return
    }
    this.lastSeq = this.scans.reduce((m, s) => Math.max(m, s.seq), this.lastSeq)
    this.derive()
  }

  private derive() {
    const newestFirst = [...this.scans].reverse()
    const others = new Map<string, WaitingOther>()
    let mine = 0
    for (const s of this.scans) {
      if (s.status !== "waiting") continue
      if (s.scannedBy === this.me.id) mine++
      else {
        const o = others.get(s.scannedBy) ?? { userId: s.scannedBy, name: s.userName || "someone else", n: 0 }
        o.n++
        others.set(s.scannedBy, o)
      }
    }
    this.set({
      recent: newestFirst.filter(s => !isProblem(s) || isAlreadyThere(s)).slice(0, RECENT_SHOWN),
      problems: newestFirst.filter(s => isProblem(s) && !isAlreadyThere(s)),
      waitingMine: mine,
      waitingOthers: [...others.values()],
    })
  }

  private told() {
    try { this.channel?.postMessage({ type: "changed" }) } catch { /* ignore */ }
  }

  // ── The Hub: bootstrap, network state, clock ───────────────────────────────────────────────

  private netOk(serverTime?: string | null) {
    this.netOkAt = Date.now()
    if (serverTime) {
      const t = Date.parse(serverTime)
      if (Number.isFinite(t)) {
        const off = t - Date.now()
        this.clockLive = true
        this.useOffset(off)
        // Kept, so the correction still applies after a reload with no Wi-Fi.
        try { void this.store?.setKV(CLOCK_KEY, { offset: off, at: Date.now() }).catch(() => {}) } catch { /* this page only */ }
      }
    }
    if (!this.s.online) this.set({ online: true })
  }

  /** Correct this device's clock by `off` (the Hub's time minus the device's), and say so when it's far out. */
  private useOffset(off: number) {
    this.clockOffset = Math.abs(off) > CLOCK_SLACK_MS ? off : 0
    const warn = Math.abs(off) > CLOCK_WARN_MS ? off : null
    if (warn === null ? this.s.clockOffMs !== null : this.s.clockOffMs === null || Math.abs(warn - this.s.clockOffMs) > 60_000) this.set({ clockOffMs: warn })
  }

  /**
   * Ask the browser to keep this scanner's saved scans even when the device runs short of space
   * (best-effort storage can otherwise be cleared without a word). Only a plain browser can say no
   * in a way worth showing — inside the app the storage is the app's own.
   */
  private async askToKeep(gen: number) {
    try {
      const st = typeof navigator !== "undefined" ? navigator.storage : undefined
      if (!st || typeof st.persist !== "function") return
      let kept = typeof st.persisted === "function" ? await st.persisted() : false
      if (!kept) kept = await st.persist()
      if (gen === this.gen) this.set({ persisted: kept || isNativeApp() })
    } catch {
      // Not offered here.
    }
  }

  private netFail() {
    this.netFailAt = Date.now()
    if (this.s.online) this.set({ online: false })
  }

  /** Now, as the Hub would say it (the device clock, corrected when it's known to be out). */
  private nowIso() {
    return new Date(Date.now() + this.clockOffset).toISOString()
  }

  private applyBoot(data: BootstrapResponse, fromSaved: boolean, savedAt: number) {
    this.locations = new Map(data.locations.map(l => [cleanCode(l.code), l]))
    const patch: Partial<Snapshot> = {
      locationCount: data.locations.length,
      locationsAt: savedAt,
      hub: hubInfo(location.hostname, data.hub),
      notice: data.ready === false ? data.notice || SCANNER_NOT_SET_UP : null,
    }
    if (!fromSaved && data.user?.id && data.user.id !== this.me.id) patch.userMismatch = data.user.name || "someone else"
    if (!fromSaved && data.user?.id === this.me.id && this.s.userMismatch) patch.userMismatch = null
    this.set(patch)
  }

  private async refreshBoot() {
    const gen = this.gen
    try {
      const { data, fromCache } = await getBootstrap()
      if (gen !== this.gen) return
      if (fromCache) {
        this.netFail()
        return
      }
      this.bootAt = Date.now()
      this.netOk(data.serverTime)
      this.applyBoot(data, false, Date.now())
      // The Hub is answering again: the "opened from the saved copy" strip has said its piece.
      if (this.s.fromCache) this.set({ fromCache: false })
      try { await this.store?.setKV(BOOT_KEY, { data, savedAt: Date.now() }) } catch { /* kept in memory */ }
      // Back online: send anything waiting.
      if (this.s.waitingMine) this.engine?.kick()
    } catch (e) {
      if (gen !== this.gen) return
      if (e instanceof ScanApiError && e.kind === "offline") this.netFail()
      else {
        this.netOk()
        if (e instanceof ScanApiError && (e.kind === "signed-out" || e.kind === "no-access")) this.sessionEnded()
      }
    }
  }

  private onSyncState(st: SyncState) {
    // React to what CHANGED: a new answer from the Hub means online; a new "offline" problem means not.
    const prev = this.s.sync
    if (st.lastOkAt && st.lastOkAt !== prev.lastOkAt) this.netOk()
    else if (st.problem?.kind === "offline" && st.problem !== prev.problem) this.netFail()
    this.set({ sync: st })
    if ((st.problem?.kind === "signed-out" || st.problem?.kind === "no-access") && st.problem !== prev.problem) this.sessionEnded()
  }

  /**
   * The Hub no longer takes this person here (signed out, or no Goods In access any more). Stop taking
   * scans and reload /scan — the layout then shows "Scan your sign-in card" (or the no-access message).
   * The queue is untouched. Two cases stay on this page instead, with Switch user open:
   *   · the scans live only in this page's memory (storeKind "memory") — a reload would lose them;
   *   · it already reloaded for this a moment ago (the Hub and the saved copy disagreeing) — never a loop.
   */
  private sessionEnded() {
    // Already signing someone in (Switch user open): leave them to it — that reloads the page anyway.
    if (this.ended || this.s.switching === "open") return
    let lastAt = 0
    try { lastAt = Number(sessionStorage.getItem(ENDED_KEY)) || 0 } catch { /* this page only */ }
    const memoryOnly = this.s.storeKind === "memory" && this.s.waitingMine > 0
    if (memoryOnly || Math.abs(Date.now() - lastAt) < ENDED_AGAIN_MS) {
      // ("sending" = Switch user is sending first; it opens the sign-in itself when that fails.)
      if (this.s.switching === "idle") this.set({ switching: "open", stillYou: false, banner: null })
      return
    }
    this.ended = true
    try { sessionStorage.setItem(ENDED_KEY, String(Date.now())) } catch { /* this page only */ }
    this.set({ stillYou: false, switching: "idle", banner: this.banner("error", "Signed out", `${this.me.name} isn't signed in on this scanner any more. Opening the sign-in screen…`, null) })
    signal("error", this.s.sound)
    const gen = this.gen
    void (async () => {
      // The saved copy of the screen is this person's — and must not open again in place of the sign-in screen.
      try { await forgetOfflineCopy() } catch { /* nothing saved */ }
      if (gen === this.gen) window.location.replace("/scan")
    })()
  }

  private async checkNative() {
    const avail = await nativeScannerAvailable()
    this.set({ nativeAvailable: avail })
    if (avail !== null) await setTakeScansDirectly(this.s.takeDirect)
  }

  // ── Settings ───────────────────────────────────────────────────────────────────────────────

  toggleSound = () => {
    const on = !this.s.sound
    writePref(SOUND_KEY, on)
    this.set({ sound: on })
    if (on) signal("ok", true)
  }

  toggleDirect = async () => {
    const on = !this.s.takeDirect
    writePref(DIRECT_KEY, on)
    this.set({ takeDirect: on })
    await setTakeScansDirectly(on)
  }

  setScannerMode = (m: ScannerMode) => {
    if (m !== this.s.scannerMode) this.set({ scannerMode: m })
  }

  // ── Screens ────────────────────────────────────────────────────────────────────────────────

  /** Open a screen. `push` adds a history entry, so the app's back button comes back here. */
  go = (screen: Screen, push = true) => {
    if (screen === this.s.screen) return
    const leaving = this.s.screen
    const patch: Partial<Snapshot> = { screen }
    if (leaving === "move") {
      if (this.s.pinned) patch.banner = this.banner("info", `Finished putting things at ${this.s.pinned.code}`, `${this.s.pinnedCount} scanned there.`, null)
      else if (this.s.pending) patch.banner = this.banner("info", `${this.s.pending} put down — nothing moved`, "It was still waiting for a location.", this.s.pending)
      patch.pinned = null
      patch.pinnedCount = 0
      patch.pending = null
      patch.note = ""
    }
    if (leaving === "check") patch.check = null
    if (leaving === "find") patch.find = { status: "idle" }
    // A new screen starts with a clean banner (its buttons belonged to the last screen) — except
    // the line saying a location that stayed set has been let go.
    if (!("banner" in patch)) patch.banner = null
    this.actions.clear()
    this.set(patch)
    if (!push) return
    // One history entry for "away from Home", so the app's back button returns Home — and never
    // steps back out of /scan from a page this screen didn't push.
    try {
      if (screen === "home") {
        if (this.pushed) {
          this.pushed = false
          window.history.back()
        } else {
          window.history.replaceState({ scanScreen: "home" }, "", location.pathname)
        }
      } else if (!this.pushed) {
        window.history.pushState({ scanScreen: screen }, "", `${location.pathname}?s=${screen}`)
        this.pushed = true
      } else {
        window.history.replaceState({ scanScreen: screen }, "", `${location.pathname}?s=${screen}`)
      }
    } catch { /* no history here — the screen still changes */ }
  }

  home = () => this.go("home")

  // ── The banner ─────────────────────────────────────────────────────────────────────────────

  private banner(tone: BannerTone, title: string, detail: string | null, code: string | null, scanId: string | null = null, actions: [string, () => void | Promise<void>][] = []): Banner {
    this.actions.clear()
    const list = actions.map(([label, fn], i) => {
      const id = `a${Date.now()}-${i}`
      this.actions.set(id, fn)
      return { id, label }
    })
    return { tone, title, detail, code, scanId, actions: list }
  }

  /**
   * Show a banner, with its beep and buzz — the banner's own tone unless `sound` says otherwise
   * ("set" for a change of mode; the ok pip for a plain-white answer to a scan). An info banner is
   * silent unless given a sound; `quiet` silences any.
   */
  private say(tone: BannerTone, title: string, detail: string | null, code: string | null, opts: { scanId?: string | null; actions?: [string, () => void | Promise<void>][]; quiet?: boolean; sound?: Sound } = {}) {
    // Signed out: "Signed out — opening the sign-in screen" stays up until the page goes.
    if (this.ended) return
    this.set({ banner: this.banner(tone, title, detail, code, opts.scanId ?? null, opts.actions ?? []) })
    if (opts.quiet) return
    const sound: Sound | null = opts.sound ?? (tone === "info" ? null : tone)
    if (sound) signal(sound, this.s.sound)
  }

  bannerAction = (id: string) => {
    const fn = this.actions.get(id)
    if (!fn) return
    this.actions.delete(id)
    this.chain = this.chain.then(() => fn()).catch(e => this.oops(e))
  }

  clearBanner = () => this.set({ banner: null })

  private oops(e: unknown) {
    console.error("scanner:", e)
    this.say("error", "That scan couldn't be handled — scan it again", String((e as Error)?.message ?? e).slice(0, 160), null)
  }

  // ── Every scan comes in here ───────────────────────────────────────────────────────────────

  scan = (raw: string, source: ScanSource | "typed" = "scanner") => {
    // Signed out (sessionEnded): the sign-in screen is on its way; nothing more is taken as this person's.
    if (this.ended) return
    // A sign-in card is never an item or a location: it isn't queued, looked up or shown — its code
    // is a secret (card.ts). Signing in with it is Switch user's job.
    if (looksLikeCard(raw)) {
      this.chain = this.chain.then(() => this.cardScanned()).catch(e => this.oops(e))
      return
    }
    const code = cleanCode(raw)
    if (!code) return
    if (source !== "scanner") unlockSound()
    this.chain = this.chain.then(() => this.route(code)).catch(e => this.oops(e))
  }

  private cardScanned() {
    // Someone is at the scanner right now: so the Switch user button below works on the first tap
    // (a tap on a scanner idle for long enough would otherwise ask "Still …?" and swallow it).
    this.lastActivityAt = Date.now()
    this.say("warn", "That's a sign-in card — press Switch user to sign in as them.", "Nothing was moved. A sign-in card is never an item.", null, {
      actions: [["Switch user", () => this.switchUser()]],
    })
  }

  /** A scan that arrived while "Still …?" was open — said, not used. */
  ignored = (raw: string) => {
    if (looksLikeCard(raw)) {
      if (this.s.stillYou) {
        // The next person picked the scanner up and scanned their card: it isn't the last person, so
        // straight on to Switch user (it sends their waiting scans first), where the card is scanned
        // again to sign in. ("Still …?" covers the whole screen, so a banner here would go unseen.)
        this.notMe()
        return
      }
      this.say("warn", "That's a sign-in card", "Press Switch user, then scan the card again to sign in as them. Nothing was moved.", null)
      return
    }
    const code = cleanCode(raw)
    if (this.s.stillYou) {
      this.say("warn", "Scan not used", `${code} arrived before saying who's scanning. Press "Yes, it's me" or Switch user, then scan it again.`, code)
      return
    }
    this.say("warn", "Scan not used", `${code} arrived while signing in was open. Finish signing in (or Cancel), then scan it again.`, code)
  }

  /** The scanner has lain unused: ask who has it before anything more is recorded against this person. */
  private askStillYou() {
    if (this.s.stillYou || this.s.switching !== "idle" || !this.s.started) return
    this.set({ stillYou: true })
  }

  /** "Yes, it's me." */
  stillMe = () => {
    this.lastActivityAt = Date.now()
    this.set({ stillYou: false })
  }

  /** "Switch user" from "Still …?". */
  notMe = () => {
    this.lastActivityAt = Date.now()
    this.set({ stillYou: false })
    void this.switchUser()
  }

  private async route(code: string) {
    if (!this.store) {
      // A scan in the first moment, while the device's storage opens: wait for it rather than lose it.
      await new Promise<void>(resolve => {
        this.whenOpen.push(resolve)
        setTimeout(resolve, 5000)
      })
    }
    if (!this.store) {
      this.say("error", `${code} wasn't taken — the scanner is still starting`, "Scan it again in a moment. If it keeps happening, restart the scanner.", code)
      return
    }
    if (this.s.userMismatch) {
      this.say("error", "Reload the scanner before scanning", `This device is now signed in as ${this.s.userMismatch}, not ${this.me.name}. Reload so each scan is recorded against the right person.`, code)
      return
    }
    const now = Date.now()
    // A shared scanner that has lain unused: the next person may just start scanning, and every move
    // would be recorded against whoever was signed in. Ask first; this scan isn't used.
    if (this.s.stillYou || (this.s.started && now - this.lastActivityAt > IDLE_ASK_MS)) {
      this.askStillYou()
      if (this.s.stillYou) {
        this.ignored(code)
        return
      }
    }
    this.lastActivityAt = now
    // A location that stays set, with nothing scanned for a long while: let it go, so an item scanned
    // by someone coming back to it later doesn't go straight there.
    if (this.s.screen === "move" && this.s.pinned && this.lastScanAt && now - this.lastScanAt > PIN_IDLE_MS) {
      this.letGo = this.s.pinned.code
      this.set({ pinned: null, pinnedCount: 0 })
    }
    this.lastScanAt = now
    try {
      switch (this.s.screen) {
        case "home":
          this.go("move")
          return await this.moveScan(code)
        case "move":
          return await this.moveScan(code)
        case "find":
          return await this.findScan(code)
        case "check":
          return await this.checkScan(code)
      }
    } finally {
      this.letGo = null
    }
  }

  private placeFor(code: string): Place | null {
    const l = this.locations.get(code)
    return l ? { code: l.code, name: l.name, kind: l.kind, active: l.active } : null
  }

  /** What an unrecognised code is, asked of the Hub. null = couldn't ask (offline). */
  private async ask(code: string): Promise<LookupResponse | null> {
    try {
      const res = await lookup(code)
      this.netOk(res.serverTime)
      return res
    } catch (e) {
      if (e instanceof ScanApiError && e.kind === "offline") {
        this.netFail()
        return null
      }
      if (e instanceof ScanApiError && (e.kind === "signed-out" || e.kind === "no-access")) this.sessionEnded()
      throw e
    }
  }

  // ── Put away / Move ────────────────────────────────────────────────────────────────────────

  setNote = (note: string) => this.set({ note: note.slice(0, 500) })

  /** Done with the location that stays set (or the item waiting). */
  done = () => {
    const p = this.s.pinned
    this.actions.clear()
    this.set({
      pinned: null,
      pinnedCount: 0,
      pending: null,
      banner: p ? this.banner("ok", `Finished at ${p.code}`, `${this.s.pinnedCount} ${this.s.pinnedCount === 1 ? "item" : "items"} scanned there. Scan the next item, or a location to put another run somewhere.`, p.code) : null,
    })
  }

  notThisOne = () => {
    const was = this.s.pending
    this.set({ pending: null, banner: was ? this.banner("info", `${was} put down — nothing moved`, "Scan the next item, or a location.", was) : null })
  }

  private async moveScan(code: string) {
    let place = this.placeFor(code)
    if (!place && !looksLikeItem(code)) {
      let res: LookupResponse | null = null
      let askFailed: string | null = null
      if (this.s.online) {
        try { res = await this.ask(code) } catch (e) { askFailed = e instanceof ScanApiError ? e.message : String((e as Error)?.message ?? e) }
      }
      if (res) {
        const hit = res.hit
        if (!hit) {
          this.say("error", `Nothing found for ${code}`, this.s.pending ? `It isn't a location, tote, pallet or lot the Hub knows. ${this.s.pending} is still waiting — scan the location label again.` : "It isn't a tote, pallet, lot or location the Hub knows. Check the label and scan again.", code)
          return
        }
        // (Signed in with a card, the Hub leaves the customer's name out of these — lookup route.)
        if (hit.type === "receipt") {
          this.say("error", `${code} is a receipt, not a tote`, `${hit.customer ? `It's ${hit.customer}'s receipt. ` : ""}Scan the label on the tote or pallet itself.`, code)
          return
        }
        if (hit.type === "customer") {
          this.say("error", `${code} is a vendor number`, `${hit.name ? `That's ${hit.name}. ` : ""}Scan the label on the tote, pallet or lot instead.`, code)
          return
        }
        if (hit.type === "location") {
          place = { code: hit.code, name: hit.name, kind: hit.kind, active: true }
          // New since the list was saved — remember it, and fetch the list again quietly.
          this.locations.set(cleanCode(hit.code), { code: hit.code, name: hit.name, kind: hit.kind, active: true })
          void this.refreshBoot()
        }
      } else {
        // Offline (or the Hub couldn't say) and not on the saved list: don't guess — ask.
        const listNote = this.s.locationCount ? `It isn't on this scanner's list of ${this.s.locationCount.toLocaleString("en-GB")} locations` : "This scanner hasn't saved the Hub's list of locations yet"
        const why = askFailed ? `the Hub couldn't be asked just now (${askFailed})` : "with no Wi-Fi the Hub can't be asked"
        this.say("warn", `Is ${code} a location or an item?`, `${listNote}, and ${why}. The Hub checks it when the scan is sent.`, code, {
          actions: [
            [`${code} is a location`, () => this.useAsLocation({ code, name: null, kind: null, active: true })],
            [`${code} is a tote, pallet or lot`, () => this.useAsItem(code)],
          ],
        })
        return
      }
    }
    if (place) return this.useAsLocation(place)
    return this.useAsItem(code)
  }

  private async useAsLocation(place: Place) {
    this.letGo = null
    if (!place.active) {
      this.say("error", `${place.code} is switched off`, `Nothing can be put there. Scan a different location${this.s.pending ? ` for ${this.s.pending}` : ""}.`, place.code)
      return
    }
    const waiting = this.s.pending
    if (waiting) {
      this.set({ pending: null })
      await this.queueMove(waiting, place, "move")
      return
    }
    if (this.s.pinned?.code === place.code) {
      this.say("info", `Still putting things at ${place.code}`, "Scan the next item. Press Done when you've finished.", place.code, { sound: "ok" })
      return
    }
    const was = this.s.pinned
    this.lastScanAt = Date.now()
    this.set({ pinned: place, pinnedCount: 0 })
    // Its own sound: from here every item goes to this place, and the ear must not take it for a move.
    this.say("ok", `Location set: ${placeLine(place)}`, `${was ? `Changed from ${was.code}. ` : ""}Every item you scan now goes to ${place.code}, until you scan another location or press Done.`, place.code, { sound: "set" })
  }

  private async useAsItem(code: string) {
    const pinned = this.s.pinned
    if (pinned) {
      await this.queueMove(code, pinned, "move")
      return
    }
    const waiting = this.s.pending
    if (waiting === code) {
      this.say("info", `${code} is waiting`, "Now scan where it's going.", code, { sound: "ok" })
      return
    }
    this.set({ pending: code })
    const letGo = this.letGo
    this.letGo = null
    if (letGo) this.say("warn", `${letGo} let go — ${code} is waiting`, `Nothing was scanned for ${Math.round(PIN_IDLE_MS / 60_000)} minutes, so ${letGo} no longer stays set. Scan where ${code} is going.`, code)
    else if (waiting) this.say("warn", `Now moving ${code} instead`, `${waiting} wasn't moved. Scan where ${code} is going.`, code)
    else this.say("ok", `${code} — now scan where it's going`, "Or scan a location first to put a run of things there.", code)
  }

  /** Queue a move. Returns the scan, or null when it couldn't be saved on the device. */
  private async queueMove(item: string, place: Place, via: StoredScan["via"], noteOverride?: string): Promise<StoredScan | null> {
    // A double read of the same label, or the same item scanned again to the same place moments
    // later: one move, not two (the second would only be refused as "already there").
    const last = [...this.scans].reverse().find(s => s.item === item)
    const since = last ? Date.now() + this.clockOffset - Date.parse(last.scannedAt) : Infinity
    if (last && via === "move" && last.location === place.code && last.status !== "refused" && last.status !== "stale" && since >= 0 && since < REPEAT_MS) {
      this.say("warn", `${item} is already going to ${place.code}`, "That was the same scan twice — it's only moved once.", item, { scanId: last.id })
      return last
    }
    const note = (noteOverride ?? this.s.note).trim()
    const scan: StoredScan = {
      id: newId(),
      action: "move",
      item,
      location: place.code,
      scannedAt: this.nowIso(),
      scannedBy: this.me.id,
      note: note || null,
      seq: (this.lastSeq = Math.max(this.lastSeq + 1, Date.now())),
      userName: this.me.name,
      status: "waiting",
      message: null,
      doneAt: null,
      kind: place.kind,
      dismissed: false,
      via,
    }
    try {
      if (!this.store) throw new Error("not open")
      await this.store.put(scan)
    } catch {
      this.say("error", `${item} couldn't be saved on this scanner`, "Nothing was queued. Scan it again — if it keeps happening, restart the scanner.", item)
      return null
    }
    this.scans = [...this.scans, scan]
    if (via === "move" && this.s.pinned?.code === place.code) this.set({ pinnedCount: this.s.pinnedCount + 1 })
    // The note box is "a note for the next move" — used once.
    if (noteOverride === undefined && this.s.note) this.set({ note: "" })
    this.derive()
    this.told()
    const sending = this.s.online ? "Sending…" : "Saved on this scanner — it's sent when the Wi-Fi is back."
    this.say("ok", `${item} → ${placeLine(place)}`, `${sending}${this.s.pinned && via === "move" ? ` Next item goes to ${this.s.pinned.code} too.` : ""}`, item, { scanId: scan.id })
    this.engine?.kick()
    return scan
  }

  // ── The Hub's answers ──────────────────────────────────────────────────────────────────────

  private async answered(list: Answered[]) {
    await this.reload()
    this.told()
    let worst: Answered | null = null
    for (const a of list) {
      const { scan, result } = a
      this.updateCheckFor(scan)
      const onBanner = this.s.banner?.scanId === scan.id
      if (result.outcome === "applied" || result.outcome === "already") {
        if (onBanner) this.say("ok", result.outcome === "already" ? `${scan.item} — already done` : `Done: ${scan.item} → ${result.location ?? scan.location}`, result.message, scan.item, { scanId: scan.id, quiet: true })
        continue
      }
      if (isAlreadyThere(scan)) {
        if (onBanner) this.say("warn", `${scan.item} is already at ${scan.location}`, "Nothing needed moving.", scan.item, { scanId: scan.id })
        continue
      }
      worst = a
    }
    if (worst) {
      const { scan, result } = worst
      const others = this.s.problems.length - 1
      const earlier = this.s.banner?.scanId === scan.id ? "" : "Earlier scan: "
      const more = others > 0 ? ` ${others} more need a look below.` : ""
      if (result.outcome === "stale") {
        this.say("warn", `${earlier}${scan.item} not moved — someone moved it since`, `${result.message}${more}`, scan.item, {
          scanId: scan.id,
          actions: [
            [`Move it to ${scan.location} anyway`, () => this.moveAnyway(scan.id)],
            ["Leave it", () => this.dismiss(scan.id)],
          ],
        })
      } else {
        this.say("error", `${earlier}${scan.item} → ${scan.location} wasn't done`, `${result.message}${more}`, scan.item, {
          scanId: scan.id,
          actions: [["OK", () => this.dismiss(scan.id)]],
        })
      }
    }
  }

  dismiss = async (id: string) => {
    try { await this.store?.update(id, { dismissed: true }) } catch { /* shown again next time */ }
    await this.reload()
    this.told()
    if (this.s.banner?.scanId === id) this.set({ banner: null })
  }

  /** After a stale answer: put it there after all, as a new scan made now. */
  moveAnyway = async (id: string) => {
    const s = this.scans.find(x => x.id === id)
    if (!s) return
    const place = this.placeFor(cleanCode(s.location)) ?? { code: s.location, name: null, kind: s.kind, active: true }
    await this.dismiss(id)
    await this.queueMove(s.item, place, "anyway", s.note ?? "")
  }

  sendNow = async () => {
    unlockSound()
    if (!this.engine) return
    await this.engine.sendNow()
    void this.refreshBoot()
  }

  // ── Switch user ────────────────────────────────────────────────────────────────────────────

  /** Switch user — only once this person's waiting scans are sent (the Hub takes them only from them). */
  switchUser = async () => {
    // Not before the queue has been read: until then "nothing waiting" isn't known to be true.
    if (!this.s.started || this.s.switching !== "idle" || this.ended) return
    const n = this.s.waitingMine
    if (n > 0) {
      if (!this.s.online) {
        this.say("error", `Send the ${n} waiting ${n === 1 ? "scan" : "scans"} first`, `They were scanned by ${this.me.name}, so they must be sent before someone else signs in — and this scanner is offline. Get back on Wi-Fi, then press Send now.`, null)
        return
      }
      this.set({ switching: "sending", banner: this.banner("info", `Sending the ${n} waiting ${n === 1 ? "scan" : "scans"} first…`, "Someone else can sign in once they've gone.", null) })
      await this.engine?.sendNow()
      if (this.ended) return // signed out: the sign-in screen is on its way
      const left = this.s.waitingMine
      const k = this.s.sync.problem?.kind
      if (left > 0 && (k === "signed-out" || k === "no-access")) {
        // The Hub won't take them from this person now, so trying again can never work: the next
        // person signs in, and the scans wait on this scanner for their owner to sign in again.
        this.set({ switching: "open", banner: null })
        return
      }
      if (left > 0) {
        this.set({ switching: "idle" })
        this.say("error", `Send the ${left} waiting ${left === 1 ? "scan" : "scans"} first`, `They couldn't be sent: ${this.s.sync.problem?.message ?? "the Hub didn't take them"}. Try Send now again.`, null)
        return
      }
    }
    this.set({ switching: "open", banner: null })
  }

  cancelSwitch = () => this.set({ switching: "idle" })

  /** Signed out with scans waiting: sign in again here (as the same person, to send them). */
  signInAgain = () => this.set({ switching: "open", banner: null })

  /** Before signing out or in as someone else: the saved copy of the screen is this person's. */
  forgetForSwitch = () => forgetOfflineCopy()

  // ── Find ───────────────────────────────────────────────────────────────────────────────────

  /** What THIS scanner last did with an item — "where did I just put it?" works in a dead spot too. */
  private onThisScanner(code: string): string | null {
    const s = [...this.scans].reverse().find(x => cleanCode(x.item) === code)
    if (!s) return null
    const state = s.status === "waiting" ? "waiting to send"
      : s.status === "applied" || s.status === "already" ? "done"
      : isAlreadyThere(s) ? "it was already there"
      : `not done: ${s.message ?? (s.status === "stale" ? "someone moved it since" : "refused")}`
    return `On this scanner: ${s.item} → ${s.location} at ${clockTime(s.scannedAt)} (${state}).`
  }

  private async findScan(code: string) {
    if (!this.s.online) {
      const local = this.onThisScanner(code)
      this.set({ find: { status: "failed", code, message: `${local ? `${local} ` : ""}Where the Hub has it needs the Wi-Fi, and this scanner is offline. Moves still work — they're saved and sent later.`, offline: true } })
      this.say("warn", `Can't look up ${code} — offline`, local ?? "Find needs the Wi-Fi. Put away / Move still works offline.", code)
      return
    }
    this.set({ find: { status: "looking", code } })
    let res: LookupResponse | null
    try {
      res = await this.ask(code)
    } catch (e) {
      const message = e instanceof ScanApiError ? e.message : String((e as Error)?.message ?? e)
      this.set({ find: { status: "failed", code, message, offline: false } })
      this.say("error", `Couldn't look up ${code}`, message, code)
      return
    }
    if (!res) {
      const local = this.onThisScanner(code)
      this.set({ find: { status: "failed", code, message: `${local ? `${local} ` : ""}The Hub couldn't be reached — no Wi-Fi here? Try again in a moment.`, offline: true } })
      this.say("warn", `Can't look up ${code} — offline`, local ?? "Find needs the Wi-Fi.", code)
      return
    }
    this.set({ find: { status: "done", code, res } })
    if (!res.hit) this.say("error", `Nothing found for ${res.code}`, "It isn't a tote, pallet, lot, receipt or location the Hub knows.", res.code)
    else this.say("ok", findTitle(res), null, res.code, { quiet: false })
  }

  /** From Find: start a Move with this item waiting, or this location set. */
  moveFromFind = () => {
    const f = this.s.find
    if (f.status !== "done" || !f.res.hit) return
    const hit = f.res.hit
    this.go("move")
    if (hit.type === "location") {
      const place = this.placeFor(cleanCode(hit.code)) ?? { code: hit.code, name: hit.name, kind: hit.kind, active: true }
      this.chain = this.chain.then(() => this.useAsLocation(place)).catch(e => this.oops(e))
    } else if (hit.type === "container" || hit.type === "lot") {
      const code = hit.type === "container" ? hit.id : hit.barcode
      this.chain = this.chain.then(() => this.useAsItem(cleanCode(code))).catch(e => this.oops(e))
    }
  }

  /** From Find: check this location. */
  checkFromFind = () => {
    const f = this.s.find
    if (f.status !== "done" || f.res.hit?.type !== "location") return
    const hit = f.res.hit
    this.go("check")
    const place = this.placeFor(cleanCode(hit.code)) ?? { code: hit.code, name: hit.name, kind: hit.kind, active: true }
    this.chain = this.chain.then(() => this.startCheck(place, f.res)).catch(e => this.oops(e))
  }

  // ── Check a location ───────────────────────────────────────────────────────────────────────

  private async checkScan(code: string) {
    const check = this.s.check
    if (!check || check.status === "failed") {
      let place = this.placeFor(code)
      let res: LookupResponse | null = null
      if (!place && this.s.online && !looksLikeItem(code)) {
        try { res = await this.ask(code) } catch { res = null }
        if (res?.hit?.type === "location") place = { code: res.hit.code, name: res.hit.name, kind: res.hit.kind, active: true }
      }
      if (!place) {
        this.say("error", `Scan the location's label first`, `${code} isn't a location${this.s.online ? "" : " on this scanner's list"}. Scan the label on the shelf, bay or bench you're checking.`, code)
        return
      }
      return this.startCheck(place, res)
    }

    if (code === cleanCode(check.place.code)) {
      this.say("warn", `That's ${check.place.code}'s own label`, "Scan the totes, pallets and lots on it.", code)
      return
    }
    const other = this.placeFor(code)
    if (other) {
      this.say("warn", `${other.code} is another location`, `You're checking ${check.place.code}. Carry on scanning what's on it, or check ${other.code} instead.`, code, {
        actions: [[`Check ${other.code} instead`, () => this.startCheck(other, null)]],
      })
      return
    }
    const expected = check.expected.find(e => cleanCode(e.code) === code)
    if (expected) {
      if (check.found.includes(code)) {
        this.say("warn", `${code} was already ticked off`, `${this.checkCount()}`, code)
        return
      }
      this.patchCheck({ found: [...check.found, code] })
      this.say("ok", `${code} — recorded here ✓`, this.checkCount(), code)
      return
    }
    if (check.extras.some(x => x.code === code)) {
      this.say("warn", `${code} was already scanned`, "It's in the list below.", code)
      return
    }
    this.patchCheck({ extras: [{ code, state: "checking", what: null, where: null, scanId: null }, ...check.extras] })
    let res: LookupResponse | null = null
    let failed: string | null = null
    if (this.s.online) {
      try { res = await this.ask(code) } catch (e) { failed = e instanceof ScanApiError ? e.message : String((e as Error)?.message ?? e) }
    }
    if (!res) {
      this.setExtra(code, { state: "offline", what: failed ? `Couldn't look it up: ${failed}` : null, where: null })
      this.say("warn", `${code} isn't recorded here`, `${failed ? "The Hub couldn't be asked" : "Offline, so the Hub can't say where it should be"}. If it belongs here, press Move it here below.`, code)
      return
    }
    const hit = res.hit
    if (!hit) {
      this.setExtra(code, { state: "unknown", what: null, where: null })
      this.say("error", `Nothing found for ${code}`, "The Hub doesn't know this code. Check the label.", code)
      return
    }
    if (hit.type === "location") {
      this.setExtra(code, { state: "not-goods", what: `That's location ${hit.code}'s label.`, where: null })
      this.say("warn", `${hit.code} is another location`, `You're checking ${check.place.code}.`, code, {
        actions: [[`Check ${hit.code} instead`, () => this.startCheck({ code: hit.code, name: hit.name, kind: hit.kind, active: true }, res)]],
      })
      return
    }
    if (hit.type === "receipt" || hit.type === "customer") {
      this.setExtra(code, {
        state: "not-goods",
        what: hit.type === "receipt"
          ? `Receipt ${hit.id}${hit.customer ? ` (${hit.customer})` : ""} — not a tote, pallet or lot.`
          : `${hit.name ? `Vendor number for ${hit.name}` : "A customer's vendor number"} — not a tote, pallet or lot.`,
        where: null,
      })
      this.say("warn", `${code} isn't a tote, pallet or lot`, hit.type === "receipt" ? "That's a receipt number. Scan the tote or pallet's own label." : "That's a vendor number.", code)
      return
    }
    const what = hit.type === "container" ? `${hit.kind === "pallet" ? "Pallet" : "Tote"} · ${hit.customer}${hit.category ? ` · ${hit.category}` : ""}` : `Lot · ${hit.title}`
    const where = res.where?.code ?? hit.locationCode ?? null
    if (where && cleanCode(where) === cleanCode(check.place.code) && !(hit.type === "container" && hit.status === "returned")) {
      // Recorded here, just not in the list the page was given (a very full location).
      const now = this.s.check
      if (now) this.patchCheck({ found: [...now.found, code], extras: now.extras.filter(x => x.code !== code) })
      this.say("ok", `${code} — recorded here ✓`, this.checkCount(), code)
      return
    }
    const returned = hit.type === "container" && hit.status === "returned"
    this.setExtra(code, { state: "elsewhere", what: returned ? `${what} — marked as returned to the customer` : what, where })
    this.say("warn", where ? `${code} is recorded at ${where}` : `${code} isn't recorded anywhere yet`, "If it's really here, press Move it here below.", code)
  }

  /** "3 of 12 the Hub records here have been scanned." — `found` holds only things recorded HERE (never ones moved here by this check). */
  private checkCount() {
    const c = this.s.check
    if (!c) return ""
    const n = c.expected.length
    return `${c.found.length} of ${n}${c.truncated ? "+" : ""} the Hub records here ${c.found.length === 1 ? "has" : "have"} been scanned.`
  }

  private patchCheck(patch: Partial<CheckState>) {
    const c = this.s.check
    if (c) this.set({ check: { ...c, ...patch } })
  }

  private setExtra(code: string, patch: Partial<CheckExtra>) {
    const c = this.s.check
    if (!c) return
    this.set({ check: { ...c, extras: c.extras.map(x => (x.code === code ? { ...x, ...patch } : x)) } })
  }

  private async startCheck(place: Place, known: LookupResponse | null) {
    this.set({ check: { place, status: "loading", error: null, expected: [], truncated: false, found: [], extras: [] } })
    if (!this.s.online && !known) {
      this.patchCheck({ status: "failed", error: "Checking a location needs the Hub (to know what should be there), and this scanner is offline. Moves still work offline." })
      this.say("warn", `Can't check ${place.code} — offline`, "Checking needs the Wi-Fi.", place.code)
      return
    }
    let res = known
    if (!res) {
      try {
        res = await this.ask(place.code)
      } catch (e) {
        const message = e instanceof ScanApiError ? e.message : String((e as Error)?.message ?? e)
        this.patchCheck({ status: "failed", error: message })
        this.say("error", `Couldn't read what's at ${place.code}`, message, place.code)
        return
      }
    }
    if (!res) {
      this.patchCheck({ status: "failed", error: "The Hub couldn't be reached — no Wi-Fi here? Scan the location again in a moment." })
      this.say("warn", `Can't check ${place.code} — offline`, "Checking needs the Wi-Fi.", place.code)
      return
    }
    if (res.hit?.type !== "location") {
      this.patchCheck({ status: "failed", error: `${place.code} isn't a location the Hub knows.` })
      this.say("error", `${place.code} isn't a location`, "Scan the label on the shelf, bay or bench you're checking.", place.code)
      return
    }
    const expected = res.here ?? []
    this.patchCheck({ status: "ready", expected, truncated: !!res.hereTruncated })
    this.say("ok", `Checking ${placeLine(place)}`, expected.length ? `The Hub records ${expected.length}${res.hereTruncated ? "+" : ""} ${expected.length === 1 ? "thing" : "things"} here. Scan everything you can see on it.` : "The Hub records nothing here. Scan anything you can see on it.", place.code, { sound: "set" })
  }

  /** Check a location → "Move it here": queued like any move. */
  moveHere = (code: string) => {
    const c = this.s.check
    if (!c) return
    this.chain = this.chain.then(async () => {
      const scan = await this.queueMove(code, c.place, "check", `Found at ${c.place.code} in a location check`)
      if (scan) this.setExtra(code, { state: "queued", scanId: scan.id })
    }).catch(e => this.oops(e))
  }

  private updateCheckFor(scan: StoredScan) {
    const c = this.s.check
    if (!c) return
    const x = c.extras.find(e => e.scanId === scan.id)
    if (!x) return
    if (scan.status === "applied" || scan.status === "already" || isAlreadyThere(scan)) {
      // Counted as "moved here", not as found: it isn't one of the things the Hub recorded here.
      this.set({ check: { ...c, extras: c.extras.map(e => (e.scanId === scan.id ? { ...e, state: "moved" } : e)) } })
    } else if (scan.status === "refused" || scan.status === "stale") {
      this.set({ check: { ...c, extras: c.extras.map(e => (e.scanId === scan.id ? { ...e, state: "failed", what: scan.message } : e)) } })
    }
  }

  /** Start this check again — with what the Hub records there NOW (moves since, this check's own included). */
  restartCheck = () => {
    const c = this.s.check
    if (!c) return
    if (!this.s.online) {
      this.set({ check: { ...c, found: [], extras: [] } })
      this.say("warn", `Checking ${c.place.code} again`, "Offline, so this uses the list the Hub gave when the check began. Scan everything you can see on it.", c.place.code, { quiet: true })
      return
    }
    this.chain = this.chain.then(() => this.startCheck(c.place, null)).catch(e => this.oops(e))
  }

  /** Finish — saying what the check found in numbers, since the lists go when it closes. */
  finishCheck = () => {
    const c = this.s.check
    if (!c || c.status !== "ready") {
      this.set({ check: null, banner: null })
      return
    }
    const found = new Set(c.found)
    const missing = c.expected.filter(e => !found.has(cleanCode(e.code)))
    const moved = c.extras.filter(x => x.state === "moved" || x.state === "queued").length
    const left = c.extras.filter(x => x.state === "elsewhere" || x.state === "offline" || x.state === "failed").length
    const unknown = c.extras.filter(x => x.state === "unknown").length
    const named = missing.slice(0, 5).map(e => e.code || "(no barcode)").join(", ")
    const parts = [
      `${c.found.length} of ${c.expected.length}${c.truncated ? "+" : ""} found`,
      missing.length ? `${missing.length} not scanned (${named}${missing.length > 5 ? ", …" : ""})` : null,
      moved ? `${moved} moved here` : null,
      left ? `${left} here but recorded elsewhere, not moved` : null,
      unknown ? `${unknown} the Hub doesn't know` : null,
    ].filter(Boolean)
    this.set({ check: null })
    this.say(missing.length || left || unknown ? "warn" : "ok", `Finished ${c.place.code}`, parts.join(" · "), c.place.code, { quiet: true })
  }
}

/** The banner line for a Find answer. */
export function findTitle(res: LookupResponse): string {
  const h = res.hit
  if (!h) return `Nothing found for ${res.code}`
  switch (h.type) {
    case "container": return `${h.kind === "pallet" ? "Pallet" : "Tote"} ${h.id}${h.locationCode ? ` — at ${h.locationCode}` : " — not put anywhere yet"}`
    case "lot": return `Lot ${h.barcode}${h.locationCode ? ` — at ${h.locationCode}` : " — not shelved yet"}`
    case "location": return `Location ${h.code}`
    case "receipt": return `Receipt ${h.id}`
    case "customer": return `Vendor number ${h.vendorNo ?? res.code}`
  }
}
