import type { Metadata, Viewport } from "next"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { logAccessDenied, type DeniedDbSnapshot } from "@/lib/access-log"
import { getGoodsInUser, type GoodsInUser } from "@/lib/goods-in/access"
import NoAccess from "./no-access"

// The handheld scanner — its own full-screen shell (no Hub top bar or sidebar), for the Newland
// scanners (in the Vectis Scanner app) and any phone or browser with a keyboard-style scanner.
//
// Its door is Goods In's: getGoodsInUser() — the Warehouse tier read FRESH from the database for the
// EFFECTIVE session, the same as app/(app)/tools/warehouse/layout.tsx. Someone turned away is
// written to the Access Log first (before anything else), then shown a plain message with a way to
// sign in as someone else — not bounced to /hub, because on a shared scanner the next person
// signing in is the way forward. The login gate itself is proxy.ts's, unchanged.
//
// `hub-shell` gives the page canvas the Hub's dark colour (app/globals.css), so the overscroll
// bounce never flashes white.

export const metadata: Metadata = { title: "Scanner" }
export const viewport: Viewport = { themeColor: "#141416" }
export const dynamic = "force-dynamic"

function Shell({ children, useCache = false }: { children: React.ReactNode; useCache?: boolean }) {
  return (
    <div
      className="hub-shell fixed inset-0 flex flex-col overflow-hidden bg-gray-50 dark:bg-[#141416] text-gray-900 dark:text-gray-100"
      {...(useCache ? { "data-scan-use-cache": "1" } : {})}
    >
      {children}
    </div>
  )
}

export default async function ScannerLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")

  let user: GoodsInUser | null = null
  let readFailed: string | null = null
  try {
    user = await getGoodsInUser()
  } catch (e) {
    readFailed = String((e as { message?: string })?.message ?? e).slice(0, 160)
  }

  if (readFailed) {
    // The Hub couldn't check access (the database didn't answer). The service worker swaps this page
    // for its saved copy of the scanner when it has one (data-scan-use-cache), so scans can carry on.
    console.error("scanner layout: couldn't read access:", readFailed)
    return (
      <Shell useCache>
        <div className="mx-auto w-full max-w-md px-4 py-6 space-y-4">
          <div className="rounded-2xl bg-red-600 px-5 py-4 text-white">
            <p className="text-xl font-bold">The Hub couldn&apos;t check your access just now</p>
            <p className="mt-1 text-base">Try again in a moment. ({readFailed})</p>
          </div>
          {/* A full page load (not a client navigation), so the service worker can step in. */}
          <form method="get" action="/scan">
            <button type="submit" className="inline-flex w-full min-h-14 items-center justify-center rounded-2xl bg-indigo-600 px-5 text-lg font-bold text-white">Try again</button>
          </form>
        </div>
      </Shell>
    )
  }

  if (!user) {
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
        <div className="flex-1 overflow-y-auto">
          <NoAccess name={session.user.name || session.user.email || "This account"} />
        </div>
      </Shell>
    )
  }

  return <Shell>{children}</Shell>
}
