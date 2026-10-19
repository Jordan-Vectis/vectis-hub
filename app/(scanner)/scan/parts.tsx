"use client"

import { useState, type ReactNode } from "react"
import { howFar, isAlreadyThere, type Banner, type ScanController, type Snapshot } from "@/lib/goods-in/scan-client/controller"
import type { HubInfo } from "@/lib/goods-in/scan-client/device"
import type { StoredScan } from "@/lib/goods-in/scan-client/types"
import { BackIcon, DownIcon, ErrorIcon, GearIcon, InfoIcon, OkIcon, ScanIcon, WarnIcon } from "./icons"
import { bigBtn, btn, btnTall, card, cardTitle, clock, field, iconBtn, mono, muted, plural, sheet } from "./ui"

// The pieces every scanner screen shares: the slim top bar (title, back, status pill, settings
// cog), the banner after each scan, the strips that say something is wrong with the set-up, the
// list of scans, "Type a code", and the "Still …?" question on a scanner that has lain unused.
// Sized for a small screen (320–360px wide) — see ui.ts.

/** The id of the "Need a look" list — the top bar's red pill scrolls to it on whichever screen is open. */
export const NEED_A_LOOK_ID = "scan-need-a-look"

function scrollToNeedALook() {
  try { document.getElementById(NEED_A_LOOK_ID)?.scrollIntoView({ block: "start", behavior: "smooth" }) } catch { /* ignore */ }
}

export const HUB_TONE: Record<string, string> = {
  production: "bg-emerald-600 text-white",
  staging: "bg-amber-400 text-black",
  sandbox: "bg-fuchsia-600 text-white",
  local: "bg-gray-500 text-white",
  other: "bg-gray-500 text-white",
}

/** "Live Hub", or "Staging — test Hub" — the words beside the Hub's colour (the colour alone is no key). */
export function hubWords(hub: HubInfo): string {
  return hub.kind === "staging" || hub.kind === "sandbox" ? `${hub.label} — test Hub` : hub.label
}

/** Online / offline / not sending, as a coloured dot and a word. */
export function netState(s: Snapshot): { dot: string; word: string; key: "on" | "off" | "stuck" } {
  const problem = s.sync.problem
  if (!s.online) return { dot: "bg-red-500", word: "Offline", key: "off" }
  if (problem && problem.kind !== "offline" && s.waitingMine) return { dot: "bg-amber-400", word: "Not sending", key: "stuck" }
  return { dot: "bg-emerald-500", word: "Online", key: "on" }
}

/**
 * The red button in the top bar while any scan needs a look: a warning, the count, and a tap scrolls
 * down to that list — a refusal must not slip by once the next scan's banner has replaced its own.
 * It sits BESIDE the status pill, never instead of it: problems stay until dismissed (hours, maybe),
 * and a scanner that has gone offline meanwhile must still show it on every screen.
 */
function NeedALookPill({ n }: { n: number }) {
  return (
    <button type="button" onClick={scrollToNeedALook} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-0.5" title="Scans that need a look" aria-label={`${n} ${n === 1 ? "scan needs" : "scans need"} a look — go to the list`}>
      <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-1 text-[13px] font-bold leading-tight text-white">
        <WarnIcon className="h-4 w-4" />
        {n}
        <DownIcon className="h-3.5 w-3.5" />
      </span>
    </button>
  )
}

/**
 * The status pill in the top bar: a dot (green online, red offline, amber not sending) and how many
 * of this person's scans are waiting ("Offline · 3", "3 waiting", "3 not sent", "Sending…"). Tapping
 * it opens Settings (Send now is there, with the words for every dot colour). `compact` — while the
 * red Need a look button shares the bar — drops the words to just the dot and the number, so the
 * title still has room at 320px; the label read out stays the full sentence.
 */
