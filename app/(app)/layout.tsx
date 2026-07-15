import { auth } from "@/auth"
import { redirect } from "next/navigation"
import TopBar from "@/components/top-bar"
import CrmSidebar from "@/components/crm-sidebar"
import AdminSidebar from "@/components/admin-sidebar"
import ImpersonationBanner from "@/components/impersonation-banner"
import AnnouncementBanner from "@/components/announcement-banner"
import MigrationBanner from "@/components/migration-banner"
import CrtMode from "@/components/crt-mode"
import TermsGate from "@/components/terms-gate"
import { getEffectiveSession } from "@/lib/impersonation"
import { prisma } from "@/lib/prisma"
import { TERMS_VERSION } from "@/lib/terms"

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

  return (
    <div className="flex flex-col h-full min-h-screen">
      <CrtMode />
      <ImpersonationBanner />
      <AnnouncementBanner />
      {session.user.role === "ADMIN" && <MigrationBanner />}
      <TopBar
        userName={effective?.user.name ?? session.user.name}
        isAdmin={session.user.role === "ADMIN"}
      />
      <div className="flex flex-1 overflow-hidden">
        <CrmSidebar />
        <AdminSidebar />
        {/* Until signed, the app content is NOT rendered/streamed — the gate replaces
            it, so it can't be revealed by removing the overlay in dev tools. */}
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-[#141416]">{needsTerms ? null : children}</main>
      </div>
      {needsTerms && <TermsGate userName={session.user.name ?? ""} />}
    </div>
  )
}
