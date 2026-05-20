import { auth } from "@/auth"
import { redirect } from "next/navigation"
import TopBar from "@/components/top-bar"
import CrmSidebar from "@/components/crm-sidebar"
import AdminSidebar from "@/components/admin-sidebar"
import ImpersonationBanner from "@/components/impersonation-banner"
import { getEffectiveSession } from "@/lib/impersonation"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect("/login")

  // Use effective session for display name (shows impersonated user's name in top bar)
  const effective = await getEffectiveSession()

  return (
    <div className="flex flex-col h-full min-h-screen">
      <ImpersonationBanner />
      <TopBar userName={effective?.user.name ?? session.user.name} />
      <div className="flex flex-1 overflow-hidden">
        <CrmSidebar />
        <AdminSidebar />
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-[#141416]">{children}</main>
      </div>
    </div>
  )
}
