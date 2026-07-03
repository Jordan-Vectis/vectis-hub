import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CONFIG } from "@/lib/idle-timer-config"
import IdleTimerSettingsClient from "./idle-timer-settings-client"
import Link from "next/link"

async function getReasons() {
  try {
    const row = await (prisma as any).idleTimerConfig.findUnique({ where: { id: "global" } })
    if (!row) return DEFAULT_CONFIG.reasons
    return Array.isArray(row.reasons) && row.reasons.length ? row.reasons : DEFAULT_CONFIG.reasons
  } catch {
    return DEFAULT_CONFIG.reasons
  }
}

export default async function IdleTimerAdminPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const reasons = await getReasons()

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <Link href="/admin" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Idle Timer Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage the reason options that appear in the idle popup and whether each requires a note.
          Timing thresholds are set per user in Admin → Users. Changes take effect on the next page load.
        </p>
      </div>

      <IdleTimerSettingsClient initialReasons={reasons} />
    </div>
  )
}
