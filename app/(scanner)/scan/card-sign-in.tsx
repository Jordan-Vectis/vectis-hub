"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { isCardCode, looksLikeCard, signInWithCard } from "@/lib/goods-in/scan-client/card"
import { tidyCode } from "@/lib/goods-in/scan-client/device"
import { signal, unlockSound, type Sound } from "@/lib/goods-in/scan-client/feedback"
import { startScanner } from "@/lib/goods-in/scan-client/scanner"
import { finishCardSignIn, signOutOfScanner } from "./session"
import SignInPanel from "./sign-in"
import { QrIcon } from "./icons"
import { btn, btnTall, muted } from "./ui"

// "Scan your sign-in card" — how someone signs in on the handheld scanner, which has no keyboard.
// A sign-in card is a printed QR code (Goods In → Scanner cards); scanning it signs that person in to
// the SCANNER only, never the rest of the Hub (lib/goods-in/scan-client/card.ts). A username and
// password still works, behind "Sign in with username and password instead".
//
// Two places use it:
//   · mode "screen" — the whole /scan page while nobody the scanner can take is signed in (the
//     layout shows nothing else). It listens for scans itself: the scanner app's own scans and
//     keyboard-style ones, the same ways as the scanner screen (scanner.ts).
//   · mode "switch" — Switch user, over the scanner screen. That screen's scanner is still running
//     (one listener per page) and hands every scan over through `connect` while this is open.
//
// ⚠ The card's code is a secret: it is sent once, in the body of the sign-in call, and never shown,
// logged or kept. Nothing here marks the page data-scan-ready, so the service worker never saves it.

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "error"; message: string }
  | { kind: "done"; name: string }

const SOUND_KEY = "vectis-scan-sound"
const VIBRATE_KEY = "vectis-scan-vibrate"
/** The same refused card scanned again this soon gets the same answer without asking the Hub again. */
const SAME_REFUSAL_MS = 10_000

/** Beep and buzz as Settings → Sound & alerts says (both on until someone turns them off). */
function beepIf(tone: Sound) {
  let sound = true
  let vibrate = true
  try {
    sound = localStorage.getItem(SOUND_KEY) !== "0"
    vibrate = localStorage.getItem(VIBRATE_KEY) !== "0"
  } catch { /* default: on */ }
  signal(tone, sound, vibrate)
}

