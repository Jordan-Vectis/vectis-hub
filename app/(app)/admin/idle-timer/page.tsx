import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CONFIG } from "@/lib/idle-timer-config"
import IdleTimerSettingsClient from "./idle-timer-settings-client"
import Link from "next/link"

async function getConfig() {
  try {
    const row = await (prisma as any).idleTimerConfig.findUnique({ where: { id: "global" } })
    if (!row) return DEFAULT_CONFIG
    return {
      yellowMins: row.yellowMins,
      redMins:    row.redMins,
      reasons:    Array.isArray(row.reasons) ? row.reasons : DEFAULT_CONFIG.reasons,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export default async function IdleTimerAdminPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const config = await getConfig()

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <Link href="/admin" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Idle Timer Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Control what appears in the idle popup — timing thresholds, reason options, and whether a note is required.
          Changes take effect immediately for all staff on their next page load.
        </p>
      </div>

      <IdleTimerSettingsClient initial={config} />
    </div>
  )
}
