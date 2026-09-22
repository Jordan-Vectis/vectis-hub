"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties, ReactNode, RefObject } from "react"
import { acquireAppSocket, releaseAppSocket } from "@/lib/app-socket"
import { GROUP_LABELS } from "@/lib/status/types"
import type {
  Bucket, Fact, NotificationView, RunResponse, ServiceView, StatusGroup, StatusResponse, StatusState,
} from "@/lib/status/types"

// 🚦 Status Centre — the client half of /admin/status.
//
// One job (Jordan, 2026-09-10): "staff say something's broken — is it us or a
// supplier?" The banner at the top answers exactly that. Services in the "hub"
// group are inside the Hub; every other group is a supplier.
//
// ⚠ Honest lights (RULES.md → Status Centre). Grey is its own answer — "Couldn't
// tell" / "Not used here" — and is never counted as working. On 2026-09-09 every
// status page was green while ~1 in 4 saves failed; this page must not repeat that.
//
// ⚠ "Check everything now" runs ONE check per request, client-driven, with a count
// that moves and a Stop (RULES.md 7b — Jordan: "just says pulling, no idea of
// progress"). It ends with what happened in numbers, never "Done".
//
// ⚠ The Bidpath live-bid feed is checked FROM THIS COMPUTER and never stored: office
// browsers are what actually use it, and the website already refuses the Hub's
// server (202-with-nothing, 2026-09-09), so a server-side check would prove nothing.
//
// ⚠ A check can be SWITCHED OFF from its details panel (Jordan, 2026-09-22: "I don't use
// the it emails thing anymore"). The server stops running it; here it is left out of the
// answer at the top, of "Check everything now" and of the stale-lights note, and its tile
// stays — greyed, "Switched off", with who and when — so it can be switched back on.

type ViewState = ServiceView["state"]
type Tone = "good" | "warn" | "bad" | "neutral"

const POLL_MS = 60_000
/** The engine abandons a check at 25 s and the route allows 120 s; a minute is generous without hanging. */
const RUN_TIMEOUT_MS = 60_000
const FEED_KEY = "bidpath-feed"
const FEED_URL = "wss://www.vectis.co.uk/wss/{id}"
const FEED_WAIT_MS = 5_000
/** Only used when the viewer types a number here. The Auction Monitor's own keys are READ, never written —
 *  changing them would change what that tool opens on. */
const FEED_ID_KEY = "status_centre_feed_id"
const FEED_ID_RE = /^[A-Za-z0-9_-]{1,40}$/

// ── The words and colours (RULES.md 3: every colour has a key) ──────────────────

const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, rgba(148,163,184,0.8) 0 2px, transparent 2px 5px)",
}

const STATE_META: Record<ViewState, { word: string; meaning: string; seg: string; badge: string; tile: string }> = {
  ok: {
    word: "Working",
    meaning: "the Hub can do its job with it",
    seg: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-800 ring-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30",
    tile: "border-gray-200 dark:border-gray-700",
  },
  degraded: {
    word: "Problems",
    meaning: "working, but slow, failing some of the time, or out of date",
    seg: "bg-amber-400",
    badge: "bg-amber-100 text-amber-900 ring-amber-600/30 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30",
    tile: "border-amber-400 dark:border-amber-500/70",
  },
  down: {
    word: "Not working",
    meaning: "the Hub can't use it right now",
    seg: "bg-red-500",
    badge: "bg-red-100 text-red-800 ring-red-600/30 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/40",
    tile: "border-red-500 dark:border-red-500/80",
  },
  unknown: {
    word: "Couldn't tell",
    meaning: "the check itself couldn't run — not a fault, and not proof it works",
    seg: "bg-gray-400 dark:bg-gray-500",
    badge: "bg-gray-100 text-gray-700 ring-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300 dark:ring-gray-400/30",
    tile: "border-gray-300 dark:border-gray-600",
  },
  off: {
    word: "Not used here",
    meaning: "not expected to run on this environment",
    seg: "border border-gray-400/70 dark:border-gray-600",
    badge: "bg-gray-100 text-gray-500 ring-gray-400/30 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-600/50",
    tile: "border-gray-200 dark:border-gray-800",
  },
  pending: {
    word: "Not checked yet",
    meaning: "no result on this environment yet (in a strip: no check ran then)",
    seg: "border border-gray-300 dark:border-gray-600",
    badge: "bg-white text-gray-600 ring-gray-300 dark:bg-gray-900 dark:text-gray-400 dark:ring-gray-600",
    tile: "border-dashed border-gray-300 dark:border-gray-700",
  },
  disabled: {
    word: "Switched off",
    meaning: "an admin switched this check off here — not checked, not counted, never rings the bell",
    seg: "border-2 border-dotted border-gray-400 dark:border-gray-500",
    badge: "bg-gray-100 text-gray-500 ring-gray-400/30 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-600/50",
    tile: "border-dotted border-gray-300 dark:border-gray-700 opacity-80",
  },
}

const KEY_ORDER: ViewState[] = ["ok", "degraded", "down", "unknown", "off", "pending", "disabled"]

const TONE_BOX: Record<Tone, string> = {
  good: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-50",
  warn: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-600/60 dark:bg-amber-950/40 dark:text-amber-50",
  bad: "border-red-300 bg-red-50 text-red-950 dark:border-red-700/70 dark:bg-red-950/40 dark:text-red-50",
  neutral: "border-gray-300 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100",
}

const FACT_TONE: Record<NonNullable<Fact["tone"]>, { cls: string; mark: string }> = {
  good: { cls: "text-emerald-700 dark:text-emerald-400", mark: "✓ " },
  warn: { cls: "text-amber-700 dark:text-amber-400", mark: "⚠ " },
  bad: { cls: "text-red-700 dark:text-red-400", mark: "✕ " },
}

const LEVEL_STRIPE: Record<NotificationView["level"], string> = {
  error: "bg-red-500",
  warning: "bg-amber-400",
  success: "bg-emerald-500",
  info: "bg-sky-500",
}

// ── Times, always Europe/London ────────────────────────────────────────────────

const F_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })
const F_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" })
const F_DAYKEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })

function when(ms: number, nowMs: number): string {
  const t = F_TIME.format(ms)
  const day = F_DAYKEY.format(ms)
  if (day === F_DAYKEY.format(nowMs)) return `${t} today`
  if (day === F_DAYKEY.format(nowMs - 86_400_000)) return `${t} yesterday`
  return `${F_DAY.format(ms)}, ${t}`
}

