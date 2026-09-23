import Link from "next/link"
import Image from "next/image"
import { getCustomerSession } from "@/lib/customer-auth"
import { logoutCustomer } from "@/lib/actions/customer-auth"
import { prisma } from "@/lib/prisma"

// The Departments menu comes from the department pages collected from vectis.co.uk (Databases →
// News); until they are loaded the list below stands in, pointing at the auction calendar.
async function departmentLinks(): Promise<{ label: string; href: string }[]> {
  try {
    const rows = await prisma.$queryRaw<{ slug: string; name: string }[]>`SELECT "slug", "name" FROM "SiteDepartment" ORDER BY "order", "name"`
    if (rows.length) return rows.map(r => ({ label: r.name.toUpperCase(), href: `/departments/${r.slug}` }))
  } catch { /* table not there yet */ }
  return DEPARTMENTS.map(dept => ({ label: dept.toUpperCase(), href: `/auctions?type=${encodeURIComponent(dept)}` }))
}

const DEPARTMENTS = [
  "Action Figures",
  "Action Man",
  "Airfix and Model Kits",
  "Barbie",
  "Comics",
  "Corgi",
  "Dolls",
  "Dinky",
  "Lego",
  "Matchbox",
  "Militaria Memorabilia",
  "Military Toy Figures",
  "Music and Memorabilia",
  "Retro Gaming",
  "Retro Toys",
  "Sports Memorabilia",
  "Star Wars",
  "Star Wars Lego",
  "Teddy Bears",
  "Tinplate",
  "Trading Cards",
  "Trains & Model Railway",
  "Transformers",
  "TV & Film",
  "TV and Film Related Props and Collectables",
  "Vintage Diecast",
  "Vintage Toys",
]

export default async function SiteNav() {
  const session = await getCustomerSession()
  const departments = await departmentLinks()

  return (
    <header>
      {/* ── Top bar: thin red accent ── */}
      <div className="h-1 bg-[#DB0606]" />

      {/* ── Middle tier: search / logo / account ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between gap-6">

          {/* Search */}
          <form method="GET" action="/search" className="flex items-stretch shrink-0 shadow-sm" style={{ width: "300px" }}>
            <div className="relative shrink-0">
              <select
                name="filter"
                className="h-full appearance-none border border-r-0 border-gray-300 bg-gray-50 text-[#32348A] text-[10px] font-black uppercase tracking-wider pl-3 pr-7 focus:outline-none focus:border-[#32348A] cursor-pointer"
              >
                <option value="all">All</option>
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="relative flex-1 flex items-center border border-gray-300 bg-white px-3 focus-within:border-[#32348A] transition-all">
              <svg className="w-3.5 h-3.5 text-gray-400 shrink-0 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                name="q"
                placeholder="Search lots…"
                className="flex-1 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none bg-transparent"
              />
            </div>
            <button
              type="submit"
              className="shrink-0 bg-[#32348A] hover:bg-[#28296e] text-white text-[10px] font-black uppercase tracking-widest px-4 transition-colors border border-[#32348A]"
            >
              GO
            </button>
          </form>

          {/* ── Vectis Logo ── */}
          <Link href="/" className="shrink-0">
            <Image
              src="/vectis-logo.svg"
              alt="Vectis Auctions — Collectables Specialists"
              width={172}
              height={70}
              className="object-contain"
              priority
            />
          </Link>

          {/* Account */}
          <div className="flex items-center gap-3 shrink-0">
            {session ? (
              <>
                <form action={logoutCustomer}>
                  <button type="submit" className="border border-[#32348A] text-[#32348A] text-xs font-bold px-4 py-2 tracking-wider hover:bg-[#32348A] hover:text-white transition-colors">
                    LOG OUT
                  </button>
                </form>
                <Link href="/account" className="bg-[#32348A] text-white text-xs font-bold px-4 py-2 tracking-wider hover:bg-[#28296e] transition-colors flex items-center gap-2">
                  MY ACCOUNT
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                  </svg>
                </Link>
              </>
            ) : (
              <>
                <Link href="/portal/login" className="border border-[#32348A] text-[#32348A] text-xs font-bold px-4 py-2 tracking-wider hover:bg-[#32348A] hover:text-white transition-colors">
                  LOG IN
                </Link>
                <Link href="/portal/register" className="bg-[#32348A] text-white text-xs font-bold px-4 py-2 tracking-wider hover:bg-[#28296e] transition-colors flex items-center gap-2">
                  MY ACCOUNT
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                  </svg>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom tier: nav links ── */}
      <nav className="bg-[#32348A] relative z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <ul className="flex items-center justify-center gap-0 text-xs font-semibold tracking-wider text-white">

            <NavItem href="/" label="HOME" />

            {/* Auction Calendar dropdown */}
            <DropdownNavItem label="AUCTION CALENDAR" href="/auctions">
              <DropdownSection>
                <DropdownLink href="/auctions" label="Upcoming Auctions" />
                <DropdownLink href="/auctions?tab=past" label="View Results" />
              </DropdownSection>
            </DropdownNavItem>

            {/* Departments dropdown */}
            <DropdownNavItem label="DEPARTMENTS" href="/departments">
              <div className="grid grid-cols-2 gap-x-6 gap-y-0 p-4" style={{ minWidth: "520px" }}>
                {departments.map(dept => (
                  <DropdownLink key={dept.href} href={dept.href} label={dept.label} />
                ))}
                <div className="col-span-2 border-t border-gray-100 mt-2 pt-2">
                  <DropdownLink href="/departments" label="VIEW ALL DEPARTMENTS" bold />
                </div>
              </div>
            </DropdownNavItem>

            <NavItem href="/portal/register" label="HOW TO BID" />
            <NavItem href="/submit" label="SELL WITH US" />
            <NavItem href="/news-stories/news" label="NEWS &amp; STORIES" />
            <NavItem href="/auctions" label="CAREERS" />
            <NavItem href="/auctions" label="CONTACT US" />
          </ul>
        </div>
      </nav>
    </header>
  )
}

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-1 px-4 py-3 hover:bg-white/10 transition-colors whitespace-nowrap"
      >
        {label}
      </Link>
    </li>
  )
}

function DropdownNavItem({
  href, label, children,
}: {
  href: string
  label: string
  children: React.ReactNode
}) {
  return (
    <li className="relative group">
      <Link
        href={href}
        className="flex items-center gap-1 px-4 py-3 hover:bg-white/10 transition-colors whitespace-nowrap"
      >
        {label}
        <svg className="w-2.5 h-2.5 opacity-70 group-hover:rotate-180 transition-transform duration-200" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </Link>
      <div className="absolute top-full left-0 bg-white shadow-xl border border-gray-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 translate-y-1 group-hover:translate-y-0 z-50">
        {children}
      </div>
    </li>
  )
}

function DropdownSection({ children }: { children: React.ReactNode }) {
  return <div className="py-2 min-w-[200px]">{children}</div>
}

function DropdownLink({ href, label, bold }: { href: string; label: string; bold?: boolean }) {
  return (
    <Link
      href={href}
      className={`block px-4 py-1.5 text-[11px] tracking-wider text-gray-700 hover:bg-[#32348A] hover:text-white transition-colors whitespace-nowrap ${bold ? "font-black text-[#32348A]" : "font-semibold"}`}
    >
      {label}
    </Link>
  )
}
