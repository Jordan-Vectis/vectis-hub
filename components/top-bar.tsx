"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import EnvSelector from "@/components/env-selector"
import Logo from "@/components/logo"
import { signOutAction } from "@/lib/actions/auth"

interface TopBarProps {
  userName: string
}

export default function TopBar({ userName }: TopBarProps) {
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
