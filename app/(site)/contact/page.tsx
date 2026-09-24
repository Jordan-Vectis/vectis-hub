import type { Metadata } from "next"
import Link from "next/link"

// Contact Us on the test website — the nav's CONTACT US used to lead to the auction list (Jordan,
// 2026-09-24). Everything here is from the company facts: the Thornaby address, the phone number,
// the office hours and the four mailboxes with what each is for. Nothing is invented.
export const metadata: Metadata = {
  title: "Contact Us",
  description: "How to reach Vectis Auctions in Thornaby — phone, email and office hours, and which address to write to about selling, an order, or a parcel.",
}

const MAILBOXES: { email: string; about: string; blurb: string }[] = [
  { email: "collections@vectis.co.uk", about: "Selling with us", blurb: "Auctioning your collectables — a free valuation and how a sale works." },
  { email: "admin@vectis.co.uk", about: "General enquiries", blurb: "Anything else — the office team will point you to the right person." },
  { email: "accounts@vectis.co.uk", about: "Accounts", blurb: "Invoices, payments and anything about money owed or due." },
  { email: "dispatch@vectis.co.uk", about: "Postage & packing", blurb: "Where your parcel is, shipping costs, and collecting in person." },
]

export default function ContactPage() {
  return (
    <div className="bg-white">
      <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 py-10">
        <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-2">Get in touch</p>
        <h1 className="text-3xl font-black text-[#32348A]">Contact Us</h1>
        <div className="h-1 w-12 bg-[#DB0606] mt-3 mb-8" />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(320px,420px)] gap-10">
          {/* Who to write to */}
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-gray-900 mb-4">Email — the right address gets the quickest answer</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {MAILBOXES.map(m => (
                <a key={m.email} href={`mailto:${m.email}`} className="block border border-gray-200 hover:border-[#32348A] p-5 transition-colors group">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#DB0606] mb-1">{m.about}</p>
                  <p className="text-[#32348A] font-black text-base group-hover:underline break-all">{m.email}</p>
                  <p className="text-gray-500 text-sm mt-2 leading-relaxed">{m.blurb}</p>
                </a>
              ))}
            </div>

            <h2 className="text-xs font-black uppercase tracking-wider text-gray-900 mt-10 mb-3">Before you write</h2>
            <ul className="text-sm text-gray-700 space-y-2">
              <li>Thinking of selling? <Link href="/sell-with-us" className="text-[#32348A] font-bold hover:underline">Sell with us</Link> explains the free valuation.</li>
              <li>New to bidding? <Link href="/how-to-bid" className="text-[#32348A] font-bold hover:underline">How to bid</Link> covers online, commission and telephone bids.</li>
              <li>Fees, postage and payment questions are answered in the <Link href="/faq" className="text-[#32348A] font-bold hover:underline">FAQs</Link>.</li>
            </ul>
          </div>

          {/* Where and when */}
          <aside className="bg-[#32348A] text-white p-7 self-start">
            <h2 className="text-xs font-black uppercase tracking-wider text-[#2AB4A6] mb-3">Telephone</h2>
            <a href="tel:+441642750616" className="block text-2xl font-black hover:underline">+44 (0)1642 750616</a>

            <h2 className="text-xs font-black uppercase tracking-wider text-[#2AB4A6] mt-7 mb-3">Office hours</h2>
            <p className="text-sm leading-relaxed">Monday to Friday, 9:00am – 5:00pm (UK time).<br />Closed at weekends.</p>

            <h2 className="text-xs font-black uppercase tracking-wider text-[#2AB4A6] mt-7 mb-3">Address</h2>
            <address className="not-italic text-sm leading-relaxed">
              Vectis Auctions Ltd<br />
              Fleck Way<br />
              Teesside Industrial Estate<br />
              Thornaby<br />
              TS17 9JZ<br />
              United Kingdom
            </address>
          </aside>
        </div>
      </div>
    </div>
  )
}