export default function CardSignIn({ mode, current, eyebrow, title = "Scan your sign-in card", intro, notice, onCancel, beforeLeave, connect }: {
  mode: "screen" | "switch"
  /** Who is signed in now: a Hub login ("hub" — ended once a card is accepted), a card, or nobody. */
  current: "hub" | "card" | null
  eyebrow?: string
  title?: string
  intro?: string
  /** Shown above everything (e.g. why the account signed in can't use the scanner). */
  notice?: ReactNode
  onCancel?: () => void
  beforeLeave?: () => Promise<void> | void
  /** mode "switch": the scanner screen hands its scans to `take` until the function returned is called. */
  connect?: (take: (code: string) => void) => () => void
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [password, setPassword] = useState(false)
  const [out, setOut] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const busy = useRef(false)
  const box = useRef<HTMLInputElement>(null)
  // The last card the Hub turned away (in memory only, for SAME_REFUSAL_MS): someone pressing the
  // trigger again and again on a cancelled card mustn't send it each time — every scanner in the
  // warehouse shares one address, and the Hub tells an address that sends too many bad cards to wait.
  const refused = useRef<{ code: string; at: number; message: string } | null>(null)

  const take = useCallback((raw: string) => {
    const code = tidyCode(raw)
    if (!code || busy.current) return
    const last = refused.current
    if (last && last.code === code && Date.now() - last.at < SAME_REFUSAL_MS) {
      setStatus({ kind: "error", message: last.message })
      beepIf("error")
      return
    }
    refused.current = null
    if (!isCardCode(code)) {
      setStatus({
        kind: "error",
        message: looksLikeCard(code)
          ? "That card came through in capital letters, so it can't be checked. Set the scanner to send letters as they are (not all capitals), then scan it again."
          : "That isn't a sign-in card. Scan the QR code on your Vectis Scanner sign-in card.",
      })
      beepIf("error")
      return
    }
    busy.current = true
    setStatus({ kind: "checking" })
    void (async () => {
      const r = await signInWithCard(code)
      if (!r.ok) {
        if (r.kind === "refused" || r.kind === "no-access" || r.kind === "too-many") refused.current = { code, at: Date.now(), message: r.message }
        busy.current = false
        setStatus({ kind: "error", message: r.message })
        beepIf("error")
        return
      }
      setStatus({ kind: "done", name: r.name })
      beepIf("ok")
      const problem = await finishCardSignIn(current === "hub", beforeLeave)
      if (problem) {
        busy.current = false
        setStatus({ kind: "error", message: problem })
        beepIf("error")
      }
    })()
  }, [current, beforeLeave])

  // mode "screen": this page's own scanner.
  useEffect(() => {
    if (mode !== "screen") return
    return startScanner({ input: box.current, onScan: code => take(code) })
  }, [mode, take])

  // mode "switch": the scanner screen's scanner.
  useEffect(() => {
    if (mode !== "switch" || !connect) return
    return connect(take)
  }, [mode, connect, take])

  const signOutNow = async () => {
    if (out.busy) return
    unlockSound()
    setOut({ busy: true, error: null })
    const r = await signOutOfScanner()
    if (!r.ok) setOut({ busy: false, error: r.message })
  }

  const Heading = mode === "screen" ? "h1" : "h2"

  return (
    <div className="mx-auto w-full max-w-md px-4 py-4 space-y-3">
      {mode === "screen" && (
        // The box keyboard-style scanners type into (as on the scanner screen): no on-screen keyboard,
        // out of the way, given the cursor back whenever nothing else is being typed in. Letters as
        // they are — a card's code is case-sensitive.
        <input
          ref={box}
          aria-label="Scanner input"
          inputMode="none"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
        />
      )}

      {notice}

      {password ? (
        <>
          <SignInPanel title="Sign in with username and password" onCancel={() => setPassword(false)} beforeLeave={beforeLeave} />
          {status.kind !== "idle" && <StatusBox status={status} />}
          <p className={muted}>Or scan your sign-in card — it works here too.</p>
        </>
      ) : (
        <>
          <div>
            {(eyebrow ?? (mode === "screen" ? "Vectis Scanner" : null)) && (
              <p className="text-[12px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400 break-words">{eyebrow ?? "Vectis Scanner"}</p>
            )}
            <Heading className="text-xl font-extrabold leading-tight text-gray-900 dark:text-white break-words">{title}</Heading>
            <p className="mt-1 text-[15px] leading-snug text-gray-700 dark:text-gray-300">
              {intro ?? "Point the scanner at the QR code on your Vectis Scanner sign-in card."}
            </p>
          </div>
          <StatusBox status={status} />
          <button type="button" className={`${btnTall} w-full`} onClick={() => { unlockSound(); setPassword(true) }} disabled={status.kind === "checking" || status.kind === "done"}>
            Sign in with username and password instead
          </button>
        </>
      )}

      {(onCancel || current) && (
        <div className="grid gap-2">
          {onCancel && <button type="button" className={`${btnTall} w-full`} onClick={onCancel} disabled={status.kind === "checking" || status.kind === "done" || out.busy}>Cancel</button>}
          {current && (
            <button type="button" className={`${btn} w-full`} onClick={() => void signOutNow()} disabled={out.busy || status.kind === "checking" || status.kind === "done"}>
              {out.busy ? "Signing out…" : "Sign out"}
            </button>
          )}
          {out.error && <p role="alert" className="rounded-lg bg-red-600 px-3 py-2 text-[14px] font-semibold text-white break-words">{out.error}</p>}
        </div>
      )}

      <p className={muted}>
        No card? Anyone in Goods In can print their own in the Hub: Goods In → Scanner cards. A card only signs in to the scanner. Lost one? Cancel it there.
      </p>
    </div>
  )
}

function StatusBox({ status }: { status: Status }) {
  if (status.kind === "checking") {
    return (
      <div role="status" className="rounded-xl bg-indigo-600 px-3 py-3 text-white">
        <p className="text-[17px] font-extrabold leading-tight">Checking the card…</p>
      </div>
    )
  }
  if (status.kind === "done") {
    return (
      <div role="status" className="rounded-xl bg-emerald-600 px-3 py-3 text-white">
        <p className="text-[17px] font-extrabold leading-tight break-words">Signed in — hello, {status.name}</p>
        <p className="mt-0.5 text-[14px] font-medium">Opening the scanner…</p>
      </div>
    )
  }
  if (status.kind === "error") {
    return (
      <div role="alert" className="rounded-xl bg-red-600 px-3 py-3 text-white">
        <p className="text-[17px] font-extrabold leading-tight break-words">{status.message}</p>
        <p className="mt-1 text-[14px] font-medium">Scan a card again, or sign in with your username and password.</p>
      </div>
    )
  }
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3">
      <QrIcon className="h-10 w-10 shrink-0 text-gray-700 dark:text-gray-200" />
      <p className="min-w-0 text-[17px] font-semibold leading-snug">Waiting for a card…</p>
    </div>
  )
}
