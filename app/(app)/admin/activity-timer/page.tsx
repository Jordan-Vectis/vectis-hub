import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CONFIG } from "@/lib/idle-timer-config"
import IdleTimerSettingsClient from "./idle-timer-settings-client"
import IdlePromptPreview from "@/components/idle-prompt-preview"
import Link from "next/link"

// Migration-safe: `message` is newer than the deploy that reads it, so a missing column must
// leave the page working with no banner rather than 500 it (RULES.md pattern).
async function getConfig(): Promise<{ reasons: any[]; message: string }> {
  try {
    const row = await (prisma as any).idleTimerConfig.findUnique({ where: { id: "global" } })
    if (!row) return { reasons: DEFAULT_CONFIG.reasons, message: "" }
    return {
      reasons: Array.isArray(row.reasons) && row.reasons.length ? row.reasons : DEFAULT_CONFIG.reasons,
      message: typeof row.message === "string" ? row.message : "",
    }
  } catch {
    return { reasons: DEFAULT_CONFIG.reasons, message: "" }
  }
}

export default async function IdleTimerAdminPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const { reasons, message } = await getConfig()

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <Link href="/admin" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cataloguer Activity Timer</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage the activity options that appear in the popup and whether each requires a note.
          Timing thresholds are set per user in Admin → Users. Changes take effect on the next page load.
        </p>
        <div className="mt-4">
          <IdlePromptPreview reasons={reasons} message={message} />
        </div>
      </div>

      <Link href="/admin/unaccounted-time" className="mb-6 flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
        <span className="text-2xl">🕵️</span>
        <span>
          <span className="block font-semibold text-gray-900 dark:text-white">Unaccounted Time report →</span>
          <span className="block text-sm text-gray-500 dark:text-gray-400 mt-0.5">Working-hours gaps between lot saves that were never accounted for with an activity reason — reads the save history directly, so it catches gaps however the popup was avoided.</span>
        </span>
      </Link>

      <IdleTimerSettingsClient initialReasons={reasons} initialMessage={message} />
    </div>
  )
}
