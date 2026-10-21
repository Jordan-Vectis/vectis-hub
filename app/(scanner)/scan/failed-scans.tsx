"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import type { ScanController, Snapshot } from "@/lib/goods-in/scan-client/controller"
import { SCAN_ACK_PROBLEM_WORDS, type AckRecord } from "@/lib/goods-in/scan-client/types"
import { WarnIcon } from "./icons"
import { clock, mono, sheet } from "./ui"

// The failed-scan pop-up (Jack, 2026-10-21: rapid-scanning hundreds is fine, but one fails and
// nobody checks). Full screen over the scanner screen while any of this person's failed scans
// hasn't been acknowledged: what went wrong with each, in plain words, then one big button.
// The rules are ScanController's (raise / acknowledge / blockedScan) — this only shows them:
//   · While it is open NOTHING SCANNED IS USED — the controller adds each code to this list as "Not
//     taken" (with an error buzz) instead, so it is acknowledged too.
//   · "I've seen it — carry on" acknowledges every failure THIS render shows (one arriving a moment
//     later stays up). It must be a deliberate tap: never given the cursor, out of the Tab order, and
//     it takes no tap for a moment after the list changes (a tap meant for the screen underneath
//     mustn't land on it). Enter, Tab and Space are swallowed while this is open — a keyboard-style
//     scanner sends Enter after every code — and a click straight after a key is ignored.
//   · The reminder buzz every few seconds, and the alert as it opens, are the controller's.
//   · It says whose failures they are and that the button records that THEY have seen them — and,
//     when Switch user was pressed and held (s.switchHeld: the scanner may be in someone else's hands
//     after "Still …?"), that only that person should tap it. Reports must say who really saw them.
// Layers (scan-app.tsx): over Settings (z-30), under "Still …?" (z-40) and Switch user (z-50) — and
// not drawn while either of those is up. Sized for a 320px screen; the list scrolls inside it.

/** The colour of each failure's label (its words are the contract's SCAN_ACK_PROBLEM_WORDS — the same as Reports). Red: not done; amber: overtaken; grey: not used at all. */
const CHIP_TONE: Record<AckRecord["problem"], string> = {
  error: "bg-red-600 text-white",
  refused: "bg-red-600 text-white",
  stale: "bg-amber-400 text-black",
  blocked: "bg-gray-700 text-white",
}

/** Keys that could press a button. */
const PRESS_KEYS = new Set(["Enter", "Tab", " ", "Spacebar"])
/** How long the button ignores taps after the list changes. */
const ARM_MS = 700
/** A click this soon after a key, with no pointer behind it, came from the keyboard (a scanner), not a finger. */
const KEY_CLICK_MS = 1500

const ackBtn =
  "inline-flex w-full min-w-0 min-h-14 items-center justify-center rounded-xl px-4 py-2 text-[17px] font-extrabold leading-tight text-center bg-red-600 text-white active:bg-red-700 disabled:opacity-50 transition-colors"

/**
 * One failure: the barcode (big, monospace), what kind of failure in the Reports' words, what went
 * wrong in plain words, and when — scanned at (London, seconds), and for the Hub's answers where it
 * was going and when the answer came.
 */
function FailureRow({ f }: { f: AckRecord }) {
  const words = SCAN_ACK_PROBLEM_WORDS[f.problem]
  const when = [
    f.scannedAt ? `Scanned ${clock(f.scannedAt)}` : `At ${clock(f.shownAt)}`,
    f.answeredAt ? `Hub answered ${clock(f.answeredAt)}` : null,
  ].filter(Boolean).join(" · ")
  return (
    <li className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-white dark:bg-gray-900 px-3 py-2 min-w-0">
      {f.code
        ? <p className={`${mono} text-xl font-extrabold leading-tight [overflow-wrap:anywhere]`}>{f.code}</p>
        : <p className="text-[15px] font-bold leading-snug break-words">{f.title}</p>}
      <p className="mt-1">
        <span className={`inline-block max-w-full rounded-md px-1.5 py-0.5 text-[12px] font-bold leading-tight break-words ${CHIP_TONE[f.problem]}`}>{words}</span>
      </p>
      {f.code && f.title !== words && <p className="mt-1 text-[15px] font-bold leading-snug break-words">{f.title}</p>}
      {f.detail && <p className="mt-0.5 text-[13px] leading-snug text-gray-700 dark:text-gray-300 break-words">{f.detail}</p>}
      <p className="mt-0.5 text-[12px] leading-snug tabular-nums text-gray-600 dark:text-gray-400 break-words">{when}</p>
    </li>
  )
}

