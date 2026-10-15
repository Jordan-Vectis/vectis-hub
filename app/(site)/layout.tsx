import SiteNav from "@/components/site-nav"
import type { Metadata } from "next"
import { auth } from "@/auth"
import HubReturn from "./hub-return"
import { barlow } from "./site-font"
import "./site.css"

export const metadata: Metadata = {
  metadataBase: new URL("https://www.vectis.co.uk"),
  title: {
    default: "Vectis Auctions | The UK's Largest Toy & Collectables Auctioneer",
    template: "%s | Vectis Auctions",
  },
  description:
    "Vectis is the world's leading specialist toy and collectables auction house — over 70,000 lots a year, from Star Wars to Barbie, trains to military figures, Matchbox to vinyl. Browse catalogues, bid live and sell your collection.",
  keywords: [
    "toy auctions", "collectables auctions", "Vectis", "diecast auctions", "Star Wars auctions",
    "Matchbox", "Corgi", "Dinky", "model railway auctions", "online bidding",
  ],
  openGraph: {
    siteName: "Vectis Auctions",
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    site: "@vectisauctions",
  },
  robots: { index: true, follow: true },
}

// The footer's links only ever point at pages the test site actually has — a dead link is the
// quickest way for a site to feel broken.
const FOOTER_MENU_ONE = [
  { label: "How to Bid", href: "/how-to-bid" },
  { label: "Auction Calendar", href: "/auctions" },
  { label: "Auction Results", href: "/auctions?tab=past" },
  { label: "Departments", href: "/departments" },
  { label: "Sell With Us", href: "/sell-with-us" },
]
const FOOTER_MENU_TWO = [
  { label: "News & Stories", href: "/news-stories/news" },
  { label: "Careers", href: "/careers" },
  { label: "Contact Us", href: "/contact" },
  { label: "Terms", href: "/terms" },
  { label: "Frequently Asked Questions", href: "/faq" },
]
const SOCIAL = [
  { label: "Facebook", href: "https://www.facebook.com/vectisauctions/", path: "M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07c0 6.02 4.39 11.02 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.09 24 12.07z" },
  { label: "Instagram", href: "https://www.instagram.com/vectisauctions/", path: "M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.2-4.35-2.62-6.78-6.98-6.98C15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" },
  { label: "X (Twitter)", href: "https://twitter.com/vectisauctions", path: "M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z" },
  { label: "YouTube", href: "https://www.youtube.com/user/VectisToyAuctions", path: "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6z" },
]

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Staff see the test site while signed in to the Hub; admins get a small way back to it.
  const session = await auth().catch(() => null)
  const isAdmin = session?.user?.role === "ADMIN"
  return (
    <div className={`vectis-site ${barlow.variable} min-h-screen flex flex-col bg-white`}>
      <SiteNav />
      <main className="flex-1">{children}</main>
      {isAdmin && <HubReturn />}

      {/* ── Footer — the same four columns as vectis.co.uk: who we are, the mailboxes, two menus ── */}
      <footer className="vs-footer mt-16">
        <div className="vs-container pt-14 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-6">
            <div className="md:col-span-4 lg:col-span-3">
              {/* The logo as an <img>: it is an SVG, so next/image would add nothing. */}
              <a href="/" title="Vectis Auctions" className="inline-block">
                <img src="/vectis-logo.svg" alt="Vectis Auctions" width={222} height={90} style={{ height: 90, width: "auto" }} loading="lazy" />
              </a>
              <p className="mt-6 text-sm"><b>Head Office - Thornaby</b></p>
              <p className="text-sm"><a href="tel:+441642750616">(+44) 01642 750 616</a></p>
              <p className="mt-4 text-sm"><b>Email:</b> <a href="mailto:admin@vectis.co.uk" className="!text-black">admin@vectis.co.uk</a></p>
            </div>

            <div className="md:col-span-8 lg:col-span-5 space-y-3 text-sm">
              <p>Information on auctioning your collectables<br /><a href="mailto:collections@vectis.co.uk">collections@vectis.co.uk</a></p>
              <p>General enquiries<br /><a href="mailto:admin@vectis.co.uk">admin@vectis.co.uk</a></p>
              <p>Accounts and payable queries<br /><a href="mailto:accounts@vectis.co.uk">accounts@vectis.co.uk</a></p>
              <p>Postage and packing enquiries<br /><a href="mailto:dispatch@vectis.co.uk">dispatch@vectis.co.uk</a></p>
            </div>

            <nav className="md:col-span-4 lg:col-span-2 vs-footer-menu" aria-label="Footer">
              <ul className="text-sm">
                {FOOTER_MENU_ONE.map(l => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}
              </ul>
            </nav>
            <nav className="md:col-span-4 lg:col-span-2 vs-footer-menu" aria-label="Footer, continued">
              <ul className="text-sm">
                {FOOTER_MENU_TWO.map(l => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}
              </ul>
            </nav>
          </div>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-6">
            <ul className="vs-footer-social flex items-center gap-2" aria-label="Vectis on social media">
              {SOCIAL.map(s => (
                <li key={s.label}>
                  <a href={s.href} target="_blank" rel="noreferrer" title={s.label} aria-label={s.label}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={s.path} /></svg>
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-xs" style={{ color: "rgba(0,0,0,0.5)" }}>Vectis Auctions Ltd · Fleck Way, Thornaby, Stockton-on-Tees, TS17 9JZ</p>
          </div>

          <p className="vs-footer-copy mt-10">© Copyright {new Date().getFullYear()} Vectis Auctions Ltd | All rights reserved</p>
        </div>
      </footer>
    </div>
  )
}
