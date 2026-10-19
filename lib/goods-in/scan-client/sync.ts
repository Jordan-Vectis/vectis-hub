import { postSync, ScanApiError, type ApiErrorKind } from "./api"
import type { ScanStore } from "./store"
import { MAX_SCAN_EVENTS, SCANNED_BY_SOMEONE_ELSE, type ScanEvent, type ScanResult, type StoredScan } from "./types"

// The handheld scanner — sending the queue. Browser only.
//
//   · IN ORDER: the oldest waiting scan first, at most MAX_SCAN_EVENTS a call, one call at a time
//     (and one tab at a time, with the Web Locks API where the browser has it).
//   · NOTHING IS DROPPED: a scan stays "waiting" until the Hub has answered for it by id. A lost
//     answer just means it is sent again — the Hub answers "already" for one it has applied.
//   · ONLY THE SIGNED-IN PERSON'S SCANS are sent (the Hub refuses anyone else's). Someone else's
//     scans wait until they sign in again on this device.
//   · WHEN: straight after a scan, when the network comes back, when the screen comes back to the
//     front, every 30 seconds while anything is waiting, and on Send now. After a failure it waits
//     2 s, 4 s, 8 s… up to 30 s before trying again.
//   · Not set up yet (Run Migrations), signed out, or the Hub down: the scans stay queued and the
//     status bar says why.

export type SyncProblem = { kind: ApiErrorKind | "other-user"; message: string }

export type SyncState = {
  sending: boolean
  problem: SyncProblem | null
  /** When the Hub last answered a sync (ms). */
  lastOkAt: number | null
  /** When the next automatic try is due (ms), after a failure. */
  nextTryAt: number | null
}

export type Answered = { scan: StoredScan; result: ScanResult }

type Options = {
  store: ScanStore
  deviceId: string
  userId: string
  onAnswered: (answered: Answered[]) => void
  onState: (state: SyncState) => void
  /** The ids in the call now in flight (empty when none). */
  onSending: (ids: ReadonlySet<string>) => void
}

const TICK_MS = 30_000
const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 30_000
/**
 * The Hub's refusal for a scan made by someone other than whoever is signed in — NOT recorded there,
 * so it can be sent again later. The exact message is shared through the contract; the pattern is a
 * fallback in case its wording is ever touched up on one side only.
 */
const isOtherUser = (message: string) => message === SCANNED_BY_SOMEONE_ELSE || /scanned by someone else/i.test(message)

const toEvent = (s: StoredScan): ScanEvent => ({
  id: s.id, action: s.action, item: s.item, location: s.location, scannedAt: s.scannedAt, scannedBy: s.scannedBy, note: s.note ?? null,
})

type LockManagerish = { request: (name: string, cb: () => Promise<void>) => Promise<void> }

export class SyncEngine {
  private o: Options
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private tick: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> | null = null
  private again = false
  private stopped = true
  private blocked = false
  private state: SyncState = { sending: false, problem: null, lastOkAt: null, nextTryAt: null }

  constructor(o: Options) {
    this.o = o
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    window.addEventListener("online", this.onOnline)
    document.addEventListener("visibilitychange", this.onVisible)
    this.tick = setInterval(() => { if (!this.running && !this.timer) this.kick() }, TICK_MS)
    this.kick()
  }

  stop() {
    this.stopped = true
    window.removeEventListener("online", this.onOnline)
    document.removeEventListener("visibilitychange", this.onVisible)
    if (this.tick) clearInterval(this.tick)
    if (this.timer) clearTimeout(this.timer)
    this.tick = null
    this.timer = null
  }

  getState() {
    return this.state
  }

  /** Try now (a new scan was queued, or the screen came back). */
  kick() {
    if (this.stopped || this.blocked) return
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    void this.run()
  }

  /** Send now — forgets the back-off. Resolves once this attempt is over. */
  async sendNow(): Promise<void> {
    if (this.stopped) return
    this.failures = 0
    this.blocked = false
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    await this.run()
  }

