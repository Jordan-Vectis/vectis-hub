"use client"

import { useState } from "react"
import { howFar, isAlreadyThere, type Banner, type ScanController, type Snapshot } from "@/lib/goods-in/scan-client/controller"
import type { StoredScan } from "@/lib/goods-in/scan-client/types"
import { bigBtn, btn, btnTall, card, clock, field, mono, plural } from "./ui"

// The pieces every scanner screen shares: the status bar, the big banner after each scan, the
// strips that say something is wrong with the set-up, the list of scans, "Type a code", and the
// "Still …?" question on a scanner that has lain unused.

/** The id of the "Need a look" list — the status bar's red button scrolls to it on whichever screen is open. */
export const NEED_A_LOOK_ID = "scan-need-a-look"

function scrollToNeedALook() {
  try { document.getElementById(NEED_A_LOOK_ID)?.scrollIntoView({ block: "start", behavior: "smooth" }) } catch { /* ignore */ }
}

const HUB_TONE: Record<string, string> = {
  production: "bg-emerald-600 text-white",
  staging: "bg-amber-400 text-black",
  sandbox: "bg-fuchsia-600 text-white",
  local: "bg-gray-500 text-white",
  other: "bg-gray-500 text-white",
}

/**
 * Always on screen: who, which Hub, online or not, how many waiting, Send now and Switch user — and,
 * while any scan needs a look, a red button to it (a refusal must not slip by once the next scan's
 * banner has replaced its own).
 */
