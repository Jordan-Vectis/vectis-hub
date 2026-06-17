"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const CRM_ROUTES = ["/submissions", "/follow-ups", "/crm-settings"]

const links = [
  { href: "/submissions",  label: "Submissions", icon: "📋" },
  { href: "/follow-ups",   label: "Follow-ups",  icon: "🔔" },
  { href: "/crm-settings", label: "Settings",    icon: "⚙️" },
]

export default function CrmSidebar() {
  const pathname = usePathname()

  const isCrmRoute = CRM_ROUTES.some(r => pathname.startsWith(r))
  if (!isCrmRoute) return null

  return (
    <aside className="w-48 flex-shrink-0 bg-gray-900 border-r border-gray-700 flex flex-col py-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 px-4 mb-3">CRM</p>
      <nav className="flex flex-col gap-0.5 px-2">
        {links.map(({ href, label, icon }) => {
          const active = href === "/submissions"
            ? pathname === href || pathname.startsWith("/submissions/")
            : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