function dur(ms: number): string {
  const min = Math.round(Math.max(0, ms) / 60_000)
  if (min < 1) return "under a minute"
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`
  return `${Math.round(h / 24)} days`
}

function ago(ms: number, nowMs: number): string {
  return nowMs - ms < 45_000 ? "just now" : `${dur(nowMs - ms)} ago`
}

const secs = (from: number, nowMs: number) => Math.max(0, Math.round((nowMs - from) / 1000))
const pct = (v: number | null) => (v == null ? "—" : `${Number.isInteger(v) ? v : v.toFixed(1)}%`)
const clip = (s: string) => s.trim().replace(/[.!]+$/, "")
const isBad = (s: ViewState | null | undefined) => s === "down" || s === "degraded"
/** Whose side a problem is on: everything in the "hub" group, plus a supplier whose check says the fault is the
 *  Hub's own — a setting, key, sign-in or job (2026-09-10: tools set to a model Google had retired were blamed on
 *  "a supplier" when the fix was one click in Admin → AI Models). */
const isOurs = (s: ServiceView) => s.group === "hub" || s.cause === "hub"
const sideLabel = (s: ServiceView) =>
  s.group === "hub" ? "inside the Hub" : s.cause === "hub" && isBad(s.state) ? "a supplier — but this fault is on the Hub's side" : "a supplier"

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

const STATES: readonly StatusState[] = ["ok", "degraded", "down", "unknown", "off"]

/** ⚠ A state word this page doesn't know (a check returning something off-contract) would crash the render —
 *  STATE_META[x] is undefined — and take the whole page down on exactly the day it's needed. Grey instead. */
function safeState(s: unknown): StatusState {
  return STATES.includes(s as StatusState) ? (s as StatusState) : "unknown"
}

function safeView(v: StatusResponse): StatusResponse {
  const bucket = (b: Bucket): Bucket => ({ at: b.at, state: b.state == null ? null : safeState(b.state) })
  return {
    ...v,
    alerts: Array.isArray(v.alerts) ? v.alerts : [],
    services: v.services.map(s => ({
      ...s,
      state: s.state === "pending" || s.state === "disabled" ? s.state : safeState(s.state),
      cause: s.cause === "hub" ? "hub" : "supplier",
      facts: Array.isArray(s.facts) ? s.facts : [],
      hours: Array.isArray(s.hours) ? s.hours.map(bucket) : [],
      days: Array.isArray(s.days) ? s.days.map(bucket) : [],
      uptime: s.uptime ?? { h24: null, d7: null, d30: null },
    })),
  }
}

function keyFromHash(): string | null {
  try {
    const h = decodeURIComponent(window.location.hash.slice(1))
    return h || null
  } catch {
    return null
  }
}

// ── Running one check on the Hub's server ──────────────────────────────────────

type RunOutcome =
  | { kind: "result"; state: StatusState; summary: string }
  | { kind: "busy" }
  | { kind: "failed"; message: string }
  | { kind: "stopped" }

async function postRun(key: string, ctl: AbortController): Promise<RunOutcome> {
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, RUN_TIMEOUT_MS)
  try {
    const res = await fetch("/api/status/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: key }),
      signal: ctl.signal,
      cache: "no-store",
    })
    const j = (await res.json().catch(() => null)) as (Partial<RunResponse> & { error?: string }) | null
    if (res.status === 401) return { kind: "failed", message: "your sign-in has run out — reload the page to sign in again." }
    if (!res.ok) {
      return {
        kind: "failed",
        message: j?.error ? `the Hub's server answered with an error: ${String(j.error).slice(0, 200)}` : `the Hub's server answered with an error (${res.status}).`,
      }
    }
    // ⚠ Only a proper answer with no entry for this check means "already running". A body that isn't the
    // run route's JSON at all (a proxy page, a half-deployed server) is a failure, never "busy".
    if (!j || !Array.isArray(j.results)) return { kind: "failed", message: "the Hub's server sent back something that wasn't a result." }
    const r = j.results.find(x => x && x.key === key)
    // ⚠ No result = the engine skipped it because the automatic loop is running that
    // same check right now (it never starts one twice). Not a success — say so.
    return r ? { kind: "result", state: safeState(r.state), summary: String(r.summary ?? "") } : { kind: "busy" }
  } catch {
    if (timedOut) return { kind: "failed", message: `no answer after ${RUN_TIMEOUT_MS / 1000} seconds.` }
    if (ctl.signal.aborted) return { kind: "stopped" }
    return { kind: "failed", message: "the Hub's server didn't answer." }
  } finally {
    clearTimeout(timer)
  }
}

// ── The live-bid feed, from this computer ──────────────────────────────────────

type FeedSource = "page" | "monitor" | "timed"
type FeedInfo = { ready: boolean; id: string | null; source: FeedSource | null }
type FeedResult = { state: "ok" | "down" | "unknown"; summary: string; ms: number | null; at: number; id: string }

const FEED_SOURCE_LABEL: Record<FeedSource, string> = {
  page: "typed on this page",
  monitor: "saved by the Auction Monitor (live sale tab)",
  timed: "saved by the Auction Monitor (timed sale tab)",
}

function readSavedFeedId(): { id: string; source: FeedSource } | null {
  try {
    const pick = (k: string) => {
      const v = (localStorage.getItem(k) ?? "").trim()
      return FEED_ID_RE.test(v) ? v : null
    }
    const own = pick(FEED_ID_KEY)
    if (own) return { id: own, source: "page" }
    const live = pick("auction_monitor_id")
    if (live) return { id: live, source: "monitor" }
    const timed = pick("auction_monitor_timed_id")
    if (timed) return { id: timed, source: "timed" }
  } catch { /* storage blocked — same as nothing saved */ }
  return null
}

/** Opens the feed, waits up to 5 s for it to answer, closes it with 1000 and sends NOTHING.
 *  ⚠ Never wait for a message: outside a live sale the feed is silent, and that is normal. */
function probeFeed(id: string): { promise: Promise<FeedResult | null>; cancel: () => void } {
  let ws: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let done = false
  let settle: (r: FeedResult | null) => void = () => {}
  const promise = new Promise<FeedResult | null>(resolve => {
    settle = r => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(r)
    }
  })
  const shut = () => {
    const w = ws
    ws = null
    if (!w) return
    w.onopen = null; w.onerror = null; w.onclose = null; w.onmessage = null
    try { w.close(1000) } catch { /* already closing */ }
  }
  const finish = (state: FeedResult["state"], summary: string, ms: number | null = null) => {
    settle({ state, summary, ms, at: Date.now(), id })
    shut()
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    finish("unknown", "This computer is offline, so the feed couldn't be checked from here.")
    return { promise, cancel: () => {} }
  }
  const started = performance.now()
  try {
    ws = new WebSocket(FEED_URL.replace("{id}", encodeURIComponent(id)))
  } catch {
    finish("unknown", "This browser wouldn't open a connection to the feed, so it couldn't be checked from here.")
    return { promise, cancel: () => {} }
  }
  timer = setTimeout(() => finish("down", `The live-bid feed didn't answer this computer within ${FEED_WAIT_MS / 1000} seconds.`), FEED_WAIT_MS)
  ws.onopen = () => {
    const ms = Math.round(performance.now() - started)
    finish("ok", `The live-bid feed accepted a connection from this computer in ${ms.toLocaleString("en-GB")} ms.`, ms)
  }
  ws.onerror = () => finish("down", "The live-bid feed refused the connection from this computer.")
  ws.onclose = ev => finish("down", `The live-bid feed closed the connection before it opened (code ${ev.code}).`)
  return { promise, cancel: () => { settle(null); shut() } }
}

// ── Check everything: progress and the closing report ──────────────────────────

type StepOutcome = StatusState | "busy" | "failed" | "stopped"
type RunStep = { key: string; name: string; outcome?: StepOutcome; message?: string }
type RunProgress = { steps: RunStep[]; index: number; stepStartedAt: number; stopping: boolean }
type RunReport = { tone: Tone; headline: string; counts: { label: string; state: ViewState; n: number }[]; notes: string[] }
type SingleResult = { key: string; outcome: RunOutcome }

function stepLook(o: StepOutcome | undefined): ViewState {
  if (o === "ok" || o === "degraded" || o === "down" || o === "unknown" || o === "off") return o
  if (o === "failed") return "unknown"
  return "pending"
}

