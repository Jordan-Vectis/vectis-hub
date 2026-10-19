"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import Logo from "@/components/logo"

interface NavProps {
  userRole: string
  userName: string
}

const crmItems = [
  { href: "/submissions", label: "Submissions", roles: ["ADMIN", "COLLECTIONS", "CATALOGUER"] },
  { href: "/cataloguer", label: "My Valuations", roles: ["ADMIN", "CATALOGUER"] },
  { href: "/follow-ups", label: "Follow-ups", roles: ["ADMIN", "COLLECTIONS"] },
  { href: "/admin/users", label: "Users", roles: ["ADMIN"] },
  { href: "/admin/departments", label: "Departments", roles: ["ADMIN"] },
]

const toolItems = [
  { href: "/tools/auction-ai", label: "Auction AI", roles: ["ADMIN", "CATALOGUER", "COLLECTIONS"] },
  { href: "/tools/barcode-sorter", label: "Barcode Sorter", roles: ["ADMIN", "CATALOGUER", "COLLECTIONS"] },
  { href: "/tools/bc-reports", label: "BC Reports", roles: ["ADMIN", "COLLECTIONS"] },
  { href: "/tools/warehouse", label: "Goods In", roles: ["ADMIN", "COLLECTIONS"] },
  { href: "/tools/packing", label: "Packing", roles: ["ADMIN", "COLLECTIONS"] },
  { href: "/tools/saleroom-trainer", label: "Saleroom Trainer", roles: ["ADMIN", "CATALOGUER", "COLLECTIONS"] },
]

function NavSection({ title, items, userRole, pathname }: {
  title: string
  items: typeof crmItems
  userRole: string
  pathname: string
}) {
  const visible = items.filter((item) => item.roles.includes(userRole))
  if (visible.length === 0) return null

  return (
    <div className="mb-4">
      <p className="px-3 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
      <div className="space-y-0.5">
        {visible.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default function Nav({ userRole, userName }: NavProps) {
  const pathname = usePathname()

  return (
    <nav className="w-56 min-h-screen bg-gray-900 flex flex-col">
      <Link href="/" className="block px-5 py-5 border-b border-gray-700 hover:bg-gray-800 transition-colors">
        <Logo variant="compact" />
      </Link>

      <div className="flex-1 px-3 py-4">
        <NavSection title="CRM" items={crmItems} userRole={userRole} pathname={pathname} />
        <NavSection title="Tools" items={toolItems} userRole={userRole} pathname={pathname} />
      </div>

      <div className="px-3 py-4 border-t border-gray-700">
        <div className="px-3 mb-2">
          <p className="text-white text-xs font-medium truncate">{userName}</p>
          <p className="text-gray-400 text-xs capitalize">{userRole.toLowerCase()}</p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full text-left px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
