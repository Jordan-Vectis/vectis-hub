"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import EnvSelector from "@/components/env-selector"
import Logo from "@/components/logo"
import ThemeToggle from "@/components/theme-toggle"
import { signOutAction } from "@/lib/actions/auth"

interface TopBarProps {
  userName: string
  isAdmin?: boolean
}

export default function TopBar({ userName, isAdmin }: TopBarProps) {
  const router = useRouter()

  return (
    <header className="h-12 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.back()}
          title="Go back"
          className="text-gray-500 hover:text-white text-sm transition-colors px-1"
        >
          ←
        </button>
        <button
          onClick={() => router.forward()}
          title="Go forward"
          className="text-gray-500 hover:text-white text-sm transition-colors px-1"
        >
          →
        </button>
        <Link href="/hub" className="ml-1 hover:opacity-80 transition-opacity">
          <Logo variant="compact" />
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <EnvSelector />
        <ThemeToggle />
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
          <button type="submit" className="text-gray-400 hover:text-white text-sm transition-colors">
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
