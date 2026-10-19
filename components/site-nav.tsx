import Link from "next/link"
import { getCustomerSession } from "@/lib/customer-auth"
import { logoutCustomer } from "@/lib/actions/customer-auth"
import { prisma } from "@/lib/prisma"
import DropdownNavItem from "@/components/site-nav-dropdown"
import SiteMobileNav, { type NavGroup, type NavLink } from "@/app/(site)/site-mobile-nav"

// The test website's header, laid out as vectis.co.uk's (2026-10-14): a white bar with the search
// box on the left, the logo in the middle and Register / Login on the right, then a single row of
// uppercase menu items with two dropdowns. Sticky, with the site's soft shadow. Below lg the row
// becomes a search icon, the logo and a menu icon (site-mobile-nav.tsx).

// The Departments menu comes from the department pages collected from vectis.co.uk (Databases →
// Departments); until they are loaded the list below stands in, pointing at the departments page.
async function departmentLinks(): Promise<NavLink[]> {
  try {
    const rows = await prisma.$queryRaw<{ slug: string; name: string }[]>`SELECT "slug", "name" FROM "SiteDepartment" ORDER BY "order", "name"`
    if (rows.length) return rows.map(r => ({ label: r.name, href: `/departments/${r.slug}` }))
  } catch { /* table not there yet */ }
  return DEPARTMENTS.map(dept => ({ label: dept, href: "/departments" }))
}

const DEPARTMENTS = [
  "Action Figures", "Action Man", "Airfix and Model Kits", "Barbie", "Comics", "Corgi", "Dolls", "Dinky",
  "Lego", "Matchbox", "Militaria Memorabilia", "Military Toy Figures", "Music and Memorabilia",
  "Retro Gaming", "Retro Toys", "Sports Memorabilia", "Star Wars", "Star Wars Lego", "Teddy Bears",
  "Tinplate", "Trading Cards", "Trains & Model Railway", "Transformers", "TV & Film",
  "TV and Film Related Props and Collectables", "Vintage Diecast", "Vintage Toys",
]

const CALENDAR_LINKS: NavLink[] = [
  { label: "Upcoming Auctions", href: "/auctions" },
  { label: "Auction Results", href: "/auctions?tab=past" },
]
const PLAIN_LINKS: NavLink[] = [
  { label: "How to bid", href: "/how-to-bid" },
  { label: "Sell with us", href: "/sell-with-us" },
  { label: "News & Stories", href: "/news-stories/news" },
  { label: "Careers", href: "/careers" },
  { label: "Contact us", href: "/contact" },
]

export default async function SiteNav() {
  const session = await getCustomerSession()
  const departments = await departmentLinks()
  const half = Math.ceil(departments.length / 2)
  const columns = [departments.slice(0, half), departments.slice(half)]
  const groups: NavGroup[] = [
    { label: "Auction Calendar", href: "/auctions", links: CALENDAR_LINKS },
    { label: "Departments", href: "/departments", links: [...departments, { label: "View All Departments", href: "/departments" }] },
  ]

  return (
    <header className="vs-header sticky top-0 z-50">
      <div className="vs-container-wide">
        {/* ── Phones and tablets ── */}
        <SiteMobileNav groups={groups} links={PLAIN_LINKS} loggedIn={!!session} />

        {/* ── Desktop: search / logo / account ── */}
        <div className="hidden lg:grid grid-cols-[1fr_auto_1fr] items-center pt-6 pb-2 gap-6">
          <form method="GET" action="/search" className="vs-search w-[350px] shrink-0" role="search">
            <span className="inline-flex items-center pl-3 text-[var(--vs-navy)]" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
            </span>
            <input name="q" placeholder="Search" aria-label="Search lots" autoComplete="off" />
            <select name="filter" aria-label="Which auctions to search" defaultValue="upcoming">
              <option value="upcoming">Upcoming</option>
              <option value="past">Archive</option>
              <option value="all">All</option>
            </select>
            <button type="submit">GO</button>
          </form>

          <Link href="/" className="inline-block justify-self-center" aria-label="Vectis Auctions — home">
            <img src="/vectis-logo.svg" alt="Vectis Auctions — Collectables Specialists" width={222} height={90} style={{ height: 90, width: "auto" }} fetchPriority="high" />
          </Link>

          <div className="flex items-center gap-3 justify-self-end">
            {session ? (
              <>
                <Link href="/account" className="vs-btn vs-btn-outline">Account</Link>
                <form action={logoutCustomer}>
                  <button type="submit" className="vs-btn">Log out</button>
                </form>
              </>
            ) : (
              <Link href="/portal/login" className="vs-btn vs-btn-outline">Register / Login</Link>
            )}
          </div>
        </div>

        {/* ── Desktop: the menu row ── */}
        <nav className="hidden lg:block" aria-label="Site">
          <ul className="flex items-center justify-center gap-9 xl:gap-12">
            <DropdownNavItem label="Auction Calendar" href="/auctions">
              <div className="py-2 min-w-[220px]">
                {CALENDAR_LINKS.map(l => <Link key={l.href} href={l.href}>{l.label}</Link>)}
              </div>
            </DropdownNavItem>

            <DropdownNavItem label="Departments" href="/departments" wide>
              {/* Two columns filled DOWN, as the live site's menu reads; long names wrap rather than run into the next column. */}
              <div className="p-4 w-[640px]">
                <div className="grid grid-cols-2 gap-x-6">
                  {columns.map((column, i) => (
                    <div key={i} className="min-w-0">
                      {column.map(dept => <Link key={dept.label} href={dept.href} className="!whitespace-normal leading-snug">{dept.label}</Link>)}
                    </div>
                  ))}
                </div>
                <div className="border-t border-[var(--vs-line)] mt-3 pt-3">
                  <Link href="/departments" className="vs-link vs-link-sm !inline-flex !px-[18px] !py-1">View all departments</Link>
                </div>
              </div>
            </DropdownNavItem>

            {PLAIN_LINKS.map(l => (
              <li key={l.href}><Link href={l.href} className="vs-nav-link">{l.label}</Link></li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}
