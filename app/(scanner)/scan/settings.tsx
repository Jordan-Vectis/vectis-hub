"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import type { ScanController, Snapshot } from "@/lib/goods-in/scan-client/controller"
import { unlockSound } from "@/lib/goods-in/scan-client/feedback"
import { isNativeApp } from "@/lib/goods-in/scan-client/native"
import { CloseIcon } from "./icons"
import { HUB_TONE, hubWords, netState } from "./parts"
import { signOutOfScanner } from "./session"
import { btn, btnTall, card, clock, iconBtn, muted, plural, sheet } from "./ui"

// Settings — the scanner's cog (top bar, right). Everything that ISN'T scanning lives here, so the
// scanning screens stay small: who is signed in and how, Switch user, Sign out, Send now with what's
// waiting and when it last sent, online or not, which Hub, sound, "Take scans straight from the
// scanner" (inside the app only), the screen's version, and a "Screen" line (size, pixel ratio,
// text scale) for telling us what a device's screen really is.
//
// A full-screen layer over the scanner screen (which stays mounted underneath, so nothing on it is
// lost). The rules are all ScanController's — this only calls them:
//   · Switch user is ctl.switchUser(): still blocked while this person's scans wait (it sends them
//     first). The panel closes as it's pressed, so its answer — the switch panel, or the banner
//     saying why not — is what shows next.
//   · Sign out is the same signOutOfScanner() the Switch user panel uses, and it is offered when
//     Switch user's panel would be: nothing of this person's waiting, or the Hub won't take their
//     waiting scans any more anyway (signed out / no access). Otherwise "send them first".
// A scan arriving while it is open closes it (scan-app.tsx), so the answer to the scan is seen.

