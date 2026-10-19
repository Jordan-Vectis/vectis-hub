import type { Metadata, Viewport } from "next"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession, type EffectiveSession } from "@/lib/impersonation"
import { logAccessDenied, type DeniedDbSnapshot } from "@/lib/access-log"
import type { ScanWho } from "@/lib/goods-in/scanner-pass"
import CardSignIn from "./card-sign-in"
import NoAccess from "./no-access"
import { canvas, safeArea } from "./ui"
import { scanWho } from "./who"

// The handheld scanner — its own full-screen shell (no Hub top bar or sidebar), for the Newland
// scanners (in the Vectis Scanner app) and any phone or browser with a keyboard-style scanner.
//
// ⚠ /scan is let through the Hub's login gate (auth.config.ts, exact path) because the scanners have
// no keyboard: someone signs in HERE, by scanning their sign-in card. So this layout does its own
// sign-in check, and nothing of the scanner renders until it passes. Who is scanning is scanWho()
// (lib/goods-in/scanner-pass.ts): the Hub login with Goods In access if there is one — the Warehouse
// tier read FRESH from the database for the EFFECTIVE session, as app/(app)/tools/warehouse/layout.tsx
// — otherwise a scanner sign-in card's session (cookie checked, card not cancelled, its person still
// has Warehouse access, all read fresh).
//   · Nobody signed in → "Scan your sign-in card" (card-sign-in.tsx), and nothing else.
//   · A Hub login without Goods In access → written to the Access Log first (before anything else),
//     then a plain message with the card sign-in underneath — not bounced to /hub, because on a
//     shared scanner the next person signing in is the way forward.
//   · A card whose person has lost access → the same message, for the card.
//
// `hub-shell` gives the page canvas the Hub's dark colour (app/globals.css), so the overscroll
// bounce never flashes white.
//
// The shell is one full-height column (fixed to the viewport, so it is exactly the screen's height
// whatever 100vh means on that browser), kept clear of the status bar, notch and gesture bar by the
// safe-area insets (viewport-fit=cover). Base text is 15px — the scanners' screens are small (as
// little as 320 × 568); everything is sized in ui.ts. "resizes-content": the on-screen keyboard (Type
// a code, the note, signing in) shrinks the column instead of covering half of it.
// ⚠ No maximum-scale / user-scalable=no: RULES.md (design rule 5) forbids stopping people zooming.

export const metadata: Metadata = { title: "Scanner" }
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#141416",
}
export const dynamic = "force-dynamic"

function Shell({ children, useCache = false }: { children: React.ReactNode; useCache?: boolean }) {
  return (
    <div
      className={`hub-shell fixed inset-0 flex flex-col overflow-hidden text-[15px] leading-snug ${canvas} ${safeArea}`}
      {...(useCache ? { "data-scan-use-cache": "1" } : {})}
    >
      {children}
    </div>
  )
}

const said = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 160)

export default async function ScannerLayout({ children }: { children: React.ReactNode }) {
  let who: ScanWho | null = null
  let session: EffectiveSession | null = null
  let readFailed: string | null = null
  try {
    who = await scanWho()
    // Turned away: by the Hub login (logged below), or by a card?
    if (!who.user && who.why === "no-access") session = await getEffectiveSession()
  } catch (e) {
    readFailed = said(e)
  }

  if (readFailed || !who) {
    // The Hub couldn't check access (the database didn't answer). The service worker swaps this page
    // for its saved copy of the scanner when it has one (data-scan-use-cache), so scans can carry on.
    console.error("scanner layout: couldn't read access:", readFailed)
    return (
      <Shell useCache>
        <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div className="rounded-xl bg-red-600 px-3 py-2.5 text-white">
            <p className="text-base font-bold leading-snug">The Hub couldn&apos;t check your access just now</p>
            <p className="mt-0.5 text-[14px] leading-snug break-words">Try again in a moment. ({readFailed ?? "no answer"})</p>
          </div>
          {/* A full page load (not a client navigation), so the service worker can step in. */}
          <form method="get" action="/scan">
            <button type="submit" className="inline-flex w-full min-h-12 items-center justify-center rounded-xl bg-indigo-600 px-4 text-base font-bold text-white">Try again</button>
          </form>
        </div>
      </Shell>
    )
  }

  if (who.user) return <Shell>{children}</Shell>

  if (who.why === "signed-out") {
    return (
      <Shell>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <CardSignIn mode="screen" current={null} />
        </div>
      </Shell>
    )
  }

  if (!session) {
    // A card session whose person no longer has Warehouse access (no Hub login on this device).
    return (
      <Shell>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <NoAccess name={null} via="card" />
        </div>
      </Shell>
    )
  }

  let dbUser: DeniedDbSnapshot | null = null
  let note: string | undefined
  try {
    const row = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, role: true, allowedApps: true, appPermissions: true },
    })
    if (row) {
      dbUser = { id: row.id, email: row.email, role: row.role, allowedApps: row.allowedApps }
      const perms = row.appPermissions as { WAREHOUSE?: { role?: string } } | null
      if (row.role !== "ADMIN" && row.allowedApps.includes("WAREHOUSE") && !perms?.WAREHOUSE?.role) {
        note = "Has the Warehouse app but no Warehouse tier (warehouse / manager / admin) is set."
      }
    }
  } catch (e) {
    note = `Couldn't re-read the user row for this log: ${String((e as { message?: string })?.message ?? e).slice(0, 200)}`
  }
  await logAccessDenied({
    appKey: "WAREHOUSE",
    source: "goods_in_scanner",
    session: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      isImpersonating: session.isImpersonating,
      adminId: session.adminId,
      adminName: session.adminName,
    },
    dbUser,
    note,
  })
  return (
    <Shell>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <NoAccess name={session.user.name || session.user.email || null} via="hub" />
      </div>
    </Shell>
  )
}
