"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

// The phone and tablet header (below lg): a search button, the logo, a menu button — and the
// drawer those two open, which holds the search box, the same menu as the desktop row (the two
// dropdowns as fold-outs), the phone number and the account buttons. The desktop header is
// server-rendered in components/site-nav.tsx; this is only the small-screen half. vectis.co.uk
// does the same (a search icon, the logo, a menu icon; the menu slides in from the right).
//
// The drawer is drawn on every screen size but only ever OPENED here, because the buttons that
// open it are hidden from lg up — so there is one copy of the menu's words for small screens.

export type NavLink = { label: string; href: string }
export type NavGroup = { label: string; href: string; links: NavLink[] }

export default function SiteMobileNav({ groups, links, loggedIn }: { groups: NavGroup[]; links: NavLink[]; loggedIn: boolean }) {
  const [open, setOpen] = useState<null | "menu" | "search">(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pathname = usePathname()

  // A route change closes it (the links are plain navigation, so the drawer would otherwise sit
  // over the new page); Escape closes it; the page behind doesn't scroll while it is open.
  useEffect(() => { setOpen(null) }, [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null) }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    if (open === "search") setTimeout(() => searchRef.current?.focus(), 260)
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev }
  }, [open])

  return (
    <>
      <div className="lg:hidden grid grid-cols-[1fr_auto_1fr] items-center h-[72px]">
        <button type="button" onClick={() => setOpen("search")} aria-label="Search" className="justify-self-start inline-flex items-center justify-center w-11 h-11 text-[var(--vs-navy)]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
        </button>
        <Link href="/" className="inline-block" aria-label="Vectis Auctions — home">
          <img src="/vectis-logo.svg" alt="Vectis Auctions" width={128} height={52} style={{ height: 52, width: "auto" }} />
        </Link>
        <button type="button" onClick={() => setOpen("menu")} aria-label="Menu" aria-expanded={open === "menu"} className="justify-self-end inline-flex items-center justify-center w-11 h-11 text-[var(--vs-navy)]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
      </div>

      {open && <div className="vs-drawer-dim lg:hidden" onClick={() => setOpen(null)} aria-hidden="true" />}
      {/* `inert` keeps the closed drawer's links out of the tab order and off screen readers. */}
      <div className="vs-drawer lg:hidden" data-open={open ? "true" : "false"} role="dialog" aria-modal="true" aria-label="Menu" inert={!open}>
        <div className="flex items-center justify-between px-5 h-[72px]">
          <span className="vs-caps text-[var(--vs-navy)]">Menu</span>
          <button type="button" onClick={() => setOpen(null)} aria-label="Close menu" className="inline-flex items-center justify-center w-11 h-11 text-[var(--vs-navy)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <form method="GET" action="/search" className="px-5 pb-4" role="search">
          <div className="vs-search">
            <span className="inline-flex items-center pl-3 text-[var(--vs-navy)]" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
            </span>
            <input ref={searchRef} name="q" placeholder="Search" aria-label="Search lots" autoComplete="off" />
            <button type="submit">GO</button>
          </div>
        </form>

        <nav className="px-5 pb-6" aria-label="Site">
          {groups.map(g => {
            const isOpen = expanded === g.label
            return (
              <div key={g.label} className="border-b border-[var(--vs-line)]">
                <button type="button" className="vs-drawer-link" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : g.label)}>
                  {g.label}
                  <svg className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
                </button>
                {isOpen && (
                  <div className="vs-drawer-sub pb-3">
                    {g.links.map(l => <Link key={l.href + l.label} href={l.href}>{l.label}</Link>)}
                  </div>
                )}
              </div>
            )
          })}
          {links.map(l => (
            <div key={l.href} className="border-b border-[var(--vs-line)]">
              <Link href={l.href} className="vs-drawer-link">{l.label}</Link>
            </div>
          ))}

          <p className="mt-6 text-sm">
            <a href="tel:+441642750616" className="inline-flex items-center gap-2 text-[var(--vs-navy)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
              (+44) 01642 750 616
            </a>
          </p>
          <div className="mt-5 grid gap-3">
            {loggedIn ? (
              <Link href="/account" className="vs-btn vs-btn-block">My account</Link>
            ) : (
              <>
                <Link href="/portal/login" className="vs-btn vs-btn-block">Login</Link>
                <Link href="/portal/register" className="vs-btn vs-btn-outline vs-btn-block">Register</Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </>
  )
}
