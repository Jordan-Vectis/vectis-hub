import SiteNav from "@/components/site-nav"
import Image from "next/image"
import type { Metadata } from "next"
import { auth } from "@/auth"
import HubReturn from "./hub-return"
import "./site.css"

export const metadata: Metadata = {
  metadataBase: new URL("https://www.vectis.co.uk"),
  title: {
    default: "Vectis Auctions — World's No.1 Diecast Specialist",
    template: "%s — Vectis Auctions",
  },
  description:
    "Vectis Auctions is the world's leading specialist auction house for diecast, tinplate and collectable toys. Browse catalogues, bid live, and sell your collection.",
  keywords: [
    "diecast auctions", "toy auctions", "Vectis", "collectable toys",
    "Matchbox", "Corgi", "Dinky", "diecast specialist", "online bidding",
  ],
  openGraph: {
    siteName: "Vectis Auctions",
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    site: "@VectisAuctions",
  },
  robots: { index: true, follow: true },
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Staff see the test site while signed in to the Hub; admins get a small way back to it.
  const session = await auth().catch(() => null)
  const isAdmin = session?.user?.role === "ADMIN"
  return (
    <div className="vectis-site min-h-screen flex flex-col bg-white">
      <SiteNav />
      <main className="flex-1">{children}</main>
      {isAdmin && <HubReturn />}

      {/* Footer */}
      <footer className="bg-[#1e1f5e] text-white mt-16">
        {/* Red top accent */}
        <div className="h-1 bg-[#DB0606]" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
            <div>
              <h4 className="text-[10px] font-black tracking-[0.25em] uppercase mb-4 text-[#DB0606]">Auction Calendar</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                <li><a href="/auctions" className="hover:text-white transition-colors">Upcoming Auctions</a></li>
                <li><a href="/auctions?tab=past" className="hover:text-white transition-colors">Past Auctions</a></li>
                <li><a href="/auctions?tab=past" className="hover:text-white transition-colors">Auction Results</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] font-black tracking-[0.25em] uppercase mb-4 text-[#DB0606]">Bidding</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                <li><a href="/portal/register" className="hover:text-white transition-colors">Register to Bid</a></li>
                <li><a href="/portal/login" className="hover:text-white transition-colors">Online Bidding</a></li>
                <li><a href="/how-to-bid" className="hover:text-white transition-colors">How to Bid</a></li>
                <li><a href="/faq" className="hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] font-black tracking-[0.25em] uppercase mb-4 text-[#DB0606]">Selling</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                <li><a href="/sell-with-us" className="hover:text-white transition-colors">Sell With Us</a></li>
                <li><a href="/sell-with-us" className="hover:text-white transition-colors">Free Valuation</a></li>
                <li><a href="/account/sales" className="hover:text-white transition-colors">My Consignments</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] font-black tracking-[0.25em] uppercase mb-4 text-[#DB0606]">My Account</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                <li><a href="/account" className="hover:text-white transition-colors">My Details</a></li>
                <li><a href="/account/bids" className="hover:text-white transition-colors">My Bids</a></li>
                <li><a href="/account/sales" className="hover:text-white transition-colors">My Sales</a></li>
                <li><a href="/careers" className="hover:text-white transition-colors">Careers</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
            {/* Footer logo */}
            <div>
              <Image
                src="/vectis-logo.svg"
                alt="Vectis Auctions"
                width={140}
                height={57}
                className="object-contain brightness-0 invert opacity-75"
              />
            </div>

            <div className="text-center sm:text-right space-y-1">
              <p>&copy; {new Date().getFullYear()} Vectis Auctions Ltd. All rights reserved.</p>
              <p className="text-gray-600 text-[10px]">Stockton-on-Tees, United Kingdom</p>
              <p className="text-[10px] space-x-2">
                <a href="/terms" className="hover:text-white transition-colors">Terms &amp; Conditions</a>
                <span className="text-gray-700">·</span>
                <a href="/faq" className="hover:text-white transition-colors">FAQ</a>
                <span className="text-gray-700">·</span>
                <a href="/careers" className="hover:text-white transition-colors">Careers</a>
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