/** The one button. Re-mounted (key) whenever the list changes, so it re-arms. */
function AckButton({ ids, ctl, lastKeyAt }: { ids: string[]; ctl: ScanController; lastKeyAt: RefObject<number> }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), ARM_MS)
    return () => clearTimeout(t)
  }, [])
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={!armed}
      className={ackBtn}
      onClick={e => {
        // detail 0 = not a pointer (a key, or the page): ignored when a key came just before it.
        if (e.detail === 0 && Date.now() - lastKeyAt.current < KEY_CLICK_MS) return
        void ctl.acknowledge(ids)
      }}
    >
      I&apos;ve seen it — carry on
    </button>
  )
}

export function FailedScans({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  const list = s.failures
  const n = list.length
  const lastKeyAt = useRef(0)

  // While it is open: no key presses anything (a keyboard-style scanner ends each code with Enter or
  // Tab). Only the default action is stopped — the scanner's own box still reads the code (scanner.ts),
  // and the controller then adds it here as "Not taken".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      lastKeyAt.current = Date.now()
      if (PRESS_KEYS.has(e.key)) e.preventDefault()
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("keyup", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("keyup", onKey, true)
    }
  }, [])

  // A text box left with the cursor underneath (Type a code, the note) lets go of it: the on-screen
  // keyboard closes, and the next scan goes to the scanner's own box (which has inputMode "none").
  useEffect(() => {
    try {
      const a = document.activeElement
      if ((a instanceof HTMLInputElement && a.inputMode !== "none") || a instanceof HTMLTextAreaElement) a.blur()
    } catch { /* nothing had it */ }
  }, [])

  if (!n) return null
  const ids = list.map(f => f.id)
  const heading = n === 1 ? "This scan didn't go through" : `These ${n} scans didn't go through`
  const name = ctl.me.name
  const them = n === 1 ? "it" : "them"

  return (
    <div className={`${sheet} z-[35]`} role="alertdialog" aria-modal="true" aria-labelledby="scan-failed-title" aria-describedby="scan-failed-intro">
      <header className="shrink-0 bg-red-600 px-3 py-2.5 text-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <WarnIcon className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <h2 id="scan-failed-title" className="text-[19px] font-extrabold leading-tight break-words">{heading}</h2>
            <p id="scan-failed-intro" className="mt-0.5 text-[13px] font-medium leading-snug break-words">
              {name}, check {them} before you carry on — the button records that you&apos;ve seen {them}. Nothing you scan now is used.
            </p>
          </div>
        </div>
        {/* Read out as it opens (the cursor is never moved here). */}
        <p className="sr-only" role="alert">{heading}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        <ul className="mx-auto w-full max-w-xl space-y-2" aria-label="Scans that didn't go through">
          {list.map(f => <FailureRow key={f.id} f={f} />)}
        </ul>
      </div>

      <div className="shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 pt-2 pb-2.5">
        <div className="mx-auto w-full max-w-xl space-y-1.5">
          {/* Switch user was pressed and held (the scanner may be in someone else's hands now — "Still …?"):
              say whose these are, so nobody else taps them away under this person's name. */}
          {s.switchHeld && (
            <p role="alert" className="rounded-lg bg-amber-100 dark:bg-amber-950/70 px-2.5 py-1.5 text-[13px] font-semibold leading-snug text-amber-900 dark:text-amber-100 break-words">
              Switch user waits until {n === 1 ? "this is" : "these are"} answered. Not {name}? Only {name} should tap the button — it records that {name} has seen {them}.
            </p>
          )}
          <p className="text-[13px] leading-snug text-gray-700 dark:text-gray-300">
            Scan {them} again once this is closed{list.some(f => f.problem === "refused" || f.problem === "stale") ? " — the Hub's answers also stay in Need a look" : ""}.
          </p>
          <AckButton key={ids.join(",")} ids={ids} ctl={ctl} lastKeyAt={lastKeyAt} />
        </div>
      </div>
    </div>
  )
}
