import { postAcks, postSync, ScanApiError, type ApiErrorKind } from "./api"
import type { ScanStore } from "./store"
import {
  ACKED_BY_SOMEONE_ELSE, MAX_ACK_CODE, MAX_ACK_REASON, MAX_SCAN_ACKS, MAX_SCAN_EVENTS, SCANNED_BY_SOMEONE_ELSE,
  type AckRecord, type ScanAck, type ScanEvent, type ScanResult, type StoredScan,
} from "./types"

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
//
// After the scans, in the same turn (same lock), the failed-scan pop-up's ACKNOWLEDGEMENTS
// (AckRecord, status "waiting") go to POST /api/goods-in/scan/acks — the signed-in person's only,
// at most MAX_SCAN_ACKS a call. Kept apart from the scans on purpose: their own problem
// (`ackProblem`) and back-off, so an acknowledgement the Hub can't take yet (503 before Run
// Migrations) never holds up a scan or shows as one "not sent". An acknowledgement stays waiting
// until the Hub answers for it by id; one it refuses is kept as "refused" and not sent again —
// except one it says to keep (`keep: true`, ACKED_BY_SOMEONE_ELSE: made by someone other than whoever
// is signed in), which waits for that person, like a scan.
//
// ⚠ SCANS FIRST, ALWAYS: acknowledgements are sent only once every waiting scan has gone with no
// problem, and never while another send has been asked for (a scan queued meanwhile). A scan queued
// while an acknowledgements call is in flight LETS GO of that call (aborted — the Hub stores each
// once, so they are simply sent again after the scan), so a slow or hung acks call never keeps a
// scan waiting. Switch user's "send them first" sends scans only (sendNow({ scansOnly: true })).

export type SyncProblem = { kind: ApiErrorKind | "other-user"; message: string }

