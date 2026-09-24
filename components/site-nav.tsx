import Link from "next/link"
import Image from "next/image"
import { getCustomerSession } from "@/lib/customer-auth"
import { logoutCustomer } from "@/lib/actions/customer-auth"
import { prisma } from "@/lib/prisma"
import DropdownNavItem from "@/components/site-nav-dropdown"

// The Departments menu comes from the department pages collected from vectis.co.uk (Databases →
// News); until they are loaded the list below stands in, pointing at the auction calendar.
async function departmentLinks(): Promise<{ label: string; href: string }[]> {
  try {
    const rows = await prisma.$queryRaw<{ slug: string; name: string }[]>`SELECT "slug", "name" FROM "SiteDepartment" ORDER BY "order", "name"`
    if (rows.length) return rows.map(r => ({ label: r.name.toUpperCase(), href: `/departments/${r.slug}` }))
  } catch { /* table not there yet */ }
  // Nothing collected yet: the names still show, and each leads to the departments page, which says so.
  return DEPARTMENTS.map(dept => ({ label: dept.toUpperCase(), href: "/departments" }))
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
        {/* Three columns, not justify-between: the search and the account buttons differ in width, so a
            space-between layout put the logo off-centre (Jordan, 2026-09-24). The middle column is the
            logo, exactly centred; the outer two are equal and stretch. The row runs to the page edges —
            search hard left, account hard right, the hero's own gutter — rather than sitting in a
            narrower box than the blue bar and the hero under it, which read as three different widths. */}
        <div className="px-4 sm:px-12 h-20 grid grid-cols-[1fr_auto_1fr] items-center gap-6">

          {/* Search */}
          <form method="GET" action="/search" className="flex items-stretch shrink-0 shadow-sm w-full max-w-[360px]">
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
          <div className="flex items-center gap-3 shrink-0 justify-self-end">
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
              {/* Two columns filled DOWN, as the live site's menu reads, and long names wrap rather than run into the next column. */}
              <div className="p-4" style={{ minWidth: "600px" }}>
                <div className="flex gap-8">
                  {[departments.slice(0, Math.ceil(departments.length / 2)), departments.slice(Math.ceil(departments.length / 2))].map((column, i) => (
                    <div key={i} className="flex-1 min-w-0">
                      {column.map(dept => <DropdownLink key={dept.label} href={dept.href} label={dept.label} wrap />)}
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-100 mt-2 pt-2">
                  <DropdownLink href="/departments" label="VIEW ALL DEPARTMENTS" bold />
                </div>
              </div>
            </DropdownNavItem>

            <NavItem href="/how-to-bid" label="HOW TO BID" />
            <NavItem href="/sell-with-us" label="SELL WITH US" />
            <NavItem href="/news-stories/news" label="NEWS &amp; STORIES" />
            {/* Careers and Contact Us pointed at the auction list until 2026-09-24 (Jordan). */}
            <NavItem href="/careers" label="CAREERS" />
            <NavItem href="/contact" label="CONTACT US" />
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

// DropdownNavItem lives in components/site-nav-dropdown.tsx (a client component: it closes itself when a link inside is chosen).

function DropdownSection({ children }: { children: React.ReactNode }) {
  return <div className="py-2 min-w-[200px]">{children}</div>
}

function DropdownLink({ href, label, bold, wrap }: { href: string; label: string; bold?: boolean; wrap?: boolean }) {
  return (
    <Link
      href={href}
      className={`block px-4 py-1.5 text-[11px] tracking-wider text-gray-700 hover:bg-[#32348A] hover:text-white transition-colors ${wrap ? "whitespace-normal leading-snug" : "whitespace-nowrap"} ${bold ? "font-black text-[#32348A]" : "font-semibold"}`}
    >
      {label}
    </Link>
  )
}
