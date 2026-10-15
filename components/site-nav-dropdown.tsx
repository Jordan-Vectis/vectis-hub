"use client"

import Link from "next/link"
import { useState } from "react"

// A hover dropdown in the test site's nav that also CLOSES when a link inside it is chosen. The
// hover-only version stayed open over the new page, because the pointer was still on it (Jordan,
// 2026-09-24: "it moves you to the page but doesn't minimise the drop down"). Moving the pointer
// off the item arms it again for the next hover. Keyboard users open it by tabbing into it
// (focus-within), so every menu is reachable without a mouse.
export default function DropdownNavItem({ href, label, children, wide }: { href: string; label: string; children: React.ReactNode; wide?: boolean }) {
  const [closed, setClosed] = useState(false)
  return (
    <li className="relative group" onMouseLeave={() => setClosed(false)}>
      <Link href={href} onClick={() => setClosed(true)} className="vs-nav-link" aria-haspopup="true">
        {label}
        <svg className={`w-3 h-3 transition-transform duration-200 ${closed ? "" : "group-hover:rotate-180"}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </Link>
      <div
        onClick={() => setClosed(true)}
        className={`vs-nav-panel absolute top-full z-50 transition-all duration-150 ${wide ? "left-1/2 -translate-x-1/2" : "left-0"} ${
          closed
            ? "opacity-0 invisible translate-y-1"
            : "opacity-0 invisible translate-y-1 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:visible group-focus-within:translate-y-0"
        }`}
      >
        {children}
      </div>
    </li>
  )
}