function buildReport(steps: RunStep[], stopped: boolean, noFeedId: boolean): RunReport {
  const total = steps.length
  const n = (o: StepOutcome) => steps.filter(s => s.outcome === o).length
  const finished = steps.filter(s => s.outcome && s.outcome !== "stopped").length
  const counts = ([
    { label: "working", state: "ok", n: n("ok") },
    { label: "with problems", state: "degraded", n: n("degraded") },
    { label: "not working", state: "down", n: n("down") },
    { label: "couldn't tell", state: "unknown", n: n("unknown") },
    { label: "not used here", state: "off", n: n("off") },
    { label: "no result came back", state: "unknown", n: n("failed") },
    { label: "already being checked", state: "pending", n: n("busy") },
  ] as RunReport["counts"]).filter(c => c.n > 0)

  const notes: string[] = []
  const busy = steps.filter(s => s.outcome === "busy")
  if (busy.length) {
    notes.push(`${joinNames(busy.map(s => s.name))} ${busy.length === 1 ? "was" : "were"} already being checked by the automatic checks, so ${busy.length === 1 ? "it wasn't" : "they weren't"} run twice — the light will update in a moment.`)
  }
  // ⚠ "No result", not "couldn't be started": a check that timed out on this page may well have started.
  for (const f of steps.filter(s => s.outcome === "failed")) notes.push(`${f.name}: no result came back — ${f.message ?? "no reason given."}`)
  const cut = steps.find(s => s.outcome === "stopped")
  if (cut) notes.push(`${cut.name} was stopped part-way. The Hub may still finish it, and its light will update if it does.`)
  if (stopped && finished < total) {
    notes.push(`The other ${total - finished - (cut ? 1 : 0)} weren't checked this time — their lights still show the last automatic check.`)
  }
  if (noFeedId) notes.push("The live-bid feed wasn't checked — no auction number is saved on this computer (open its tile to enter one).")

  const headline = stopped
    ? (finished === 0 ? "Stopped before any check finished." : `Stopped after ${finished} of ${total} checks.`)
    : `Checked ${finished} of ${total}.`
  const tone: Tone = n("down") || n("failed") ? "bad" : n("degraded") ? "warn" : finished > 0 && finished === n("ok") + n("off") ? "good" : "neutral"
  return { tone, headline, counts, notes }
}

// ── The answer: is it us or a supplier? ────────────────────────────────────────

type Answer = { tone: Tone; headline: string; problems: ServiceView[]; notes: string[] }

function answerFor(all: ServiceView[], feed: FeedResult | null): Answer {
  // Switched-off checks are not part of the answer at all — that is what switching one off is for.
  const disabled = all.filter(s => s.state === "disabled")
  const services = all.filter(s => s.state !== "disabled")
  const disabledNote = disabled.length
    ? `${disabled.length} switched off, so not counted: ${joinNames(disabled.map(s => s.name))} — open the tile to switch it back on.`
    : null
  if (!all.length) return { tone: "neutral", headline: "⚪ No services are set up to be checked yet", problems: [], notes: [] }
  if (!services.length) return { tone: "neutral", headline: "⚪ Every check is switched off", problems: [], notes: disabledNote ? [disabledNote] : [] }

  const downFirst = (l: ServiceView[]) => [...l].sort((a, b) => (a.state === "down" ? 0 : 1) - (b.state === "down" ? 0 : 1))
  const describe = (l: ServiceView[]) => (l.length === 1 ? `${l[0].name} — ${clip(l[0].summary)}` : joinNames(l.map(s => s.name)))
  const inHub = services.filter(s => s.group === "hub")
  const hubBad = downFirst(services.filter(s => isOurs(s) && isBad(s.state)))
  const supBad = downFirst(services.filter(s => !isOurs(s) && isBad(s.state)))
  const hubUnsure = inHub.filter(s => s.state === "unknown" || s.state === "pending")
  const unknown = services.filter(s => s.state === "unknown")
  const pending = services.filter(s => s.state === "pending")
  const off = services.filter(s => s.state === "off")
  const notes: string[] = []
  let tone: Tone
  let headline: string
  let problems: ServiceView[] = []
  let nothingChecked = false

  if (hubBad.length) {
    const down = hubBad.some(s => s.state === "down")
    tone = down ? "bad" : "warn"
    headline = `${down ? "🔴" : "🟠"} Problem inside the Hub: ${describe(hubBad)}`
    problems = [...hubBad, ...supBad]
    if (supBad.length) notes.push(`A supplier is having problems too: ${joinNames(supBad.map(s => s.name))}.`)
  } else if (supBad.length) {
    const down = supBad.some(s => s.state === "down")
    tone = down ? "bad" : "warn"
    headline = `${down ? "🔴 A supplier isn't working" : "🟠 A supplier is having problems"}: ${describe(supBad)}`
    problems = supBad
    notes.push(hubUnsure.length
      ? `The Hub's own ${joinNames(hubUnsure.map(s => s.name))} couldn't be confirmed, so a problem inside the Hub can't be ruled out yet.`
      : "Everything inside the Hub that could be checked is working, and the Hub's own settings and keys for them look right, so this is on the supplier's side.")
  } else if (pending.length + off.length === services.length) {
    nothingChecked = true
    tone = "neutral"
    headline = "⚪ Nothing has been checked yet on this environment"
    notes.push("Press Check everything now for a live answer.")
  } else if (hubUnsure.length) {
    tone = "neutral"
    headline = `⚪ Couldn't confirm the Hub itself: ${joinNames(hubUnsure.map(s => s.name))} couldn't be checked`
    problems = hubUnsure
  } else if (unknown.length || pending.length) {
    // ⚠ Not "everything is working": some couldn't be checked, and grey is never counted as green.
    tone = "good"
    headline = "🟢 Everything the Hub could check is working"
  } else {
    tone = "good"
    headline = "🟢 Everything the Hub relies on is working"
  }

  const unk = unknown.filter(s => !problems.includes(s))
  const pen = pending.filter(s => !problems.includes(s))
  if (unk.length) notes.push(`${unk.length} couldn't be checked, so ${unk.length === 1 ? "it's" : "they're"} grey — not a fault, and not proof of working: ${joinNames(unk.map(s => s.name))}.`)
  if (pen.length && !nothingChecked) notes.push(`${pen.length} not checked yet on this environment: ${joinNames(pen.map(s => s.name))}.`)
  if (off.length) notes.push(`${off.length} not used on this environment: ${joinNames(off.map(s => s.name))}.`)
  if (disabledNote) notes.push(disabledNote)
  if (feed?.state === "down") notes.push("The Bidpath live-bid feed didn't connect from this computer — see its tile under Other suppliers.")
  return { tone, headline, problems, notes }
}

function envNote(env: string): string | null {
  if (env === "production") return null
  const label = env ? env.charAt(0).toUpperCase() + env.slice(1) : "Not production"
  return `${label} — this is not the live Hub. The automatic checks run on production only, so the lights here are from the last time someone pressed Check everything now. Checks that rely on background jobs or live data are switched off here on purpose, so some lights are grey ("Not used here").`
}

/** ⚠ "Nothing happened" must not look like success (RULES.md 7): if the automatic checks have stopped,
 *  every light is frozen at its last colour — green included. */
function staleNote(services: ServiceView[], env: string, nowMs: number): string | null {
  // ⚠ Only production has an automatic loop (server.js) — elsewhere old lights are expected, and envNote says so.
  if (env !== "production") return null
  const times = services.filter(s => s.state !== "disabled").map(s => Date.parse(s.lastCheckedAt ?? "")).filter(t => Number.isFinite(t))
  if (!times.length || !nowMs) return null
  const age = nowMs - Math.max(...times)
  if (age <= 20 * 60_000) return null
  return `The automatic checks haven't run for ${dur(age)}, so these lights may be out of date. Press Check everything now for a fresh answer — if they still don't run by themselves after that, the Hub's checking loop has stopped.`
}

// ── Small pieces ───────────────────────────────────────────────────────────────

function Swatch({ state, className = "w-3 h-3 rounded-full" }: { state: ViewState | null; className?: string }) {
  const s = state ?? "pending"
  return <span aria-hidden className={`inline-block shrink-0 ${className} ${STATE_META[s].seg}`} style={s === "off" ? HATCH : undefined} />
}

