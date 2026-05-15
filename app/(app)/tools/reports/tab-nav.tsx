"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const TABS = [
  { href: "/tools/reports",        label: "Cataloguing" },
  { href: "/tools/reports/backup", label: "Backup"      },
] as const

export default function ReportsTabNav() {
  const pathname = usePathname()

  return (
    <div className="border-b border-gray-800 bg-[#141416] px-6">
      <div className="max-w-7xl mx-auto">
        <nav className="flex gap-1 pt-2">
          {TABS.map(tab => {
            const isActive =
              tab.href === "/tools/reports"
                ? pathname === "/tools/reports"
                : pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-2 text-sm font-semibold rounded-t-md border-b-2 transition-colors ${
                  isActive
                    ? "border-[#2AB4A6] text-white"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