export type SyncState = {
  sending: boolean
  problem: SyncProblem | null
  /** When the Hub last answered a sync (ms). */
  lastOkAt: number | null
  /** When the next automatic try is due (ms), after a failure. */
  nextTryAt: number | null
  /** Why acknowledged failed scans aren't being sent just now (null when they are, or none wait). */
  ackProblem: SyncProblem | null
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
  /** The Hub has answered for some acknowledgements (the store has their new status). */
  onAcksAnswered?: () => void
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

/** The Hub's "keep it queued" answer to an acknowledgement (the contract's keep flag; the message as a fallback). */
const keepAck = (r: { keep?: unknown; error?: unknown }) =>
  r.keep === true || (typeof r.error === "string" && (r.error === ACKED_BY_SOMEONE_ELSE || /\b(acknowledged|scanned) by someone else\b/i.test(r.error)))

const toAck = (a: AckRecord): ScanAck => ({
  id: a.id,
  code: a.code ? a.code.slice(0, MAX_ACK_CODE) : null,
  problem: a.problem,
  reason: a.reason ? a.reason.slice(0, MAX_ACK_REASON) : null,
  scanId: a.scanId,
  scannedAt: a.scannedAt,
  shownAt: a.shownAt,
  // Always set once it is "waiting"; the fallback is only for a record written by a broken screen.
  acknowledgedAt: a.acknowledgedAt ?? a.shownAt,
  scannedBy: a.scannedBy,
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
  /** The acknowledgements' own back-off: none are sent before this time (ms). */
  private ackFailures = 0
  private ackNextAt = 0
  /** The acknowledgements call in flight, if any — let go of when another send is asked for (scans first). */
  private ackCall: AbortController | null = null
  /** This run sends scans only (Switch user's "send them first" never waits on acknowledgements). */
  private scansOnly = false
  private state: SyncState = { sending: false, problem: null, lastOkAt: null, nextTryAt: null, ackProblem: null }

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
    this.ackCall?.abort()
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

  /**
   * Send now — forgets the back-off. Resolves once this attempt is over. `scansOnly`: send the scans
   * and leave the acknowledgements for later (Switch user waits on scans, never on those).
   */
  async sendNow(opts: { scansOnly?: boolean } = {}): Promise<void> {
    if (this.stopped) return
    this.failures = 0
    if (opts.scansOnly) {
      this.scansOnly = true
    } else {
      this.ackFailures = 0
      this.ackNextAt = 0
    }
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
      // Scans first: an acknowledgements call in flight is let go of (sent again after — the Hub
      // stores each once), so a scan just queued isn't kept waiting behind it.
      this.ackCall?.abort()
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.withLock(async () => {
            await this.drain()
            // Scans first, always: the acknowledgements go only once every waiting scan has (no
            // problem left), and not when another send is already asked for — so they never stand
            // in front of one. "Sending…" is about scans, so it is over before they go.
            if (!this.state.problem && !this.again && !this.scansOnly && !this.stopped) {
              if (this.state.sending) this.set({ sending: false })
              await this.drainAcks()
            }
          })
        } while (this.again && !this.stopped && !this.blocked)
      } catch (e) {
        // Never expected (drain catches its own), but a broken store must not stop the timer.
        this.failures++
        this.set({ problem: { kind: "server", message: `The scans couldn't be read on this device (${String((e as Error)?.message ?? e).slice(0, 120)}).` } })
      } finally {
        this.running = null
        this.scansOnly = false
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
        // A refused or stale answer is marked for the failed-scan pop-up (flagged: false) in the same
        // write, so it reaches the pop-up even if the page closes before the screen hears of it.
        const mark = r.outcome === "refused" || r.outcome === "stale" ? { flagged: false } : {}
        const next = await this.o.store.update(r.id, { status: r.outcome, message: r.message, doneAt: now, kind: r.kind ?? null, ...mark })
        answered.push({ scan: next ?? { ...s, status: r.outcome, message: r.message, doneAt: now, kind: r.kind ?? null, ...mark }, result: r })
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

  /** Wait before sending acknowledgements again after a failure: 2 s, 4 s, 8 s… up to 30 s (the 30-second tick tries anyway). */
  private ackBackOff(problem: SyncProblem) {
    this.ackFailures++
    this.ackNextAt = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(this.ackFailures - 1, 6))
    this.set({ ackProblem: problem })
  }

  /** Send this person's acknowledged failed scans. Never throws — a fault here must not stop the scans. */
  private async drainAcks() {
    try {
      for (;;) {
        // Another send asked for (a scan queued): back to the scans first — this turn carries on after them.
        if (this.stopped || this.blocked || this.again || Date.now() < this.ackNextAt) return
        const waiting = (await this.o.store.allAcks()).filter(a => a.status === "waiting" && a.scannedBy === this.o.userId)
        if (!waiting.length) {
          this.ackFailures = 0
          if (this.state.ackProblem) this.set({ ackProblem: null })
          return
        }
        // No network: the scans' own problem already says so; these wait with them.
        if (typeof navigator !== "undefined" && navigator.onLine === false) return
        if (this.again) return
        const batch = waiting.slice(0, MAX_SCAN_ACKS)
        const call = typeof AbortController !== "undefined" ? new AbortController() : null
        this.ackCall = call
        let answer
        try {
          answer = await postAcks(this.o.deviceId, batch.map(toAck), call?.signal)
        } catch (e) {
          // Let go of for a scan (run()) or because the page is closing: no back-off, no problem shown —
          // they are sent again straight after the scans (the Hub stores each once).
          if (call?.signal.aborted && (this.again || this.stopped)) return
          const err = e instanceof ScanApiError ? e : new ScanApiError("server", String((e as Error)?.message ?? e))
          this.ackBackOff({ kind: err.kind, message: err.message })
          return
        } finally {
          if (this.ackCall === call) this.ackCall = null
        }
        const byId = new Map(batch.map(a => [a.id, a]))
        const now = new Date().toISOString()
        let answeredFor = 0
        let otherUser = false
        for (const r of answer.results) {
          if (!r || typeof r.id !== "string" || !byId.has(r.id)) continue
          byId.delete(r.id)
          if (r.ok === true) {
            await this.o.store.updateAck(r.id, { status: "sent", doneAt: now, message: null })
            answeredFor++
          } else if (keepAck(r)) {
            // Not stored by the Hub — it waits for that person to sign in, like their scans.
            otherUser = true
          } else {
            await this.o.store.updateAck(r.id, { status: "refused", doneAt: now, message: (typeof r.error === "string" && r.error ? r.error : "The Hub didn't take it.").slice(0, 300) })
            answeredFor++
          }
        }
        if (answeredFor) {
          try { this.o.onAcksAnswered?.() } catch { /* the screen's problem */ }
        }
        if (otherUser) {
          this.ackBackOff({ kind: "other-user", message: "Someone else is signed in on this scanner now — the acknowledgements wait for the person who made them." })
          return
        }
        if (answer.error || !answeredFor) {
          this.ackBackOff({ kind: "server", message: answer.error || "The Hub answered without saying what happened to the acknowledgements — they're kept and will be sent again." })
          return
        }
        this.ackFailures = 0
        if (this.state.ackProblem) this.set({ ackProblem: null })
        // More waiting (the batch was full) — carry on.
      }
    } catch (e) {
      // The device's store, most likely. Tried again on the next turn.
      this.ackBackOff({ kind: "server", message: `The acknowledgements couldn't be read on this device (${String((e as Error)?.message ?? e).slice(0, 120)}).` })
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
