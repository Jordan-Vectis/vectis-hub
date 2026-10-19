"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import type { WarehouseRole } from "@/lib/apps"
import ScanInput from "@/app/(app)/tools/warehouse/_components/scan-input"

// Goods In — the section's navigation (2026-10-15, replacing the April prototype's sidebar).
//
// Two shapes of the SAME list of links:
//  · lg and wider (desktops, an iPad held sideways): a sidebar down the left.
//  · narrower (an iPad upright, a phone): one compact bar across the top whose links scroll
//    sideways. ⚠ The row scrolls INSIDE itself — it must never make the page wider than the phone
//    (RULES design rule 5). Every link is 44px tall for a finger at the counter.
// "Check in" is drawn as the section's main button wherever it appears: booking goods in is the
// job the counter does most. Settings is for Warehouse admins only — the screen itself also refuses.

type NavItem = { href: string; label: string; icon: ReactNode; exact?: boolean; primary?: boolean; adminOnly?: boolean }

// Outline icons, 24×24, drawn with currentColor so they follow the link's colour in both themes.
const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0" aria-hidden>
    {children}
  </svg>
)

const NAV: NavItem[] = [
  { href: "/tools/warehouse", label: "Dashboard", exact: true, icon: <Icon><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Icon> },
  { href: "/tools/warehouse/check-in", label: "Check in", primary: true, icon: <Icon><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Icon> },
  { href: "/tools/warehouse/receipts", label: "Receipts", icon: <Icon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" /></Icon> },
  { href: "/tools/warehouse/customers", label: "Customers", icon: <Icon><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Icon> },
  { href: "/tools/warehouse/move", label: "Move", icon: <Icon><path d="M17 3l4 4-4 4" /><path d="M3 7h18" /><path d="M7 21l-4-4 4-4" /><path d="M21 17H3" /></Icon> },
  { href: "/tools/warehouse/bench", label: "Bench", icon: <Icon><rect x="2" y="7" width="20" height="4" rx="1" /><path d="M5 11v9M19 11v9M5 16h14" /></Icon> },
  { href: "/tools/warehouse/find", label: "Find", icon: <Icon><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></Icon> },
  { href: "/tools/warehouse/locations", label: "Locations", icon: <Icon><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></Icon> },
  { href: "/tools/warehouse/history", label: "History", icon: <Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon> },
  // Sign-in cards for the handheld scanner (QR) — anyone in Goods In prints their own.
  { href: "/tools/warehouse/scanner-cards", label: "Scanner cards", icon: <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="6" y="9" width="5" height="5" rx="0.5" /><path d="M14 10h4M14 13h3" /></Icon> },
  { href: "/tools/warehouse/settings", label: "Settings", adminOnly: true, icon: <Icon><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></Icon> },
]

const TIER_LABEL: Record<WarehouseRole, string> = { warehouse: "Warehouse staff", manager: "Manager", admin: "Admin" }

const isActive = (pathname: string, item: NavItem) =>
  item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/")

export default function WarehouseSidebar({ whRole, userName }: { whRole: WarehouseRole; userName?: string | null }) {
  const pathname = usePathname() ?? ""
  const items = NAV.filter(i => !i.adminOnly || whRole === "admin")

  return (
    <>
      {/* ── lg and wider: the sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex w-56 shrink-0 flex-col overflow-y-auto border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E]">
        <div className="px-4 pt-5 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">Warehouse</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Goods In</p>
        </div>
        <nav aria-label="Goods In" className="flex flex-col gap-1 px-2 pb-4">
          {items.map(item => {
            const active = isActive(pathname, item)
            if (item.primary) {
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                  className={`my-1.5 flex items-center gap-3 min-h-12 px-3 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors shadow-sm ${active ? "ring-2 ring-offset-2 ring-indigo-500 ring-offset-white dark:ring-indigo-300 dark:ring-offset-[#1C1C1E]" : ""}`}>
                  {item.icon}
                  {item.label}
                </Link>
              )
            }
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 min-h-11 px-3 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                }`}>
                {item.icon}
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto px-4 py-4 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {userName && <p className="font-medium text-gray-700 dark:text-gray-200 truncate" title={userName}>{userName}</p>}
          <p>Your access: {TIER_LABEL[whRole] ?? whRole}</p>
        </div>
      </aside>

      {/* ── narrower than lg: one compact bar, links scroll sideways ───────────────── */}
      <MobileBar items={items} pathname={pathname} />
    </>
  )
}

function MobileBar({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setFade(f => (f.left === left && f.right === right ? f : { left, right }))
  }, [])

  // Bring the current screen's link into view (History and Settings sit off the end on a phone),
  // scrolling only the row — never the page.
  useEffect(() => {
    const el = scroller.current
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]')
    if (el && active) {
      const target = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2
      el.scrollLeft = Math.max(0, target)
    }
    measure()
  }, [pathname, measure])

  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  return (
    <div className="lg:hidden shrink-0 min-w-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E]">
      <div className="relative">
        <div ref={scroller} onScroll={measure} className="relative flex items-center gap-1.5 overflow-x-auto overscroll-x-contain scrollbar-none px-3 py-1.5">
          <span className="shrink-0 pr-2 mr-0.5 text-sm font-bold text-gray-900 dark:text-white border-r border-gray-200 dark:border-gray-700">Goods In</span>
          <nav aria-label="Goods In" className="flex items-center gap-1.5">
            {items.map(item => {
              const active = isActive(pathname, item)
              const tone = item.primary
                ? `bg-indigo-600 text-white font-semibold ${active ? "ring-2 ring-indigo-300" : ""}`
                : active
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200 font-semibold"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                  className={`shrink-0 inline-flex items-center gap-2 h-11 px-3 rounded-lg text-sm whitespace-nowrap transition-colors ${tone}`}>
                  {item.icon}
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
        {/* Soft edges say "there's more this way" when the row runs past the screen. */}
        {fade.left && <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white dark:from-[#1C1C1E] to-transparent" />}
        {fade.right && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white dark:from-[#1C1C1E] to-transparent" />}
      </div>
    </div>
  )
}

/**
 * The dashboard's "scan or type any code" box: a scanner types the code and presses Enter, and the
 * Find screen opens on it. Lives here (the section's shell) because the dashboard is a server page.
 */
export function GoodsInFindBox({ autoFocus }: { autoFocus?: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [code, setCode] = useState<string | null>(null)
  return (
    <div>
      <ScanInput
        id="goods-in-find"
        label="Scan or type a code"
        placeholder="Tote, pallet, receipt, lot, location…"
        keep
        autoFocus={autoFocus}
        onScan={c => {
          setCode(c)
          startTransition(() => router.push(`/tools/warehouse/find?q=${encodeURIComponent(c)}`))
        }}
      />
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 min-h-4" role="status" aria-live="polite">
        {pending && code
          ? <>Opening Find for <span className="font-mono font-semibold text-gray-700 dark:text-gray-200">{code}</span>…</>
          : "Totes (T…), pallets (P…), receipts (R…), lot barcodes, location codes and vendor numbers all work."}
      </p>
    </div>
  )
}
