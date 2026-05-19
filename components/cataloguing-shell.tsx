"use client"

import { useState } from "react"
import CataloguingSidebar from "@/components/cataloguing-sidebar"

export default function CataloguingShell({ children, allowedSidebarItems }: { children: React.ReactNode; allowedSidebarItems?: string[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <div className="hidden md:block flex-shrink-0">
        <CataloguingSidebar allowedItems={allowedSidebarItems} />
      </div>

      {/* Mobile overlay */}
      {open && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/60 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="md:hidden fixed inset-y-0 left-0 z-50 w-56">
            <CataloguingSidebar allowedItems={allowedSidebarItems} onClose={() => setOpen(false)} />
          </div>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 dark:bg-[#141416]">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-white dark:bg-[#1C1C1E] border-b border-gray-200 dark:border-gray-800 px-4 py-3">
          <button
            onClick={() => setOpen(true)}
            className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Cataloguing</span>
        </div>
        {children}
      </div>
    </div>
  )
}