const SCREEN_PROBE_PX = 20

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${card} overflow-hidden`} aria-label={title}>
      <h3 className="px-3 pt-2.5 pb-1 text-[12px] font-bold uppercase leading-snug tracking-wide text-gray-600 dark:text-gray-400">{title}</h3>
      <div className="divide-y divide-gray-200 dark:divide-gray-800">{children}</div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2.5 min-w-0">{children}</div>
}

function Switch({ on, label, hint, onClick }: { on: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} className="flex w-full min-h-12 items-center gap-3 px-3 py-2 text-left">
      <span className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-snug">{label}</span>
        <span className={`block ${muted}`}>{hint}</span>
      </span>
    </button>
  )
}

/** "360 × 640 · pixel ratio 2 · text 100%", read from the device itself. */
function readScreen(probe: HTMLElement | null): { size: string; app: string } {
  let size = ""
  try {
    const w = Math.round(window.innerWidth)
    const h = Math.round(window.innerHeight)
    const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100
    // The probe is SCREEN_PROBE_PX text with line-height 1, so its height is the size text is really
    // drawn at — bigger than asked when Android's font size (or the browser's text scaling) grows it.
    const drawn = probe ? probe.getBoundingClientRect().height : 0
    const scale = drawn > 0 ? Math.round((drawn / SCREEN_PROBE_PX) * 100) : null
    const base = parseFloat(getComputedStyle(document.documentElement).fontSize)
    size = `${w} × ${h} · pixel ratio ${dpr} · text ${scale === null ? "?" : `${scale}%`}${Number.isFinite(base) && Math.round(base) !== 16 ? ` · base ${Math.round(base)}px` : ""}`
  } catch {
    size = "Couldn't read"
  }
  let app = "A web browser"
  try {
    const m = /VectisScanner\/(\S+)/.exec(navigator.userAgent || "")
    if (m) app = `The Vectis Scanner app (${m[1]})`
    else if (isNativeApp()) app = "The Vectis Scanner app"
  } catch { /* a web browser */ }
  return { size, app }
}

export function SettingsPanel({ s, ctl, build, onClose }: { s: Snapshot; ctl: ScanController; build: string | null; onClose: () => void }) {
  const [out, setOut] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const [screen, setScreen] = useState<{ size: string; app: string }>({ size: "", app: "" })
  const probe = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const read = () => setScreen(readScreen(probe.current))
    const raf = requestAnimationFrame(read)
    window.addEventListener("resize", read)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", read)
    }
  }, [])

  const waiting = s.waitingMine
  const problem = s.sync.problem
  const net = netState(s)
  // The Hub won't take this person's waiting scans now, so they can't be sent first (scan-app's
  // Switch user opens straight away in this case too).
  const cantSend = problem?.kind === "signed-out" || problem?.kind === "no-access"
  const signOutBlocked = waiting > 0 && !cantSend

  const switchUser = () => {
    onClose()
    void ctl.switchUser()
  }

  const signOut = async () => {
    if (out.busy || signOutBlocked) return
    unlockSound()
    setOut({ busy: true, error: null })
    const r = await signOutOfScanner()
    if (!r.ok) setOut({ busy: false, error: r.message })
  }

  return (
    <div className={`${sheet} z-30`} role="dialog" aria-modal="true" aria-labelledby="scan-settings-title">
      <header className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <div className="flex min-h-12 items-center gap-0.5 px-1">
          <span aria-hidden className="w-2 shrink-0" />
          <h2 id="scan-settings-title" className="min-w-0 flex-1 truncate text-[17px] font-bold leading-tight">Settings</h2>
          <button type="button" className={iconBtn} onClick={onClose} aria-label="Close settings">
            <CloseIcon className="h-6 w-6" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-xl space-y-3 px-3 py-3">
          <Section title="Signed in">
            <Row>
              <p className="text-base font-bold leading-snug break-words">{ctl.me.name}</p>
              <p className={muted}>{ctl.me.via === "card" ? "With a sign-in card" : "With the Hub login"}</p>
            </Row>
            <Row>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={btn}
                  onClick={switchUser}
                  disabled={!s.started || s.switching === "sending" || out.busy}
                  aria-describedby={waiting > 0 ? "scan-settings-waiting" : undefined}
                >
                  {s.switching === "sending" ? "Sending first…" : "Switch user"}
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => void signOut()}
                  disabled={!s.started || out.busy || signOutBlocked || s.switching === "sending"}
                  aria-describedby={signOutBlocked ? "scan-settings-waiting" : undefined}
                >
                  {out.busy ? "Signing out…" : "Sign out"}
                </button>
              </div>
              {waiting > 0 && (
                <p id="scan-settings-waiting" className="mt-1.5 text-[13px] leading-snug text-amber-800 dark:text-amber-300">
                  {cantSend
                    ? `${plural(waiting, "scan")} of yours can't be sent until you sign in again.`
                    : `${plural(waiting, "scan")} of yours ${waiting === 1 ? "is" : "are"} waiting. Switch user sends ${waiting === 1 ? "it" : "them"} first; sign out once ${waiting === 1 ? "it's" : "they've"} gone.`}
                </p>
              )}
              {out.error && <p role="alert" className="mt-2 rounded-lg bg-red-600 px-3 py-2 text-[14px] font-semibold text-white">{out.error}</p>}
            </Row>
          </Section>

          <Section title="Sending">
            <Row>
              <div className="flex items-center gap-2 min-w-0">
                <span aria-hidden className={`inline-block h-3 w-3 shrink-0 rounded-full ${net.dot}`} />
                <span className="shrink-0 text-[15px] font-bold">{net.word}</span>
                <span className={`min-w-0 flex-1 text-right text-[15px] leading-snug ${waiting ? "font-bold text-amber-800 dark:text-amber-300" : "font-semibold text-gray-600 dark:text-gray-400"}`}>
                  {s.sync.sending ? `Sending ${plural(waiting, "scan")}…` : waiting ? `${plural(waiting, "scan")} waiting` : "Nothing waiting"}
                </span>
              </div>
              <p className={`mt-0.5 ${muted}`}>
                {s.sync.lastOkAt ? `Last sent at ${clock(s.sync.lastOkAt)}` : "Nothing sent since this screen opened."}
              </p>
              {waiting > 0 && problem && <p className="mt-1 text-[13px] leading-snug text-amber-800 dark:text-amber-200 break-words">{problem.message}</p>}
              <button type="button" className={`${btnTall} mt-2 w-full`} onClick={() => void ctl.sendNow()} disabled={s.sync.sending || !s.started}>
                {s.sync.sending ? "Sending…" : "Send now"}
              </button>
            </Row>
          </Section>

          <Section title="Hub">
            <Row>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px]">Scanning into</span>
                {s.hub.label
                  ? <span className={`rounded-md px-2 py-0.5 text-[13px] font-bold uppercase tracking-wide ${HUB_TONE[s.hub.kind] ?? HUB_TONE.other}`}>{hubWords(s.hub)}</span>
                  : <span className={muted}>Not known yet</span>}
              </div>
              {(s.hub.kind === "staging" || s.hub.kind === "sandbox") && <p className={`mt-1 ${muted}`}>A test Hub: moves scanned here don&apos;t reach the live one.</p>}
            </Row>
          </Section>

          <Section title="Sound & alerts">
            <Switch on={s.sound} label={`Sound: ${s.sound ? "on" : "off"}`} hint="A pip when a scan is taken, a low tone when it isn't." onClick={ctl.toggleSound} />
            <Switch on={s.vibrate} label={`Vibrate: ${s.vibrate ? "on" : "off"}`} hint="A short buzz when a scan is taken, a long one when it isn't." onClick={ctl.toggleVibrate} />
          </Section>

          <Section title="Scanner">
            {s.nativeAvailable !== null && (
              <Switch
                on={s.takeDirect}
                label="Take scans straight from the scanner"
                hint={s.takeDirect ? "On — scans come straight to this screen, never into the wrong box." : "Off — the scanner types like a keyboard (other apps work the same way)."}
                onClick={() => void ctl.toggleDirect()}
              />
            )}
            <Row>
              <p className={muted}>
                {s.scannerMode === "native" ? "Reading scans from the scanner app." : "Reading scans typed by the scanner (keyboard mode)."}{" "}
                {s.locationCount ? `${plural(s.locationCount, "location")} saved on this scanner for offline use.` : "No locations saved yet — they're saved the first time the scanner is online."}{" "}
                {s.storeKind === "localstorage" && "Scans are kept in this browser's local storage."}
                {s.persisted === false && s.storeKind !== "memory" && " This browser hasn't promised to keep them: if the device runs very short of space it could clear scans still waiting, so send them when you can."}
              </p>
            </Row>
          </Section>

          <Section title="About">
            <Row>
              <div className="relative">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] leading-snug">
                <dt className="text-gray-600 dark:text-gray-400">Screen version</dt>
                <dd className="font-mono break-words">{build || "Not known"}</dd>
                <dt className="text-gray-600 dark:text-gray-400">Running in</dt>
                <dd className="break-words">{screen.app || "…"}</dd>
                <dt className="text-gray-600 dark:text-gray-400">Screen</dt>
                <dd className="font-mono break-words">{screen.size || "…"}</dd>
              </dl>
              {/* What the "text" figure is measured from: invisible, out of the flow. */}
              <span ref={probe} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 inline-block whitespace-nowrap leading-none" style={{ fontSize: SCREEN_PROBE_PX }}>Mg</span>
              </div>
            </Row>
          </Section>
        </div>
      </div>
    </div>
  )
}