  private onOnline = () => { this.failures = 0; this.kick() }
  private onVisible = () => { if (document.visibilityState === "visible") this.kick() }

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch }
    try { this.o.onState(this.state) } catch { /* the screen's problem */ }
  }

  private run(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.withLock(() => this.drain())
        } while (this.again && !this.stopped && !this.blocked)
      } catch (e) {
        // Never expected (drain catches its own), but a broken store must not stop the timer.
        this.failures++
        this.set({ problem: { kind: "server", message: `The scans couldn't be read on this device (${String((e as Error)?.message ?? e).slice(0, 120)}).` } })
      } finally {
        this.running = null
        this.set({ sending: false })
        void this.schedule()
      }
    })()
    return this.running
  }

  private async withLock(fn: () => Promise<void>) {
    const locks = (typeof navigator !== "undefined" ? (navigator as unknown as { locks?: LockManagerish }).locks : undefined)
    if (locks && typeof locks.request === "function") {
      try {
        await locks.request("vectis-scan-sync", fn)
        return
      } catch (e) {
        // A refused lock (some WebViews) — fall back to running unlocked; the Hub is idempotent anyway.
        if (!(e instanceof DOMException)) throw e
      }
    }
    await fn()
  }

  private async waiting(): Promise<StoredScan[]> {
    return (await this.o.store.all()).filter(s => s.status === "waiting" && s.scannedBy === this.o.userId)
  }

  private async drain() {
    for (;;) {
      if (this.stopped) return
      const waiting = await this.waiting()
      if (!waiting.length) {
        this.failures = 0
        this.set({ problem: null, nextTryAt: null })
        return
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        this.failures++
        this.set({ problem: { kind: "offline", message: "No network — the scans are kept on this scanner and sent when it's back." } })
        return
      }
      const batch = waiting.slice(0, MAX_SCAN_EVENTS)
      const ids = new Set(batch.map(s => s.id))
      this.set({ sending: true })
      this.o.onSending(ids)
      let answer
      try {
        answer = await postSync(this.o.deviceId, batch.map(toEvent))
      } catch (e) {
        this.failures++
        const err = e instanceof ScanApiError ? e : new ScanApiError("server", String((e as Error)?.message ?? e))
        this.set({ problem: { kind: err.kind, message: err.message } })
        return
      } finally {
        this.o.onSending(new Set())
      }

      const byId = new Map(batch.map(s => [s.id, s]))
      const answered: Answered[] = []
      let otherUser = false
      const now = new Date().toISOString()
      for (const r of answer.results) {
        const s = byId.get(r.id)
        if (!s) continue
        byId.delete(r.id)
        if (r.outcome === "refused" && isOtherUser(r.message)) {
          // The Hub doesn't record this one — it stays waiting for the right person.
          otherUser = true
          continue
        }
        const next = await this.o.store.update(r.id, { status: r.outcome, message: r.message, doneAt: now, kind: r.kind ?? null })
        answered.push({ scan: next ?? { ...s, status: r.outcome, message: r.message, doneAt: now, kind: r.kind ?? null }, result: r })
      }
      // The Hub answered: whatever was wrong before (offline, not set up) isn't now.
      this.set({ lastOkAt: Date.now(), problem: null })
      if (answered.length) {
        try { this.o.onAnswered(answered) } catch { /* the screen's problem */ }
      }

      if (otherUser) {
        // Someone else is signed in on this device now (another tab, or the sign-in page). Stop until
        // the screen is reloaded as the right person, rather than asking the Hub again and again.
        this.blocked = true
        this.set({ problem: { kind: "other-user", message: "Someone else is signed in on this scanner now — reload the scanner to see who, then sign in as the person who made the waiting scans." } })
        return
      }
      if (answer.error) {
        this.failures++
        this.set({ problem: { kind: "server", message: answer.error } })
        return
      }
      if (!answered.length) {
        this.failures++
        this.set({ problem: { kind: "server", message: "The Hub answered without saying what happened to the scans — they're kept and will be sent again." } })
        return
      }
      this.failures = 0
      this.set({ problem: null, nextTryAt: null })
      // More waiting (the batch was full, or the Hub ran out of time part-way) — carry on.
    }
  }

  private async schedule() {
    if (this.stopped || this.blocked) return
    let n = 0
    try { n = (await this.waiting()).length } catch { n = 0 }
    if (this.stopped || this.blocked) return
    if (!n) { this.set({ nextTryAt: null }); return }
    if (!this.failures) { this.kick(); return }
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(this.failures - 1, 6))
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.run() }, delay)
    this.set({ nextTryAt: Date.now() + delay })
  }
}