function Badge({ state, label, large }: { state: ViewState; label?: string; large?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset font-semibold whitespace-nowrap ${STATE_META[state].badge} ${large ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"}`}>
      <Swatch state={state} className={large ? "w-3 h-3 rounded-full" : "w-2.5 h-2.5 rounded-full"} />
      {label ?? STATE_META[state].word}
    </span>
  )
}

function Note({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <div className={`rounded-xl border px-4 py-3 text-sm ${TONE_BOX[tone]}`}>{children}</div>
}

function Strip({ buckets, kind }: { buckets: Bucket[]; kind: "hour" | "day" }) {
  const label = (b: Bucket) => {
    if (kind === "day") return F_DAY.format(new Date(`${b.at}T12:00:00Z`))
    const ms = Date.parse(b.at)
    return `${F_TIME.format(ms)}–${F_TIME.format(ms + 3_600_000)}`
  }
  const first = buckets[0]
  return (
    <div>
      <div className="flex gap-[2px]" role="img"
        aria-label={`${kind === "hour" ? "Last 24 hours" : "Last 30 days"}, worst result in each ${kind}`}>
        {buckets.map(b => (
          <span key={b.at} title={`${label(b)}: ${b.state ? STATE_META[b.state].word : "no check ran"}`}
            className={`flex-1 min-w-0 rounded-[2px] ${kind === "hour" ? "h-3" : "h-6"} ${STATE_META[b.state ?? "pending"].seg}`}
            style={b.state === "off" ? HATCH : undefined} />
        ))}
      </div>
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
        <span>{kind === "hour" ? "24 h ago" : first ? label(first) : ""}</span>
        <span>{kind === "hour" ? "now" : "today"}</span>
      </div>
    </div>
  )
}

function Uptime({ u }: { u: ServiceView["uptime"] }) {
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      Up: <span className="text-gray-700 dark:text-gray-300">24 h {pct(u.h24)}</span>
      {" · "}<span className="text-gray-700 dark:text-gray-300">7 days {pct(u.d7)}</span>
      {" · "}<span className="text-gray-700 dark:text-gray-300">30 days {pct(u.d30)}</span>
    </p>
  )
}

function StatusKey() {
  return (
    <section aria-label="Key" className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="font-semibold text-gray-800 dark:text-gray-100">Key</span>
        {KEY_ORDER.map(s => (
          <span key={s} className="inline-flex items-center gap-2">
            <Swatch state={s} className="w-3.5 h-3.5 rounded-sm" />
            <span className="font-semibold text-gray-800 dark:text-gray-100">{STATE_META[s].word}</span>
            <span className="text-gray-500 dark:text-gray-400">— {STATE_META[s].meaning}</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        <b className="text-gray-700 dark:text-gray-300">Strips:</b> one block per hour on a tile, one per day in its details, coloured by the
        <b className="text-gray-700 dark:text-gray-300"> worst</b> result in it. <b className="text-gray-700 dark:text-gray-300">Up</b> is the share
        of checks that weren&apos;t &ldquo;Not working&rdquo; — grey results don&apos;t count either way, and &ldquo;—&rdquo; means no history yet.
        The <b className="text-gray-700 dark:text-gray-300">🔔 bell</b> in the top bar rings after 2 bad checks in a row, and again when the service
        recovers; grey never rings it.
      </p>
    </section>
  )
}

const BTN_PRIMARY = "min-h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
const BTN_SECONDARY = "min-h-11 px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium disabled:opacity-50 transition-colors"
const H3 = "text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5"

// ── Tiles ──────────────────────────────────────────────────────────────────────

function ServiceTile({ s, nowMs, checking, onOpen }: { s: ServiceView; nowMs: number; checking: boolean; onOpen: () => void }) {
  const since = Date.parse(s.since ?? "")
  const checked = Date.parse(s.lastCheckedAt ?? "")
  return (
    <button type="button" onClick={onOpen}
      className={`text-left w-full rounded-xl border-2 ${STATE_META[s.state].tile} bg-white dark:bg-gray-900 p-4 hover:border-slate-400 dark:hover:border-gray-400 transition-colors flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 leading-snug">{s.name}</h3>
        <Badge state={s.state} />
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">{s.summary}</p>
      {s.group !== "hub" && s.cause === "hub" && isBad(s.state) && (
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">The fix is on the Hub&apos;s side — a setting, key or sign-in, not the supplier.</p>
      )}
      {checking &&<p className="text-xs font-semibold text-sky-700 dark:text-sky-300 animate-pulse">Checking now…</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {s.state === "disabled" ? (
          <>Switched off{s.disabledBy ? ` by ${s.disabledBy}` : ""}{Number.isFinite(since) ? ` on ${when(since, nowMs)}` : ""} · open to switch on</>
        ) : (
          <>
            {Number.isFinite(since) && s.state !== "pending" && <>{STATE_META[s.state].word} since {when(since, nowMs)} · </>}
            {Number.isFinite(checked) ? <>checked {ago(checked, nowMs)}</> : <>never checked here</>}
          </>
        )}
      </p>
      <Uptime u={s.uptime} />
      <Strip buckets={s.hours} kind="hour" />
    </button>
  )
}

function FeedTile({ feed, checkingSince, result, nowMs, onOpen }: {
  feed: FeedInfo; checkingSince: number | null; result: FeedResult | null; nowMs: number; onOpen: () => void
}) {
  const state: ViewState = checkingSince != null || !result ? "pending" : result.state
  const summary = checkingSince != null
    ? `Connecting from this computer… ${secs(checkingSince, nowMs)} s of ${FEED_WAIT_MS / 1000}`
    : result ? result.summary
    : !feed.ready ? "Getting ready…"
    : feed.id ? "Not checked yet."
    : "No auction number is saved on this computer — open this to enter one."
  return (
    <button type="button" onClick={onOpen}
      className={`text-left w-full rounded-xl border-2 ${STATE_META[state].tile} bg-white dark:bg-gray-900 p-4 hover:border-slate-400 dark:hover:border-gray-400 transition-colors flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 leading-snug">Bidpath live-bid feed</h3>
        <Badge state={state} label={checkingSince != null ? "Checking…" : undefined} />
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">{summary}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {result ? <>checked {ago(result.at, nowMs)} · </> : null}
        <b className="text-gray-700 dark:text-gray-300">checked from this computer</b>, not the Hub&apos;s server
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">Not stored, so there&apos;s no uptime or history for this one.</p>
    </button>
  )
}

// ── Detail panels ──────────────────────────────────────────────────────────────

function PanelShell({ title, subtitle, closeRef, onClose, children }: {
  title: string; subtitle: string; closeRef: RefObject<HTMLButtonElement | null>; onClose: () => void; children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="status-panel-title">
      <button type="button" aria-label="Close the details" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/50 cursor-default" />
      <div className="relative h-full w-full sm:w-[36rem] lg:w-[44rem] bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
            <h2 id="status-panel-title" className="text-xl font-bold text-gray-900 dark:text-white truncate">{title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className={BTN_SECONDARY}>✕ Close</button>
        </div>
        <div className="p-5 space-y-6">{children}</div>
      </div>
    </div>
  )
}

function SingleResultLine({ outcome }: { outcome: RunOutcome }) {
  if (outcome.kind === "result") {
    return (
      <p className="text-sm text-gray-800 dark:text-gray-100 flex flex-wrap items-center gap-2">
        Checked just now: <Badge state={outcome.state} /> <span>{outcome.summary}</span>
      </p>
    )
  }
  if (outcome.kind === "busy") {
    return <p className="text-sm text-gray-700 dark:text-gray-300">It was already being checked by the automatic checks, so it wasn&apos;t run twice. The result will show here in a moment.</p>
  }
  if (outcome.kind === "failed") {
    return <p className="text-sm text-red-700 dark:text-red-400">No result came back — {outcome.message}</p>
  }
  return <p className="text-sm text-gray-700 dark:text-gray-300">Stopped waiting. The Hub may still finish the check, and the light will update if it does.</p>
}

function ServicePanel({ s, nowMs, checkingSince, result, disabled, onCheck, onStopWaiting, onSwitch, onClose, closeRef }: {
  s: ServiceView; nowMs: number; checkingSince: number | null; result: RunOutcome | null; disabled: boolean
  onCheck: () => void; onStopWaiting: () => void
  /** Switches the check on or off; resolves to an error sentence, or null when it worked. */
  onSwitch: (enabled: boolean) => Promise<string | null>
  onClose: () => void; closeRef: RefObject<HTMLButtonElement | null>
}) {
  const since = Date.parse(s.since ?? "")
  const checked = Date.parse(s.lastCheckedAt ?? "")
  const lastOk = Date.parse(s.lastOkAt ?? "")
  const off = s.state === "disabled"

  // The switch: lit BEFORE the first await, re-entry guarded by a ref, its error beside the button (RULES.md 7b).
  const [switching, setSwitching] = useState<"on" | "off" | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const switchingRef = useRef(false)
  async function flip(enabled: boolean) {
    if (switchingRef.current) return
    switchingRef.current = true
    setSwitching(enabled ? "on" : "off")
    setSwitchError(null)
    try {
      const err = await onSwitch(enabled)
      if (err) setSwitchError(`Couldn't switch it ${enabled ? "on" : "off"} — ${err}`)
    } finally {
      switchingRef.current = false
      setSwitching(null)
    }
  }
  const switchBtn = (enabled: boolean, cls: string) => (
    <button type="button" onClick={() => void flip(enabled)} disabled={switching != null || checkingSince != null} className={cls}>
      {switching ? `Switching ${switching}…` : enabled ? "Switch this check on" : "Switch this check off"}
    </button>
  )

  return (
    <PanelShell title={s.name} subtitle={`${GROUP_LABELS[s.group]} · ${sideLabel(s)}`} closeRef={closeRef} onClose={onClose}>
      <div className="space-y-2">
        <Badge state={s.state} large />
        <p className="text-base text-gray-900 dark:text-gray-100">{s.summary}</p>
        <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-0.5">
          {!off && Number.isFinite(since) && s.state !== "pending" && <li>{STATE_META[s.state].word} since {when(since, nowMs)} ({dur(nowMs - since)})</li>}
          <li>{Number.isFinite(checked) ? <>Last checked {ago(checked, nowMs)} ({when(checked, nowMs)})</> : "Not checked yet on this environment."}</li>
          {s.state !== "ok" && Number.isFinite(lastOk) && <li>Last worked {when(lastOk, nowMs)} ({ago(lastOk, nowMs)})</li>}
          {s.latencyMs != null && <li>Answered in {s.latencyMs.toLocaleString("en-GB")} ms</li>}
        </ul>
      </div>

      {off ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">{switchBtn(true, BTN_PRIMARY)}</div>
          {switchError && <p className="text-sm text-red-700 dark:text-red-400">{switchError}</p>}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            While it is off nothing checks it, it isn&apos;t counted in the answer at the top, and the bell never rings for it.
            Switched on, it is checked again at the next automatic run.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onCheck} disabled={disabled || checkingSince != null || switching != null} className={BTN_PRIMARY}>
              {checkingSince != null ? `Checking… ${secs(checkingSince, nowMs)} s` : "Check this now"}
            </button>
            {checkingSince != null && <button type="button" onClick={onStopWaiting} className={BTN_SECONDARY}>Stop waiting</button>}
            {disabled && checkingSince == null && <span className="text-xs text-gray-500 dark:text-gray-400">Another check is running — wait for it to finish.</span>}
          </div>
          {result && <SingleResultLine outcome={result} />}
        </div>
      )}

      {!off && <section>
        <h3 className={H3}>What the check found</h3>
        {s.facts.length ? (
          <>
            <dl className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              {s.facts.map((f, i) => {
                // ⚠ Looked up, not indexed blind: an off-contract tone must not crash the panel.
                const ft = f.tone ? FACT_TONE[f.tone] : undefined
                return (
                  <div key={`${f.label}-${i}`} className="grid grid-cols-1 sm:grid-cols-[minmax(9rem,14rem)_1fr] gap-x-4 gap-y-0.5 px-3 py-2">
                    <dt className="text-sm text-gray-500 dark:text-gray-400">{f.label}</dt>
                    <dd className={`text-sm break-words ${ft ? ft.cls : "text-gray-800 dark:text-gray-200"}`}>
                      {ft ? ft.mark : ""}{f.value}
                    </dd>
                  </div>
                )
              })}
            </dl>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span className="text-emerald-700 dark:text-emerald-400">✓ green</span> = good ·{" "}
              <span className="text-amber-700 dark:text-amber-400">⚠ amber</span> = worth a look ·{" "}
              <span className="text-red-700 dark:text-red-400">✕ red</span> = a fault
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">No extra detail for this check.</p>
        )}
      </section>}

      <section>
        <h3 className={H3}>What the Hub uses it for</h3>
        <p className="text-sm text-gray-800 dark:text-gray-200">{s.what}</p>
      </section>
      <section>
        <h3 className={H3}>What stops working when it&apos;s down</h3>
        <p className="text-sm text-gray-800 dark:text-gray-200">{s.whenDown}</p>
      </section>

      <section className="space-y-3">
        <h3 className={H3}>History</h3>
        <Uptime u={s.uptime} />
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Last 24 hours</p>
          <Strip buckets={s.hours} kind="hour" />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Last 30 days</p>
          <Strip buckets={s.days} kind="day" />
        </div>
      </section>

      <section>
        <h3 className={H3}>Their own status page</h3>
        {s.statusPage ? (
          <>
            <a href={s.statusPage} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center min-h-11 text-blue-600 dark:text-blue-400 hover:underline font-medium">
              {hostOf(s.statusPage)} ↗
            </a>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Worth a look, but a green page there doesn&apos;t prove the Hub can use them — on 9 September 2026 every status page was green
              while about 1 in 4 saves failed.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">There isn&apos;t a public status page for this one.</p>
        )}
      </section>

      {!off && (
        <section className="space-y-2">
          <h3 className={H3}>Not using this any more?</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Switched off, it is never checked, doesn&apos;t count in the answer at the top, and never rings the bell. Its tile stays here,
            greyed, saying who switched it off and when, so it can be switched back on.
            {s.group === "hub" && <> <b className="text-amber-700 dark:text-amber-300">This is one of the Hub&apos;s own checks</b> — with it off, the page can no longer say a problem is inside the Hub.</>}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {switchBtn(false, BTN_SECONDARY)}
            {switchError && <span className="text-sm text-red-700 dark:text-red-400">{switchError}</span>}
          </div>
        </section>
      )}
    </PanelShell>
  )
}

function FeedPanel({ feed, checkingSince, result, nowMs, disabled, onCheck, onSaveId, onForgetId, onClose, closeRef }: {
  feed: FeedInfo; checkingSince: number | null; result: FeedResult | null; nowMs: number; disabled: boolean
  onCheck: () => void; onSaveId: (id: string) => void; onForgetId: () => void; onClose: () => void
  closeRef: RefObject<HTMLButtonElement | null>
}) {
  const [draft, setDraft] = useState("")
  const [draftError, setDraftError] = useState<string | null>(null)
  const state: ViewState = checkingSince != null || !result ? "pending" : result.state
  const save = () => {
    const v = draft.trim()
    if (!FEED_ID_RE.test(v)) { setDraftError("Auction numbers are letters and digits only, with no spaces."); return }
    setDraftError(null)
    setDraft("")
    onSaveId(v)
  }
  return (
    <PanelShell title="Bidpath live-bid feed" subtitle={`${GROUP_LABELS.suppliers} · a supplier · checked from this computer`} closeRef={closeRef} onClose={onClose}>
      <div className="space-y-2">
        <Badge state={state} large label={checkingSince != null ? "Checking…" : undefined} />
        <p className="text-base text-gray-900 dark:text-gray-100">
          {checkingSince != null ? `Connecting from this computer… ${secs(checkingSince, nowMs)} s of ${FEED_WAIT_MS / 1000}`
            : result ? result.summary
            : feed.id ? "Not checked yet." : "No auction number is saved on this computer yet."}
        </p>
        {result && <p className="text-sm text-gray-600 dark:text-gray-400">Checked {ago(result.at, nowMs)} ({when(result.at, nowMs)}) from this computer, using auction number {result.id}.</p>}
        {result?.state === "down" && (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            If another office computer can connect, the problem is this computer&apos;s network rather than Bidpath. An old or mistyped auction
            number can also be refused.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onCheck} disabled={!feed.id || disabled || checkingSince != null} className={BTN_PRIMARY}>
          {checkingSince != null ? `Checking… ${secs(checkingSince, nowMs)} s` : "Check this now"}
        </button>
        {disabled && checkingSince == null && <span className="text-xs text-gray-500 dark:text-gray-400">Another check is running — wait for it to finish.</span>}
      </div>

      <section className="space-y-2">
        <h3 className={H3}>Auction number</h3>
        {feed.id && feed.source ? (
          <p className="text-sm text-gray-800 dark:text-gray-200">
            <b>{feed.id}</b> — {FEED_SOURCE_LABEL[feed.source]}.
            {feed.source === "page" && (
              <button type="button" onClick={onForgetId} disabled={disabled || checkingSince != null}
                className="ml-2 min-h-11 px-2 text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:no-underline">
                Forget it
              </button>
            )}
          </p>
        ) : (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            The Auction Monitor saves one on this computer when you watch a sale with it. Or type the number the Auction Monitor uses — the one
            at the end of the live feed address (wss://…/wss/<b>number</b>).
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="feed-id" className="sr-only">Auction number</label>
          <input id="feed-id" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save() }}
            inputMode="numeric" autoComplete="off" placeholder={feed.id ? "Use a different number" : "Auction number"}
            className="min-h-11 w-56 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3" />
          <button type="button" onClick={save} disabled={!draft.trim() || disabled} className={BTN_SECONDARY}>Save and check</button>
        </div>
        {draftError && <p className="text-sm text-red-700 dark:text-red-400">{draftError}</p>}
        <p className="text-xs text-gray-500 dark:text-gray-400">A number typed here is kept on this computer only, and doesn&apos;t change what the Auction Monitor opens.</p>
      </section>

      <section>
        <h3 className={H3}>What the Hub uses it for</h3>
        <p className="text-sm text-gray-800 dark:text-gray-200">
          The live bid feed from the Vectis website&apos;s live-bidding platform. It sends every bid, lot change and hammer as it happens. The
          Auction Monitor (and its phone alerts), Auto Clerk Live and the AI Presenter all watch it from office computers — the Hub&apos;s server
          never connects to it.
        </p>
      </section>
      <section>
        <h3 className={H3}>What stops working when it&apos;s down</h3>
        <p className="text-sm text-gray-800 dark:text-gray-200">
          The Hub&apos;s sale-day tools lose the live sale: the Auction Monitor goes quiet and its phone alerts stop, and Auto Clerk Live and the AI
          Presenter stop following the bidding. Bidding itself happens on the website, not in the Hub.
        </p>
      </section>
      <section>
        <h3 className={H3}>How this is checked</h3>
        <p className="text-sm text-gray-800 dark:text-gray-200">
          This computer opens the feed, waits up to {FEED_WAIT_MS / 1000} seconds for it to answer, then closes it straight away without
          sending anything. It runs when this page opens and when you press a Check button. Nothing is stored, so there&apos;s no history and it
          never rings the bell. Outside a live sale the feed is silent — that&apos;s normal, and isn&apos;t what&apos;s being checked.
        </p>
      </section>
      <section>
        <h3 className={H3}>Their own status page</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">Bidpath doesn&apos;t have a public status page.</p>
      </section>
    </PanelShell>
  )
}

// ── Alerts ─────────────────────────────────────────────────────────────────────

function AlertsList({ alerts, historyAvailable, nowMs, onOpenKey }: {
  alerts: NotificationView[]; historyAvailable: boolean; nowMs: number; onOpenKey: (key: string) => void
}) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white">Recent alerts</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">The same alerts the 🔔 bell shows, newest first.</p>
      </div>
      {!historyAvailable ? (
        <p className="px-4 py-4 text-sm text-amber-800 dark:text-amber-300">Alerts start once Run Migrations has been pressed.</p>
      ) : alerts.length === 0 ? (
        <p className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">
          No alerts yet. One appears here when a service fails 2 checks in a row, and again when it recovers.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {alerts.map(a => {
            const at = Date.parse(a.createdAt)
            const hashKey = a.href?.startsWith("/admin/status#") ? decodeURIComponent(a.href.slice("/admin/status#".length)) : null
            const body = (
              <>
                <span aria-hidden className={`w-1.5 self-stretch rounded-full shrink-0 ${LEVEL_STRIPE[a.level] ?? LEVEL_STRIPE.info}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{a.title}</span>
                  {a.body && <span className="block text-sm text-gray-600 dark:text-gray-400">{a.body}</span>}
                  {Number.isFinite(at) && <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{when(at, nowMs)} · {ago(at, nowMs)}</span>}
                </span>
              </>
            )
            const row = "flex gap-3 w-full text-left px-4 py-3 min-h-11"
            return (
              <li key={a.id}>
                {hashKey ? (
                  <button type="button" onClick={() => onOpenKey(hashKey)} className={`${row} hover:bg-gray-50 dark:hover:bg-gray-800/60`}>{body}</button>
                ) : a.href ? (
                  <Link href={a.href} className={`${row} hover:bg-gray-50 dark:hover:bg-gray-800/60`}>{body}</Link>
                ) : (
                  <div className={row}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-3 rounded-full bg-red-500" /> stopped working</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-3 rounded-full bg-amber-400" /> having problems</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-3 rounded-full bg-emerald-500" /> working again</span>
      </p>
    </section>
  )
}

// ── The page ───────────────────────────────────────────────────────────────────

export default function StatusClient() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const [run, setRun] = useState<RunProgress | null>(null)
  const [report, setReport] = useState<RunReport | null>(null)
  const [single, setSingle] = useState<{ key: string; startedAt: number } | null>(null)
  const [singleResult, setSingleResult] = useState<SingleResult | null>(null)

  const [feed, setFeed] = useState<FeedInfo>({ ready: false, id: null, source: null })
  const [feedCheckingSince, setFeedCheckingSince] = useState<number | null>(null)
  const [feedResult, setFeedResult] = useState<FeedResult | null>(null)

  /** True while "Check everything" or "Check this now" is in flight — only one at a time. */
  const runningRef = useRef(false)
  const stopRef = useRef(false)
  const ctlRef = useRef<AbortController | null>(null)
  const feedCancelRef = useRef<(() => void) | null>(null)
  const loadSeq = useRef(0)
  const mountedRef = useRef(false)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const res = await fetch("/api/status", { cache: "no-store" })
      const j = (await res.json().catch(() => null)) as (StatusResponse & { error?: string }) | null
      if (seq !== loadSeq.current) return
      if (res.status === 401) { setLoadError("Your sign-in has run out — reload the page to sign in again."); return }
      if (!res.ok || !j || !Array.isArray(j.services)) {
        setLoadError(`The Hub's server answered with an error${j?.error ? `: ${String(j.error).slice(0, 200)}` : ` (${res.status})`}.`)
        return
      }
      setData(safeView(j))
      setLoadError(null)
      setLoadedAt(Date.now())
      setNow(Date.now())
    } catch {
      if (seq === loadSeq.current) setLoadError("This computer couldn't reach the Hub's server.")
    }
  }, [])

  const checkFeed = useCallback((id: string): Promise<FeedResult | null> => {
    feedCancelRef.current?.()
    const probe = probeFeed(id)
    feedCancelRef.current = probe.cancel
    setFeedCheckingSince(Date.now())
    setNow(Date.now())
    return probe.promise.then(r => {
      if (feedCancelRef.current === probe.cancel) {
        feedCancelRef.current = null
        setFeedCheckingSince(null)
      }
      if (r) setFeedResult(r)
      return r
    })
  }, [])

  // Live updates: the engine emits "status:changed" after every run and "notifications:changed" with every
  // alert. Debounced, and held back while a check is running here (the run refreshes once at the end —
  // otherwise "Check everything" would reload the whole history fifteen times). Polls as a fallback.
  useEffect(() => {
    void load()
    let debounce: ReturnType<typeof setTimeout> | null = null
    const poll = setInterval(() => {
      if (!runningRef.current && document.visibilityState === "visible") void load()
    }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === "visible" && !runningRef.current) void load() }
    document.addEventListener("visibilitychange", onVisible)
    const socket = acquireAppSocket()
    const onChanged = () => {
      if (runningRef.current) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => { void load() }, 800)
    }
    socket.on("status:changed", onChanged)
    socket.on("notifications:changed", onChanged)
    const stop = stopRef, ctl = ctlRef, mounted = mountedRef
    mounted.current = true
    return () => {
      // ⚠ Leaving the page mid "Check everything" must END the run. The loop is a plain async function, not
      // tied to this component: without this it carried on posting a forced check per service — each one
      // skipping its minimum interval — to suppliers, with nobody watching and no Stop on screen.
      mounted.current = false
      stop.current = true
      ctl.current?.abort()
      clearInterval(poll)
      if (debounce) clearTimeout(debounce)
      document.removeEventListener("visibilitychange", onVisible)
      socket.off("status:changed", onChanged)
      socket.off("notifications:changed", onChanged)
      releaseAppSocket()
    }
  }, [load])

  // After the first paint: the saved feed number (localStorage can't be read during the server render),
  // the deep link (/admin/status#<key> — the bell's alerts point there), and the feed check itself.
  useEffect(() => {
    const t = setTimeout(() => {
      setNow(Date.now())
      const saved = readSavedFeedId()
      setFeed({ ready: true, id: saved?.id ?? null, source: saved?.source ?? null })
      setOpenKey(keyFromHash())
      if (saved) void checkFeed(saved.id)
    }, 0)
    const onHash = () => setOpenKey(keyFromHash())
    window.addEventListener("hashchange", onHash)
    const cancelRef = feedCancelRef
    return () => {
      clearTimeout(t)
      window.removeEventListener("hashchange", onHash)
      cancelRef.current?.()
    }
  }, [checkFeed])

  // A number that moves while anything is checking (RULES.md 7b); otherwise just keep "… ago" honest.
  const busy = run != null || single != null || feedCheckingSince != null
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), busy ? 1000 : 30_000)
    return () => clearInterval(id)
  }, [busy])

  const openPanel = useCallback((key: string) => {
    setOpenKey(key)
    try { window.history.replaceState(null, "", `#${encodeURIComponent(key)}`) } catch { /* the panel still opens */ }
  }, [])

  const closePanel = useCallback(() => {
    setOpenKey(null)
    try {
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search)
    } catch { /* nothing to tidy */ }
  }, [])

  const openService = data?.services.find(s => s.key === openKey) ?? null
  const panelOpen = openService != null || (openKey === FEED_KEY && feed.ready)

  useEffect(() => {
    if (!panelOpen) return
    closeBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [panelOpen, closePanel])

  /** Shows a fresh result on its tile straight away; the full picture (facts, since, history) arrives
   *  with the reload at the end. */
  const applyLocal = (key: string, state: StatusState, summary: string) => {
    const at = new Date().toISOString()
    setData(d => d && {
      ...d,
      services: d.services.map(s => s.key !== key ? s : {
        ...s, state, summary, lastCheckedAt: at,
        since: s.state === state ? s.since : at,
        lastOkAt: state === "ok" ? at : s.lastOkAt,
      }),
    })
  }

  async function checkEverything() {
    if (!data || runningRef.current) return
    runningRef.current = true
    stopRef.current = false
    setReport(null)
    setSingleResult(null)
    const feedId = feed.id
    const steps: RunStep[] = data.services.filter(s => s.state !== "disabled").map(s => ({ key: s.key, name: s.name }))
    if (feedId) steps.push({ key: FEED_KEY, name: "Bidpath live-bid feed (from this computer)" })
    const t0 = Date.now()
    setNow(t0)
    setRun({ steps: [...steps], index: 0, stepStartedAt: t0, stopping: false })

    for (let i = 0; i < steps.length; i++) {
      if (stopRef.current) break
      const step = steps[i]
      setRun(r => r && { ...r, index: i, stepStartedAt: Date.now() })
      if (step.key === FEED_KEY && feedId) {
        const fr = await checkFeed(feedId)
        steps[i] = { ...step, outcome: fr ? fr.state : "stopped" }
      } else {
        const ctl = new AbortController()
        ctlRef.current = ctl
        const r = await postRun(step.key, ctl)
        ctlRef.current = null
        if (r.kind === "result") { applyLocal(step.key, r.state, r.summary); steps[i] = { ...step, outcome: r.state } }
        else if (r.kind === "failed") steps[i] = { ...step, outcome: "failed", message: r.message }
        else steps[i] = { ...step, outcome: r.kind }
      }
      setRun(r => r && { ...r, steps: [...steps] })
    }

    const stopped = stopRef.current
    runningRef.current = false
    if (!mountedRef.current) return // left the page mid-run — nothing to show it on
    setRun(null)
    setReport(buildReport(steps, stopped, !feedId))
    await load()
  }

  function stopEverything() {
    stopRef.current = true
    ctlRef.current?.abort()
    feedCancelRef.current?.()
    setRun(r => r && { ...r, stopping: true })
  }

  async function checkOne(key: string) {
    if (runningRef.current) return
    runningRef.current = true
    setSingleResult(null)
    const t0 = Date.now()
    setNow(t0)
    setSingle({ key, startedAt: t0 })
    const ctl = new AbortController()
    ctlRef.current = ctl
    const r = await postRun(key, ctl)
    ctlRef.current = null
    runningRef.current = false
    if (!mountedRef.current) return
    if (r.kind === "result") applyLocal(key, r.state, r.summary)
    setSingleResult({ key, outcome: r })
    setSingle(null)
    await load()
  }

  /** Switches a check off or on. Resolves to an error sentence, or null once the page has reloaded with it. */
  async function switchService(key: string, enabled: boolean): Promise<string | null> {
    try {
      const res = await fetch("/api/status/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: key, enabled }),
        cache: "no-store",
      })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.status === 401) return "your sign-in has run out — reload the page to sign in again."
      if (!res.ok || !j?.ok) return j?.error ? String(j.error).slice(0, 300) : `the Hub's server answered with an error (${res.status}).`
      setSingleResult(null)
      await load()
      return null
    } catch {
      return "the Hub's server didn't answer."
    }
  }

  function saveFeedId(id: string) {
    try { localStorage.setItem(FEED_ID_KEY, id) } catch { /* kept for this visit only */ }
    setFeed({ ready: true, id, source: "page" })
    setFeedResult(null)
    void checkFeed(id)
  }

  function forgetFeedId() {
    try { localStorage.removeItem(FEED_ID_KEY) } catch { /* nothing stored */ }
    feedCancelRef.current?.()
    const saved = readSavedFeedId()
    setFeed({ ready: true, id: saved?.id ?? null, source: saved?.source ?? null })
    setFeedResult(null)
    if (saved) void checkFeed(saved.id)
  }

  const somethingRunning = run != null || single != null

  // ── Header and progress ──────────────────────────────────────────────────────
  const header = (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🚦 Status Centre</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Staff say something&apos;s broken — is it us or a supplier? Each light says whether the Hub can actually do its job with that
          service, not just whether it answers.
        </p>
        {data && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Environment: <b className="text-gray-700 dark:text-gray-300">{data.env}</b>
            {loadedAt ? <> · page updated {when(loadedAt, now || loadedAt)} · updates by itself</> : null}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {run ? (
          <button type="button" onClick={stopEverything} disabled={run.stopping} className={BTN_SECONDARY}>
            {run.stopping ? "Stopping…" : "■ Stop"}
          </button>
        ) : (
          <button type="button" onClick={() => void checkEverything()} disabled={!data || somethingRunning} className={BTN_PRIMARY}>
            Check everything now
          </button>
        )}
      </div>
    </header>
  )

  const progress = run && (
    <div className="rounded-xl border border-sky-300 dark:border-sky-700/60 bg-sky-50 dark:bg-sky-950/30 px-4 py-3 space-y-2" aria-live="polite">
      <p className="text-sm font-semibold text-sky-950 dark:text-sky-100">
        {run.stopping
          ? "Stopping…"
          : `Checking ${Math.min(run.index + 1, run.steps.length)} of ${run.steps.length} — ${run.steps[run.index]?.name ?? ""}… ${secs(run.stepStartedAt, now)} s`}
      </p>
      <div className="flex gap-1">
        {run.steps.map((st, i) => {
          const look = stepLook(st.outcome)
          const current = i === run.index && !st.outcome
          return (
            <span key={st.key} title={`${st.name}: ${st.outcome ? (st.outcome === "busy" ? "already being checked" : st.outcome === "failed" ? "couldn't be started" : st.outcome === "stopped" ? "stopped" : STATE_META[look].word) : current ? "checking now" : "waiting"}`}
              className={`h-3 flex-1 min-w-0 rounded-sm ${current ? "bg-sky-500 animate-pulse" : STATE_META[look].seg}`}
              style={look === "off" && !current ? HATCH : undefined} />
          )
        })}
      </div>
      <p className="text-xs text-sky-900/80 dark:text-sky-200/80">
        One block per check, filled in with its result as it lands (colours as in the key); the pulsing blue block is the one being checked now.
      </p>
    </div>
  )

  const reportBox = report && (
    <div className={`rounded-xl border px-4 py-3 space-y-1.5 ${TONE_BOX[report.tone]}`} aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          {report.headline}{" "}
          {report.counts.length ? report.counts.map(c => (
            <span key={c.label} className="inline-flex items-center gap-1.5 font-normal mr-2">
              <Swatch state={c.state} className="w-2.5 h-2.5 rounded-full" /> {c.n} {c.label}
            </span>
          )) : <span className="font-normal">No results came back.</span>}
        </p>
        <button type="button" onClick={() => setReport(null)} aria-label="Dismiss" className="min-h-11 min-w-11 -my-2 -mr-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10">✕</button>
      </div>
      {report.notes.map((n, i) => <p key={i} className="text-sm">{n}</p>)}
    </div>
  )

  // ── Loading / couldn't load ───────────────────────────────────────────────────
  const feedTile = (
    <FeedTile feed={feed} checkingSince={feedCheckingSince} result={feedResult} nowMs={now} onOpen={() => openPanel(FEED_KEY)} />
  )

  if (!data) {
    return (
      <div className="p-4 md:p-6 space-y-5">
        {header}
        {loadError ? (
          <Note tone="bad">
            <p className="text-lg font-bold">🔴 This page couldn&apos;t load the results</p>
            <p className="mt-1">{loadError} That points at the Hub itself (or this computer&apos;s network), not a supplier.</p>
            <button type="button" onClick={() => void load()} className={`${BTN_SECONDARY} mt-3`}>Try again</button>
          </Note>
        ) : (
          <Note tone="neutral">Loading the latest results…</Note>
        )}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-2">Checked from this computer</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">{feedTile}</div>
        </section>
        {openKey === FEED_KEY && feed.ready && (
          <FeedPanel feed={feed} checkingSince={feedCheckingSince} result={feedResult} nowMs={now} disabled={false}
            onCheck={() => { if (feed.id) void checkFeed(feed.id) }} onSaveId={saveFeedId} onForgetId={forgetFeedId}
            onClose={closePanel} closeRef={closeBtnRef} />
        )}
      </div>
    )
  }

  // ── The answer, notes, key, tiles, alerts ─────────────────────────────────────
  const answer = answerFor(data.services, feedResult)
  const env = envNote(data.env)
  const stale = staleNote(data.services, data.env, now)
  const groups: StatusGroup[] = []
  for (const s of data.services) if (!groups.includes(s.group)) groups.push(s.group)
  if (!groups.includes("suppliers")) groups.push("suppliers")
  const currentKey = run ? run.steps[run.index]?.key : single?.key

  return (
    <div className="p-4 md:p-6 space-y-5">
      {header}
      {progress}
      {reportBox}

      {loadError && (
        <Note tone="bad">
          <p className="font-bold">🔴 This page can&apos;t reach the Hub&apos;s server right now</p>
          <p className="mt-0.5">
            {loadError} That points at the Hub itself (or this computer&apos;s network), not a supplier. The lights below are from
            {loadedAt ? ` ${when(loadedAt, now || loadedAt)}` : " earlier"} and may be out of date.
          </p>
        </Note>
      )}

      <div className={`rounded-xl border-2 px-5 py-4 ${TONE_BOX[answer.tone]}`}>
        <p className="text-xl font-bold leading-snug">{answer.headline}</p>
        {answer.problems.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {answer.problems.map(p => (
              <button key={p.key} type="button" onClick={() => openPanel(p.key)}
                className="min-h-11 inline-flex items-center gap-2 rounded-lg border border-current/30 bg-white/60 dark:bg-black/20 px-3 text-sm font-medium hover:bg-white dark:hover:bg-black/40 text-left">
                <Swatch state={p.state} />
                <span>{answer.problems.length > 1 ? <><b>{p.name}</b> — {clip(p.summary)}</> : <>See what {p.name}&apos;s check found</>}</span>
              </button>
            ))}
          </div>
        )}
        {answer.notes.map((n, i) => <p key={i} className="mt-1.5 text-sm opacity-90">{n}</p>)}
      </div>

      {env && <Note tone="neutral">{env}</Note>}
      {!data.historyAvailable && (
        <Note tone="warn">
          <b>History and alerts start once Run Migrations has been pressed</b> (bottom of the Admin page). The lights below are live results —
          they just aren&apos;t being kept yet, so there&apos;s no uptime, no strips and the bell can&apos;t ring.
        </Note>
      )}
      {stale && <Note tone="warn">{stale}</Note>}

      <StatusKey />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] items-start">
        <div className="space-y-6 min-w-0">
          {groups.map(g => {
            const list = data.services.filter(s => s.group === g)
            const tally = KEY_ORDER
              .map(st => ({ st, n: list.filter(s => s.state === st).length }))
              .filter(x => x.n > 0)
              .map(x => `${x.n} ${STATE_META[x.st].word.toLowerCase()}`)
            return (
              <section key={g}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-200">{GROUP_LABELS[g]}</h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{g === "hub" ? "Inside the Hub" : "Supplier"}</span>
                  {tally.length > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">{tally.join(" · ")}</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                  {list.map(s => (
                    <ServiceTile key={s.key} s={s} nowMs={now} checking={currentKey === s.key} onOpen={() => openPanel(s.key)} />
                  ))}
                  {g === "suppliers" && feedTile}
                </div>
              </section>
            )
          })}
        </div>
        <aside className="min-w-0">
          <AlertsList alerts={data.alerts} historyAvailable={data.historyAvailable} nowMs={now} onOpenKey={openPanel} />
        </aside>
      </div>

      {openService && (
        <ServicePanel s={openService} nowMs={now}
          checkingSince={single?.key === openService.key ? single.startedAt : null}
          result={singleResult?.key === openService.key ? singleResult.outcome : null}
          disabled={somethingRunning && single?.key !== openService.key}
          onCheck={() => void checkOne(openService.key)}
          onStopWaiting={() => ctlRef.current?.abort()}
          onSwitch={enabled => switchService(openService.key, enabled)}
          onClose={closePanel} closeRef={closeBtnRef} />
      )}
      {!openService && openKey === FEED_KEY && feed.ready && (
        <FeedPanel feed={feed} checkingSince={feedCheckingSince} result={feedResult} nowMs={now} disabled={run != null}
          onCheck={() => { if (feed.id) void checkFeed(feed.id) }} onSaveId={saveFeedId} onForgetId={forgetFeedId}
          onClose={closePanel} closeRef={closeBtnRef} />
      )}
    </div>
  )
}
