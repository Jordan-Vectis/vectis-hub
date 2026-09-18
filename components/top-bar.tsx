"use client"

import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import EnvSelector from "@/components/env-selector"
import Logo from "@/components/logo"
import ThemeToggle from "@/components/theme-toggle"
import BcStatusButton from "@/components/bc-status-button"
import NotificationBell from "@/components/notification-bell"
import HelpButton from "@/components/help-button"
import FeedbackPrompt from "@/components/feedback-prompt"
import { signOutAction } from "@/lib/actions/auth"

interface TopBarProps {
  userName: string
  isAdmin?: boolean
  /** Whether this person has Manager Portal → Dashboard. Hides the switch for everyone else. */
  hasDashboard?: boolean
  /** Hub feedback surveys (popup + the "📝 Feedback to finish" button). Off while the iPad policy
   *  still needs signing — that comes first, and two stacked modals would be a mess. */
  feedbackEnabled?: boolean
}

export default function TopBar({ userName, isAdmin, hasDashboard, feedbackEnabled }: TopBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const onDashboard = pathname.startsWith("/tools/manager-portal")

  return (
    // ⚠⚠ ON A PHONE THIS BAR USED TO WIDEN THE WHOLE PAGE (2026-09-18). One row that couldn't wrap:
    // 435px for staff, 644px for an admin with the Dashboard switch, on a 375px screen — so the
    // page itself became wider than the phone, which is what let it zoom out, slide sideways and
    // show white beside the app. Below `sm` (640px) it now drops only the words that repeat an
    // icon, and WRAPS to a second row rather than overflow if it still doesn't fit. Every control
    // stays. Everything is `max-sm:`, so iPads (744px+) and desktop are pixel-identical.
    // ⚠ Put no overflow on this header: its dropdowns hang below it and would be clipped.
    <header className="relative h-12 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-4 flex-shrink-0 max-sm:h-auto max-sm:min-h-12 max-sm:flex-wrap max-sm:px-2 max-sm:py-1 max-sm:gap-y-1">
      <div className="flex items-center gap-2">
        {/* A phone has its own back and forward gestures. */}
        <button
          onClick={() => router.back()}
          title="Go back"
          className="text-gray-500 hover:text-white text-sm transition-colors px-1 max-sm:hidden"
        >
          ←
        </button>
        <button
          onClick={() => router.forward()}
          title="Go forward"
          className="text-gray-500 hover:text-white text-sm transition-colors px-1 max-sm:hidden"
        >
          →
        </button>
        {/* On a phone the icon alone — the words are hidden here, not in logo.tsx, because the
            compact logo is used elsewhere too. */}
        <Link href="/hub" aria-label="Vectis Hub" className="ml-1 hover:opacity-80 transition-opacity max-sm:ml-0 max-sm:[&_span]:hidden">
          <Logo variant="compact" />
        </Link>

        {/* Hub ⇄ Dashboard. Only for people who have the Dashboard tab, so the
            header is unchanged for everyone else. */}
        {hasDashboard && (
          <div className="ml-3 max-sm:ml-1 flex items-center rounded-md bg-gray-800 p-0.5 text-xs font-medium">
            <Link
              href="/hub"
              className={`px-2.5 py-1 rounded transition-colors ${
                onDashboard ? "text-gray-400 hover:text-white" : "bg-gray-700 text-white"
              }`}
            >
              Hub
            </Link>
            <Link
              href="/tools/manager-portal?tab=dashboard"
              className={`px-2.5 py-1 rounded transition-colors ${
                onDashboard ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Dashboard
            </Link>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 max-sm:gap-2.5 max-sm:flex-wrap max-sm:justify-end max-sm:ml-auto">
        {/* Hub feedback: pops a survey up, and shows "📝 Feedback to finish" only while this person
            has one they put off. Renders nothing otherwise. */}
        {feedbackEnabled && <FeedbackPrompt />}
        {/* Ask where to find things. Knows only about the tools this person can open. */}
        <HelpButton />
        <EnvSelector />
        <ThemeToggle />
        <BcStatusButton />
        {isAdmin && <NotificationBell />}
        {isAdmin && (
          <Link href="/admin" title="Admin settings" className="text-gray-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        )}
        <span className="text-gray-400 text-xs hidden sm:block">{userName}</span>
        <form action={signOutAction}>
          <button type="submit" className="text-gray-400 hover:text-white text-sm transition-colors whitespace-nowrap">
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
