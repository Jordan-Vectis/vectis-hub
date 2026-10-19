"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { ScanController, type Me, type Snapshot } from "@/lib/goods-in/scan-client/controller"
import { startScanner } from "@/lib/goods-in/scan-client/scanner"
import CardSignIn from "./card-sign-in"
import { BannerView, StillYou, Strips, TopBar } from "./parts"
import { CheckBar, CheckScreen, FindScreen, HomeScreen, MoveScreen } from "./screens"
import { SettingsPanel } from "./settings"
import { sheet } from "./ui"

// The handheld scanner screen. All the rules live in ScanController
// (lib/goods-in/scan-client/controller.ts); this renders its snapshot. Laid out for a SMALL portrait
// screen (320–360px wide) as one full-height column that nothing can overlap:
//   1. the slim top bar (title, back, status pill, settings cog) — fixed height, shrink-0
//   2. the banner answering the last scan — shrink-0
//   3. the screen itself — the only part that scrolls (flex-1 min-h-0)
//   4. Check's Finish row — shrink-0, part of the column, never floating over it
// Everything that isn't scanning (who, Switch user, Sign out, Send now, which Hub, sound…) is behind
// the cog (settings.tsx).
//
// ⚠ The banner sits OUTSIDE the scrolling part, so the answer to every scan is on screen however far
// down the lists someone has scrolled (it scrolls inside itself if it's ever taller than ~40% of the
// screen). Don't move it into <main>.
//
// `data-scan-ready` marks this as the real scanner screen — the service worker only keeps a copy of a
// page that carries it (never the sign-in page or a "no access" message).

function promptFor(s: Snapshot): string {
  switch (s.screen) {
    case "home": return "Scan a tote, pallet or lot to move it — or choose below."
    case "move":
      if (s.pinned) return `Scan the next item for ${s.pinned.code} — or press Done.`
      if (s.pending) return `Scan where ${s.pending} is going.`
      return "Scan a tote, pallet or lot — or a location first."
    case "find": return s.online ? "Scan anything to find it." : "Find needs the Wi-Fi."
    case "check":
      if (!s.check || s.check.status === "failed") return "Scan the location you're checking."
      return `Scan everything on ${s.check.place.code}.`
  }
}

const TITLES = { home: "Vectis Scanner", move: "Put away / Move", find: "Find", check: "Check a location" } as const

export default function ScanApp({ me, build = null }: { me: Me; build?: string | null }) {
  const [ctl] = useState(() => new ScanController(me))
  const s = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getServerSnapshot)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const scanBox = useRef<HTMLInputElement>(null)
  // While Switch user is open, scans go to its card sign-in instead of the screen (one scanner per page).
  const cardTake = useRef<((code: string) => void) | null>(null)
  const connectCard = useCallback((take: (code: string) => void) => {
    cardTake.current = take
    return () => { if (cardTake.current === take) cardTake.current = null }
  }, [])

  useEffect(() => {
    ctl.start()
    return () => ctl.stop()
  }, [ctl])

  useEffect(() => {
    return startScanner({
      input: scanBox.current,
      onScan: (code, source) => {
        if (ctl.getSnapshot().switching === "open") {
          cardTake.current?.(code)
          return
        }
        // A scan while Settings is open: close it, so the answer to the scan is what's on screen.
        setSettingsOpen(false)
        ctl.scan(code, source)
      },
      // Not paused while Switch user is open: the next person's card is scanned there.
      isPaused: () => ctl.getSnapshot().stillYou,
      onIgnored: code => ctl.ignored(code),
      onMode: mode => ctl.setScannerMode(mode),
    })
  }, [ctl])

  // The app's Back button closes Settings first (ScanController's own Back handling comes after it —
  // unless "Still …?" or Switch user is up over Settings, which answer Back themselves).
  // In a plain browser (Chrome on the scanner) the phone's Back is a popstate instead, which the
  // controller answers by changing the screen underneath — so Settings closes on that too, rather
  // than staying open over a screen that has moved. (Settings deliberately pushes no history entry
  // of its own: it would tangle with the controller's one "away from Home" entry.)
  useEffect(() => {
    if (!settingsOpen) return
    const onBack = (e: Event) => {
      const now = ctl.getSnapshot()
      if (now.stillYou || now.switching === "open") return
      e.preventDefault()
      e.stopImmediatePropagation()
      setSettingsOpen(false)
    }
    const onPop = () => setSettingsOpen(false)
    window.addEventListener("vectis:back", onBack, { capture: true })
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener("vectis:back", onBack, { capture: true })
      window.removeEventListener("popstate", onPop)
    }
  }, [settingsOpen, ctl])

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  return (
    <div data-scan-ready="1" className="flex min-h-0 flex-1 flex-col">
      {/* The box keyboard-style scanners type into: no on-screen keyboard (inputMode none), out of
          the way, and given the cursor back whenever nothing else is being typed in. Letters as they
          are (codes are upper-cased in ScanController.scan) — a sign-in card's code is case-sensitive. */}
      <input
        ref={scanBox}
        aria-label="Scanner input"
        inputMode="none"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        tabIndex={-1}
        className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
      />

      <TopBar title={TITLES[s.screen]} onBack={s.screen !== "home" ? ctl.home : undefined} s={s} onSettings={openSettings} />

      <div className="shrink-0 max-h-[40vh] overflow-y-auto overscroll-contain px-3 pt-2">
        <div className="mx-auto w-full max-w-xl">
          <BannerView banner={s.banner} prompt={promptFor(s)} ctl={ctl} />
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-xl space-y-3 px-3 pt-2 pb-4">
          <Strips s={s} ctl={ctl} onSettings={openSettings} />
          {s.screen === "home" && <HomeScreen s={s} ctl={ctl} />}
          {s.screen === "move" && <MoveScreen s={s} ctl={ctl} />}
          {s.screen === "find" && <FindScreen s={s} ctl={ctl} />}
          {s.screen === "check" && <CheckScreen s={s} ctl={ctl} />}
        </div>
      </main>

      {s.screen === "check" && <CheckBar s={s} ctl={ctl} />}

      {settingsOpen && <SettingsPanel s={s} ctl={ctl} build={build} onClose={closeSettings} />}

      {s.stillYou && s.switching !== "open" && <StillYou name={me.name} ctl={ctl} />}

      {s.switching === "open" && (
        <div className={`${sheet} z-50`} role="dialog" aria-modal="true" aria-label="Switch user">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <CardSignIn
              mode="switch"
              current={me.via}
              connect={connectCard}
              eyebrow={s.sync.problem?.kind === "signed-out" && s.waitingMine ? `Sign in again, ${me.name}` : "Switch user"}
              intro={s.sync.problem?.kind === "signed-out" && s.waitingMine
                ? `Your ${s.waitingMine === 1 ? "scan is" : `${s.waitingMine} scans are`} waiting to be sent. Scan your own card (or sign in as yourself) to send them.`
                : "The next person scans their card. Whoever signs in now is recorded on every scan after this."}
              onCancel={ctl.cancelSwitch}
              beforeLeave={ctl.forgetForSwitch}
            />
          </div>
        </div>
      )}
    </div>
  )
}