export function StatusBar({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  const waiting = s.waitingMine
  const problem = s.sync.problem
  const net = !s.online ? { dot: "bg-red-500", word: "Offline" } : problem && problem.kind !== "offline" && waiting ? { dot: "bg-amber-400", word: "Not sending" } : { dot: "bg-emerald-500", word: "Online" }
  const switchBlocked = waiting > 0
  const looks = s.problems.length
  return (
    <header className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 pt-2 pb-2 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        {s.hub.label && <span className={`shrink-0 rounded-md px-2 py-1 text-sm font-bold uppercase tracking-wide ${HUB_TONE[s.hub.kind] ?? HUB_TONE.other}`}>{s.hub.label}</span>}
        <span className="min-w-0 flex-1 truncate text-base font-semibold" title={ctl.me.name}>{ctl.me.name}</span>
        <button
          type="button"
          className={`${btn} shrink-0 !min-h-14 !px-3 ${switchBlocked ? "opacity-70" : ""}`}
          onClick={() => void ctl.switchUser()}
          disabled={!s.started || s.switching === "sending"}
          aria-describedby={switchBlocked ? "switch-blocked" : undefined}
        >
          {s.switching === "sending" ? "Sending first…" : "Switch user"}
        </button>
      </div>
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex items-center gap-1.5 shrink-0 text-base font-bold">
          <span aria-hidden className={`inline-block h-3.5 w-3.5 rounded-full ${net.dot}`} />
          {net.word}
        </span>
        <span className={`min-w-0 flex-1 break-words text-base leading-tight ${waiting ? "font-bold text-amber-700 dark:text-amber-300" : "font-semibold text-gray-600 dark:text-gray-400"}`} id="switch-blocked">
          {s.sync.sending ? `Sending ${plural(waiting, "scan")}…` : waiting ? `${plural(waiting, "scan")} waiting` : "Nothing waiting"}
        </span>
        <button type="button" className={`${btn} shrink-0 !min-h-14 !px-3`} onClick={() => void ctl.sendNow()} disabled={s.sync.sending || !s.started}>
          Send now
        </button>
      </div>
      {waiting > 0 && problem && <p className="text-sm leading-snug text-amber-800 dark:text-amber-200">{problem.message}</p>}
      {looks > 0 && (
        <button type="button" onClick={scrollToNeedALook} className="w-full min-h-14 rounded-xl bg-red-600 px-4 text-lg font-bold text-white active:bg-red-700">
          {looks} {looks === 1 ? "scan needs" : "scans need"} a look ↓
        </button>
      )}
    </header>
  )
}

/** A shared scanner that has lain unused: who has it now? (Scans aren't used until it's answered.) */
export function StillYou({ name, ctl }: { name: string; ctl: ScanController }) {
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-gray-50 dark:bg-[#141416]" role="dialog" aria-modal="true" aria-labelledby="scan-still-you">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-4 px-4 py-6">
        <h2 id="scan-still-you" className="text-3xl font-extrabold leading-tight break-words">Still {name}?</h2>
        <p className="text-lg leading-snug">This scanner hasn&apos;t been used for a while. Every scan is recorded against {name} — if that isn&apos;t you, switch user first.</p>
        <button type="button" className={bigBtn} onClick={ctl.stillMe}>Yes, it&apos;s me</button>
        <button type="button" className={`${btnTall} w-full`} onClick={ctl.notMe}>Switch user</button>
      </div>
    </div>
  )
}

const BANNER_TONE: Record<Banner["tone"], string> = {
  ok: "bg-emerald-600 text-white",
  warn: "bg-amber-400 text-black",
  error: "bg-red-600 text-white",
  info: "bg-white text-gray-900 border-2 border-dashed border-gray-300 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700",
}

/** The full-width answer to the last scan: green done, amber read this, red not done. */
export function BannerView({ banner, prompt, ctl }: { banner: Banner | null; prompt: string; ctl: ScanController }) {
  if (!banner) {
    return (
      <div role="status" aria-live="polite" className={`rounded-2xl px-4 py-4 min-h-24 flex items-center ${BANNER_TONE.info}`}>
        <p className="text-xl font-semibold leading-snug">{prompt}</p>
      </div>
    )
  }
  return (
    <div role={banner.tone === "error" ? "alert" : "status"} aria-live="assertive" className={`rounded-2xl px-4 py-4 min-h-24 ${BANNER_TONE[banner.tone]}`}>
      <p className="text-2xl font-extrabold leading-tight break-words">{banner.title}</p>
      {banner.detail && <p className="mt-1.5 text-base leading-snug font-medium">{banner.detail}</p>}
      {banner.actions.length > 0 && (
        <div className="mt-3 grid gap-2">
          {banner.actions.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => ctl.bannerAction(a.id)}
              className="min-h-14 rounded-xl bg-black/80 px-4 text-lg font-bold text-white active:bg-black"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {banner.tone !== "info" && banner.actions.length === 0 && <p className="mt-2 text-sm font-semibold opacity-90">Next: {prompt}</p>}
    </div>
  )
}

/** Plain-words strips for things that are wrong with the set-up, not with one scan. */
export function Strips({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  const items: { tone: "red" | "amber" | "grey"; text: string; action?: { label: string; run: () => void } }[] = []
  if (s.userMismatch) items.push({ tone: "red", text: `This scanner is now signed in as ${s.userMismatch} (in another window or the sign-in page). Reload so scans are recorded against the right person.`, action: { label: "Reload", run: () => window.location.reload() } })
  if (s.sync.problem?.kind === "signed-out" && s.waitingMine) items.push({ tone: "red", text: `You've been signed out. Sign in again as ${ctl.me.name} to send the ${plural(s.waitingMine, "waiting scan")}.`, action: { label: "Sign in", run: () => ctl.signInAgain() } })
  if (s.fromCache) items.push({ tone: "grey", text: "Opened from this scanner's saved copy — the Hub couldn't be reached. Moves are saved here and sent when the Wi-Fi is back." })
  if (s.notice) items.push({ tone: "amber", text: `${s.notice} Scans are kept on this scanner until then.` })
  if (s.storeKind === "memory") items.push({ tone: "red", text: "This scanner can't save scans on the device — they'd be lost if the page closed. Stay on Wi-Fi so each one is sent straight away." })
  if (s.clockOffMs !== null) items.push({ tone: "red", text: `This scanner's clock is ${howFar(s.clockOffMs)} ${s.clockOffMs > 0 ? "slow" : "fast"}. Scans are stamped with the Hub's time instead, but set the scanner's Date & time to automatic (Settings → System → Date & time).` })
  for (const o of s.waitingOthers) items.push({ tone: "amber", text: `${plural(o.n, "scan")} by ${o.name} ${o.n === 1 ? "is" : "are"} still waiting. Only ${o.name} can send ${o.n === 1 ? "it" : "them"} — they sign in on this scanner and press Send now.` })
  if (s.locationsAt !== null && s.locationCount === 0 && s.online) items.push({ tone: "amber", text: "The Hub has no Goods In locations yet, so nothing can be put away. A Warehouse manager adds them in Goods In → Locations." })
  if (!items.length) return null
  const tone = { red: "bg-red-600 text-white", amber: "bg-amber-400 text-black", grey: "bg-gray-700 text-white" }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className={`rounded-xl px-4 py-3 text-base font-medium leading-snug ${tone[it.tone]}`}>
          <p>{it.text}</p>
          {it.action && (
            <button type="button" onClick={it.action.run} className="mt-2 min-h-14 rounded-lg bg-black/80 px-5 text-lg font-bold text-white">{it.action.label}</button>
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

function ScanRow({ scan, sending, me, ctl, problem }: { scan: StoredScan; sending: boolean; me: string; ctl: ScanController; problem?: boolean }) {
  const chip = statusChip(scan, sending)
  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">{clock(scan.scannedAt)}</span>
        <span className={`${mono} min-w-0 truncate text-lg font-bold`}>{scan.item}</span>
        <span aria-hidden className="text-gray-400">→</span>
        <span className={`${mono} min-w-0 truncate text-lg font-bold`}>{scan.location}</span>
        <span className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${chip.tone}`}>{chip.text}</span>
      </div>
      {(scan.message || scan.scannedBy !== me || scan.note) && (
        <p className="mt-1 text-sm leading-snug text-gray-700 dark:text-gray-300 break-words">
          {scan.scannedBy !== me && <span className="font-semibold">Scanned by {scan.userName || "someone else"}. </span>}
          {scan.message}
          {scan.note && <span className="text-gray-500 dark:text-gray-400"> · Note: {scan.note}</span>}
        </p>
      )}
      {problem && (
        <div className="mt-2 flex flex-wrap gap-2">
          {scan.status === "stale" && (
            <button type="button" className={`${btnTall} flex-1`} onClick={() => void ctl.moveAnyway(scan.id)}>Move it to {scan.location} anyway</button>
          )}
          <button type="button" className={`${btnTall} flex-1`} onClick={() => void ctl.dismiss(scan.id)}>Dismiss</button>
        </div>
      )}
    </li>
  )
}

/** Refused and stale scans, until dismissed. Shown on every screen (the status bar's red button scrolls here). */
export function ProblemList({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  if (!s.problems.length) return null
  return (
    <section id={NEED_A_LOOK_ID} className={`${card} scroll-mt-2 overflow-hidden border-red-400 dark:border-red-700`} aria-label="Scans that need a look">
      <h2 className="px-3 pt-3 text-lg font-bold text-red-700 dark:text-red-300">Need a look ({s.problems.length})</h2>
      <p className="px-3 text-sm text-gray-600 dark:text-gray-400">The Hub didn&apos;t do these. Each stays here until you dismiss it.</p>
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
      <h2 className="px-3 pt-3 text-lg font-bold">Recent scans</h2>
      {s.recent.length === 0 ? (
        <p className="px-3 py-6 text-center text-base text-gray-500 dark:text-gray-400">No moves scanned on this scanner yet.</p>
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
    <div className="space-y-4">
      <ProblemList s={s} ctl={ctl} />
      <RecentList s={s} ctl={ctl} />
    </div>
  )
}

/** For a label that won't scan: type the code. It goes through exactly the same handling as a scan. */
export function TypeCode({ ctl, placeholder = "e.g. T027657 or A10A1" }: { ctl: ScanController; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  if (!open) {
    return <button type="button" className={`${btn} w-full`} onClick={() => setOpen(true)}>Label won&apos;t scan? Type the code</button>
  }
  const go = () => {
    const v = text.trim()
    if (!v) return
    setText("")
    ctl.scan(v, "typed")
    // Let the on-screen keyboard close (it covers half a 4" screen) and the scan box have the cursor
    // back for the next real scan. The box stays open for a second code.
    try { (document.activeElement as HTMLElement | null)?.blur?.() } catch { /* ignore */ }
  }
  return (
    <div className={`${card} p-3 space-y-2`}>
      <label htmlFor="scan-typed" className="block text-sm font-semibold text-gray-700 dark:text-gray-200">Type the code from the label</label>
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
        <button type="button" className="min-h-14 shrink-0 rounded-xl bg-indigo-600 px-5 text-lg font-bold text-white disabled:opacity-40" onClick={go} disabled={!text.trim()}>Go</button>
      </div>
      <button type="button" className={`${btnTall} w-full`} onClick={() => { setOpen(false); setText("") }}>Close</button>
    </div>
  )
}
