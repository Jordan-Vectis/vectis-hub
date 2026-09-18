import { auth } from "@/auth"
import { redirect } from "next/navigation"
import TopBar from "@/components/top-bar"
import CrmSidebar from "@/components/crm-sidebar"
import AdminSidebar from "@/components/admin-sidebar"
import ImpersonationBanner from "@/components/impersonation-banner"
import AnnouncementBanner from "@/components/announcement-banner"
import PatchNotesPopup from "@/components/patch-notes-popup"
import ForceReloadListener from "@/components/force-reload-listener"
import MigrationBanner from "@/components/migration-banner"
import CrtMode from "@/components/crt-mode"
import TermsGate from "@/components/terms-gate"
import { getEffectiveSession } from "@/lib/impersonation"
import { prisma } from "@/lib/prisma"
import { TERMS_VERSION } from "@/lib/terms"
import { hasAppAccess, getAllowedSections } from "@/lib/apps"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect("/login")

  // Use effective session for display name (shows impersonated user's name in top bar)
  const effective = await getEffectiveSession()

  // iPad policy: block the app until the REAL logged-in user (not an impersonated one)
  // has signed the current policy version. Migration-safe: if the table doesn't exist
  // yet (before Run Migrations) this fails open so the app still loads.
  let needsTerms = false
  try {
    const accepted = await prisma.termsAcceptance.findUnique({
      where: { userId_version: { userId: session.user.id, version: TERMS_VERSION } },
      select: { id: true },
    })
    needsTerms = !accepted
  } catch { needsTerms = false }

  // Whether to show the Hub ⇄ Dashboard switch in the top bar. Same two checks
  // the Dashboard tab itself makes: the Manager Portal app, then the Dashboard
  // section within it. Failing open here would only put a link in the header
  // that bounces them, so it fails closed.
  let hasDashboard = false
  try {
    const u = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true, appPermissions: true },
    })
    if (u && hasAppAccess(u.role, u.allowedApps, "MANAGER_PORTAL")) {
      const sections = getAllowedSections(u.role, u.appPermissions as any, "MANAGER_PORTAL")
      hasDashboard = !sections || sections.includes("dashboard")
    }
  } catch { hasDashboard = false }

  return (
    // ⚠ Three things here are about phones (2026-09-18, "zooming in and out is really glitchy on
    // the entire hub"):
    //  · `hub-shell` is what globals.css keys the dark page canvas on — without it the area
    //    behind the app was pure white in dark mode.
    //  · `overflow-x-clip` is the backstop that stops anything wider than the phone widening the
    //    whole PAGE (the top bar used to, ~644px on a 375px screen, which is what let the page
    //    zoom out and slide sideways). CLIP, never hidden: clip creates no scroll container, so
    //    the h-full flex pages, the sticky banners and every dropdown behave exactly as before.
    //  · `max-sm:min-h-0`: min-h-screen is 100vh, which on a phone is taller than the visible
    //    screen, so the page scrolled by a toolbar's height on top of <main>. Phones only.
    <div className="hub-shell flex flex-col h-full min-h-screen max-sm:min-h-0 overflow-x-clip">
      <CrtMode />
      {/* App-wide on purpose: the deploy banner lives only in the cataloguing
          shell, so an iPad parked on any other page would never hear about a
          refresh. Renders nothing. */}
      <ForceReloadListener />
      <ImpersonationBanner />
      <AnnouncementBanner />
      {session.user.role === "ADMIN" && <MigrationBanner />}
      <TopBar
        userName={effective?.user.name ?? session.user.name}
        isAdmin={session.user.role === "ADMIN"}
        hasDashboard={hasDashboard}
        feedbackEnabled={!needsTerms}
      />
      <div className="flex flex-1 overflow-hidden">
        <CrmSidebar />
        <AdminSidebar />
        {/* Until signed, the app content is NOT rendered/streamed — the gate replaces
            it, so it can't be revealed by removing the overlay in dev tools. */}
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-[#141416]">{needsTerms ? null : children}</main>
      </div>
      {needsTerms && <TermsGate userName={session.user.name ?? ""} />}
      {/* Not while the terms gate is up — signing the policy comes first, and two
          stacked modals would be a mess. They'll get the notes on the next load. */}
      {!needsTerms && <PatchNotesPopup />}
    </div>
  )
}