function StatusPill({ s, onOpen, compact = false }: { s: Snapshot; onOpen: () => void; compact?: boolean }) {
  const n = s.waitingMine
  const net = netState(s)
  const text = compact ? (n ? String(n) : "")
    : s.sync.sending ? "Sending…"
    : net.key === "off" ? (n ? `Offline · ${n}` : "Offline")
    : n ? (net.key === "stuck" ? `${n} not sent` : `${n} waiting`)
    : ""
  const said = `${net.word}, ${n ? `${plural(n, "scan")} waiting` : "nothing waiting"} — open settings`
  return (
    <button type="button" onClick={onOpen} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-0.5" aria-label={said} title={said}>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-bold leading-tight ${n || net.key !== "on" ? "bg-gray-100 dark:bg-gray-800" : ""}`}>
        <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${net.dot}`} />
        {text && <span className={n && net.key !== "off" ? "text-amber-800 dark:text-amber-300" : ""}>{text}</span>}
      </span>
    </button>
  )
}

/**
 * The slim top bar (about 48px): back arrow (off Home), the screen's title, the red Need a look
 * button while any scan needs one, the status pill and the settings cog. A Hub that isn't the live
 * one adds a thin coloured line under it, in words, so nobody scans a morning's shelving into a test
 * Hub without seeing it.
 *
 * The title wraps and is never cut: at 320px with everything in the bar, and bigger text, it can need
 * three lines — the bar is min-h-12, so it grows a row rather than show "Check / a…".
 */
export function TopBar({ title, onBack, s, onSettings }: { title: string; onBack?: () => void; s: Snapshot; onSettings: () => void }) {
  const showHub = !!s.hub.label && s.hub.kind !== "production"
  const looks = s.problems.length
  return (
    <header className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <div className="flex min-h-12 items-center gap-0.5 px-1">
        {onBack
          ? <button type="button" className={iconBtn} onClick={onBack} aria-label="Back"><BackIcon className="h-6 w-6" /></button>
          : <span aria-hidden className="w-2 shrink-0" />}
        <h1 className="min-w-0 flex-1 break-words py-1 text-base font-bold leading-tight">{title}</h1>
        {looks > 0 && <NeedALookPill n={looks} />}
        <StatusPill s={s} onOpen={onSettings} compact={looks > 0} />
        <button type="button" className={iconBtn} onClick={onSettings} aria-label="Settings" aria-haspopup="dialog">
          <GearIcon className="h-6 w-6" />
        </button>
      </div>
      {showHub && <p className={`px-3 py-0.5 text-center text-[12px] font-bold uppercase leading-snug tracking-wide break-words ${HUB_TONE[s.hub.kind] ?? HUB_TONE.other}`}>{hubWords(s.hub)}</p>}
    </header>
  )
}

/** A shared scanner that has lain unused: who has it now? (Scans aren't used until it's answered.) */
export function StillYou({ name, ctl }: { name: string; ctl: ScanController }) {
  return (
    <div className={`${sheet} z-40`} role="dialog" aria-modal="true" aria-labelledby="scan-still-you">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-3 px-4 py-4">
          <h2 id="scan-still-you" className="text-xl font-extrabold leading-tight break-words">Still {name}?</h2>
          <p className="text-[15px] leading-snug">This scanner hasn&apos;t been used for a while. Every scan is recorded against {name} — if that isn&apos;t you, switch user first.</p>
          <button type="button" className={bigBtn} onClick={ctl.stillMe}>Yes, it&apos;s me</button>
          <button type="button" className={`${btnTall} w-full`} onClick={ctl.notMe}>Switch user</button>
        </div>
      </div>
    </div>
  )
}

const BANNER_TONE: Record<Banner["tone"], string> = {
  ok: "bg-emerald-600 text-white",
  warn: "bg-amber-400 text-black",
  error: "bg-red-600 text-white",
  info: "bg-white text-gray-900 border border-gray-300 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700",
}

function BannerIcon({ tone }: { tone: Banner["tone"] }) {
  const c = "mt-px h-5 w-5 shrink-0"
  if (tone === "ok") return <OkIcon className={c} />
  if (tone === "warn") return <WarnIcon className={c} />
  if (tone === "error") return <ErrorIcon className={c} />
  return <InfoIcon className={`${c} text-gray-500 dark:text-gray-400`} />
}

/**
 * The answer to the last scan, at the top of the screen under the top bar: one bold line and one
 * detail line, with its colour and icon — green done, amber read this, red not done. With no answer
 * yet it says what to scan.
 */
export function BannerView({ banner, prompt, ctl }: { banner: Banner | null; prompt: string; ctl: ScanController }) {
  if (!banner) {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2.5 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5">
        <ScanIcon className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" />
        <p className="min-w-0 text-[15px] font-semibold leading-snug break-words">{prompt}</p>
      </div>
    )
  }
  return (
    <div role={banner.tone === "error" ? "alert" : "status"} aria-live="assertive" className={`rounded-xl px-3 py-2.5 ${BANNER_TONE[banner.tone]}`}>
      <div className="flex items-start gap-2.5">
        <BannerIcon tone={banner.tone} />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-extrabold leading-tight break-words">{banner.title}</p>
          {banner.detail && <p className="mt-0.5 text-[14px] font-medium leading-snug break-words">{banner.detail}</p>}
        </div>
      </div>
      {banner.actions.length > 0 && (
        <div className="mt-2 grid gap-2">
          {banner.actions.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => ctl.bannerAction(a.id)}
              className="min-h-11 rounded-lg bg-black/80 px-3 py-1.5 text-[15px] font-bold leading-tight text-white active:bg-black"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Plain-words strips for things that are wrong with the set-up, not with one scan. */
export function Strips({ s, ctl, onSettings }: { s: Snapshot; ctl: ScanController; onSettings: () => void }) {
  const items: { tone: "red" | "amber" | "grey"; text: string; action?: { label: string; run: () => void } }[] = []
  if (s.userMismatch) items.push({ tone: "red", text: `This scanner is now signed in as ${s.userMismatch} (in another window or the sign-in page). Reload so scans are recorded against the right person.`, action: { label: "Reload", run: () => window.location.reload() } })
  if (s.sync.problem?.kind === "signed-out" && s.waitingMine) items.push({ tone: "red", text: `You've been signed out. Sign in again as ${ctl.me.name} to send the ${plural(s.waitingMine, "waiting scan")}.`, action: { label: "Sign in", run: () => ctl.signInAgain() } })
  if (s.fromCache) items.push({ tone: "grey", text: "Opened from this scanner's saved copy — the Hub couldn't be reached. Moves are saved here and sent when the Wi-Fi is back." })
  if (s.notice) items.push({ tone: "amber", text: `${s.notice} Scans are kept on this scanner until then.` })
  if (s.storeKind === "memory") items.push({ tone: "red", text: "This scanner can't save scans on the device — they'd be lost if the page closed. Stay on Wi-Fi so each one is sent straight away." })
  if (s.clockOffMs !== null) items.push({ tone: "red", text: `This scanner's clock is ${howFar(s.clockOffMs)} ${s.clockOffMs > 0 ? "slow" : "fast"}. Scans are stamped with the Hub's time instead, but set the scanner's Date & time to automatic (Settings → System → Date & time).` })
  // Switch user and Send now are both behind the cog now, so the strip says so and opens it.
  for (const o of s.waitingOthers) items.push({ tone: "amber", text: `${plural(o.n, "scan")} by ${o.name} ${o.n === 1 ? "is" : "are"} still waiting. Only ${o.name} can send ${o.n === 1 ? "it" : "them"} — they sign in on this scanner and press Send now (Settings, the cog top right).`, action: { label: "Settings", run: onSettings } })
  if (s.locationsAt !== null && s.locationCount === 0 && s.online) items.push({ tone: "amber", text: "The Hub has no Goods In locations yet, so nothing can be put away. A Warehouse manager adds them in Goods In → Locations." })
  if (!items.length) return null
  const tone = { red: "bg-red-600 text-white", amber: "bg-amber-400 text-black", grey: "bg-gray-700 text-white" }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className={`rounded-lg px-3 py-2 text-[13px] font-medium leading-snug break-words ${tone[it.tone]}`}>
          <p>{it.text}</p>
          {it.action && (
            <button type="button" onClick={it.action.run} className="mt-1.5 min-h-11 rounded-lg bg-black/80 px-4 py-1.5 text-[15px] font-bold leading-tight text-white">{it.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}

function statusChip(scan: StoredScan, sending: boolean): { text: string; tone: string } {
  if (scan.status === "waiting") return sending ? { text: "Sending…", tone: "bg-indigo-600 text-white" } : { text: "Waiting", tone: "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white" }
  if (scan.status === "applied") return { text: "Done", tone: "bg-emerald-600 text-white" }
  if (scan.status === "already") return { text: "Sent before", tone: "bg-emerald-700 text-white" }
  if (isAlreadyThere(scan)) return { text: "Already there", tone: "bg-gray-500 text-white" }
  if (scan.status === "stale") return { text: "Moved since", tone: "bg-amber-400 text-black" }
  return { text: "Not done", tone: "bg-red-600 text-white" }
}

/** One scan: item → location and its state, then the time and what the Hub said (one line in Recent). */
function ScanRow({ scan, sending, me, ctl, problem }: { scan: StoredScan; sending: boolean; me: string; ctl: ScanController; problem?: boolean }) {
  const chip = statusChip(scan, sending)
  const bits: ReactNode[] = []
  if (scan.scannedBy !== me) bits.push(<span key="by" className="font-semibold">Scanned by {scan.userName || "someone else"}</span>)
  if (scan.message) bits.push(<span key="m">{scan.message}</span>)
  if (scan.note) bits.push(<span key="n">Note: {scan.note}</span>)
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2 min-w-0">
        <p className={`${mono} min-w-0 flex-1 text-base font-bold leading-snug [overflow-wrap:anywhere]`}>
          {scan.item} <span aria-hidden className="font-normal text-gray-400">→</span><span className="sr-only">to</span> {scan.location}
        </p>
        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold leading-tight ${chip.tone}`}>{chip.text}</span>
      </div>
      <p className={`mt-0.5 text-[13px] leading-snug text-gray-600 dark:text-gray-400 ${problem ? "break-words" : "truncate"}`}>
        <span className="tabular-nums">{clock(scan.scannedAt)}</span>
        {bits.map((b, i) => <span key={i}> · {b}</span>)}
      </p>
      {problem && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {scan.status === "stale" && (
            <button type="button" className={`${btn} flex-1 basis-40`} onClick={() => void ctl.moveAnyway(scan.id)}>Move it to {scan.location} anyway</button>
          )}
          <button type="button" className={`${btn} flex-1 basis-24`} onClick={() => void ctl.dismiss(scan.id)}>Dismiss</button>
        </div>
      )}
    </li>
  )
}

/** Refused and stale scans, until dismissed. Shown on every screen (the top bar's red pill scrolls here). */
export function ProblemList({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  if (!s.problems.length) return null
  return (
    <section id={NEED_A_LOOK_ID} className={`${card} scroll-mt-2 overflow-hidden border-red-400 dark:border-red-700`} aria-label="Scans that need a look">
      <div className="px-3 pt-2.5">
        <h2 className={`${cardTitle} text-red-700 dark:text-red-300`}>Need a look ({s.problems.length})</h2>
        <p className={muted}>The Hub didn&apos;t do these. Each stays until you dismiss it.</p>
      </div>
      <ul className="divide-y divide-gray-200 dark:divide-gray-800">
        {s.problems.map(p => <ScanRow key={p.id} scan={p} sending={false} me={ctl.me.id} ctl={ctl} problem />)}
      </ul>
    </section>
  )
}

/** The newest scans on this scanner. */
export function RecentList({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  return (
    <section className={`${card} overflow-hidden`} aria-label="Recent scans">
      <h2 className={`${cardTitle} px-3 pt-2.5`}>Recent scans</h2>
      {s.recent.length === 0 ? (
        <p className={`${muted} px-3 pb-3 pt-1`}>No moves scanned on this scanner yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {s.recent.map(r => <ScanRow key={r.id} scan={r} sending={s.sendingIds.has(r.id)} me={ctl.me.id} ctl={ctl} />)}
        </ul>
      )}
    </section>
  )
}

/** Refused and stale scans (until dismissed), then the newest scans. */
export function ScanLists({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  return (
    <div className="space-y-3">
      <ProblemList s={s} ctl={ctl} />
      <RecentList s={s} ctl={ctl} />
    </div>
  )
}

/** A row of small buttons that share the width and wrap; an opened panel in it takes the whole row. */
export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

/**
 * For a label that won't scan: type the code. It goes through exactly the same handling as a scan.
 * Put it in an ActionRow (closed it is one button of the row; open it takes the whole row).
 */
export function TypeCode({ ctl, placeholder = "e.g. T027657 or A10A1" }: { ctl: ScanController; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  if (!open) {
    return <button type="button" className={`${btn} flex-1 basis-36`} onClick={() => setOpen(true)}>Type a code</button>
  }
  const go = () => {
    const v = text.trim()
    if (!v) return
    setText("")
    ctl.scan(v, "typed")
    // Let the on-screen keyboard close (it covers half a small screen) and the scan box have the
    // cursor back for the next real scan. The box stays open for a second code.
    try { (document.activeElement as HTMLElement | null)?.blur?.() } catch { /* ignore */ }
  }
  return (
    <div className={`${card} basis-full min-w-0 p-3 space-y-2`}>
      <label htmlFor="scan-typed" className="block text-[13px] font-semibold text-gray-700 dark:text-gray-200">Label won&apos;t scan? Type the code from it</label>
      <div className="flex gap-2">
        <input
          id="scan-typed"
          className={`${field} ${mono} uppercase`}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); go() } }}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          autoFocus
        />
        <button type="button" className="min-h-11 shrink-0 rounded-xl bg-indigo-600 px-4 text-base font-bold text-white disabled:opacity-40" onClick={go} disabled={!text.trim()}>Go</button>
      </div>
      <button type="button" className={`${btn} w-full`} onClick={() => { setOpen(false); setText("") }}>Close</button>
    </div>
  )
}
