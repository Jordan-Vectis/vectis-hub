"use client"

// The FAQ page's built-in design (the fold-outs open and close in the browser). The page itself
// (./page.tsx) shows the page editor's published version instead when there is one.

import { useState } from "react"
import Link from "next/link"

const sections = [
  {
    heading: "Bidding",
    faqs: [
      {
        q: "How can I bid?",
        a: "There are several ways to bid at Vectis. You can bid online via our website after registering and accepting the terms. You can also bid through The Saleroom platform, bid live online on auction day, arrange telephone bidding (minimum £100 per lot, arranged in advance), or submit absentee bids by post or email before the sale.",
      },
      {
        q: "How do I bid live using the Vectis website?",
        a: "Log in or register at our website, view upcoming auctions and select 'Register to Bid Live', then accept the terms and conditions. During the live auction, click the bid amount buttons to submit your bids. Your status is displayed in green if you are the highest bidder, or red if you have been outbid.",
      },
      {
        q: "What are the bidding increments?",
        a: "Bids are accepted in set increments based on the current bid value: £5–£50 in £5 steps; £50–£200 in £10 steps; £200–£700 in £20 steps; £700–£1,000 in £50 steps; £1,000–£3,000 in £100 steps; £3,000–£7,000 in £200 steps; £7,000–£10,000 in £500 steps; £10,000+ in £1,000 steps. Non-standard bids are rounded up to the nearest valid amount.",
      },
      {
        q: "What is the reserve price?",
        a: "A reserve is set at 60% of the bottom estimate for all lots. If your bid does not meet this level you will need to increase your bid.",
      },
      {
        q: "Can I bid by telephone?",
        a: "Yes. There is a £100 minimum for telephone bids. The service is available for all lots over £100 at no charge. One of our team will call you several minutes before your lot is offered. Please note we cannot guarantee all telephone requests will be honoured due to high demand — always arrange in advance.",
      },
    ],
  },
  {
    heading: "Buying",
    faqs: [
      {
        q: "What is the Buyer's Premium?",
        a: "The Buyer's Premium is 22.5% plus VAT (27% total) on every lot purchased through the Vectis website. If you bid through The Saleroom platform, a combined premium of 32.94% applies, which includes VAT and Saleroom charges.",
      },
      {
        q: "What payment methods are accepted?",
        a: "We accept credit and debit cards, bank transfers, and cheques (with bank guarantee or prior arrangement for amounts exceeding guarantee limits). American Express is not accepted.",
      },
      {
        q: "What if there is an error in the catalogue description?",
        a: "Please contact us if you believe there is an error. We will always sell a lot based on the description rather than the image if a discrepancy exists. All catalogue statements are statements of opinion and are not warranties.",
      },
    ],
  },
  {
    heading: "Payment",
    faqs: [
      {
        q: "I have won a lot — what do I do now?",
        a: "Invoices are emailed after the auction completes. You can set 'Auto Invoice Payment' in your account settings to automatically charge your registered payment method, or arrange manual payment after receiving your invoice. Once paid, your items will be dispatched.",
      },
      {
        q: "How can I pay for my winning lots?",
        a: "Register a credit or debit card on your account (required for live bidding but you may use a different card for payment). Enable auto-payment in your account for the fastest dispatch processing. You can alternatively pay by bank transfer after receiving your invoice.",
      },
    ],
  },
  {
    heading: "Selling",
    faqs: [
      {
        q: "What does Vectis charge for selling?",
        a: "Our commission rates are negotiable based on the value of your collection. Commission is all-inclusive plus VAT (VAT applies only to the commission, not the hammer price). Contact us for a personalised quote.",
      },
      {
        q: "How do I start selling through auction?",
        a: "Send a list of your items with photographs to collections@vectis.co.uk, or write to our Thornaby office. Our specialists will evaluate your collection free of charge. You can also mail items directly, bring them to one of our toy fairs, visit the office in person, or we can arrange a collection for larger consignments.",
      },
      {
        q: "What is Pre-Sales Advice?",
        a: "After your collection has been catalogued, you can access your pre-sale paperwork through your account under 'My Sales'. This shows lot numbers, descriptions and estimates before the auction. After the sale, post-sale advice shows your selling prices and vendor statements show the final payment due to you, typically within approximately 25 working days of the sale.",
      },
    ],
  },
  {
    heading: "Post & Packing",
    faqs: [
      {
        q: "What are the post and packing charges?",
        a: "UK postage starts from £14.95 for small items and £24.95+ for larger lots, with surcharges for additional items. International shipping varies by Parcel Force destination zone (Zone 6–9 for Europe; quotes provided for the rest of the world). Average shipping time is 14 days, though peak periods may extend to 28 days.",
      },
      {
        q: "Will my parcel be insured?",
        a: "Yes. All parcels are dispatched fully insured and traceable via courier or Royal Mail.",
      },
      {
        q: "I am based in the USA — can I have items shipped?",
        a: "Yes, we ship worldwide including to the USA. Please note that US orders may be subject to import tariffs of 10–50% depending on the goods, as determined by US customs.",
      },
    ],
  },
  {
    heading: "Condition & Grading",
    faqs: [
      {
        q: "How does Vectis grade toys?",
        a: "We use a six-point scale: Mint (perfect, as new); Near Mint (almost perfect with minimal flaws); Excellent (carefully used with minor imperfections); Good (obvious imperfections from use); Fair (heavy wear or major imperfections); Poor (very distressed condition). Please note no warranty can be given to the mechanical or electrical operation of any item.",
      },
      {
        q: "Does Vectis test toys for working order?",
        a: "No. All items are sold as collectors' items and are not tested for mechanical or electrical operation unless specifically stated in the lot description.",
      },
      {
        q: "How does Vectis grade vinyl records?",
        a: "Vinyl is graded on a six-point scale: Mint (brand new, no marks); Excellent (played slightly, minimal marks); Very Good (played many times with noticeable marks); Good (noticeably deteriorated sound quality); Fair (considerable surface noise, just playable); Poor (will not play properly).",
      },
    ],
  },
  {
    heading: "Problem Purchases",
    faqs: [
      {
        q: "I have a problem with my purchase — what should I do?",
        a: "First review the lot description and grading carefully in the catalogue. If you still have a concern, contact us using the returns form and send detailed photographs of any damage to returns@vectis.co.uk. Only claims submitted through the official returns process will be considered. Written claims must be submitted within ten days of the sale.",
      },
    ],
  },
]

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between text-left py-4 px-0 gap-4 group"
      >
        <span className="text-gray-800 font-semibold text-sm group-hover:text-[#1e1f5e] transition-colors">
          {q}
        </span>
        <svg
          className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="pb-5 pr-8">
          <p className="text-gray-600 text-sm leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  )
}

export default function FaqBuiltIn() {
  return (
    <div className="bg-white">

      {/* Hero */}
      <div className="bg-[#1e1f5e] text-white py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-[#DB0606] text-xs font-black uppercase tracking-widest mb-3">Help Centre</p>
          <h1 className="text-4xl font-black mb-4">Frequently Asked Questions</h1>
          <p className="text-white/70 text-lg max-w-2xl">
            Everything you need to know about bidding, buying, selling and shipping at Vectis Auctions.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-14">

        {/* Quick links */}
        <div className="flex flex-wrap gap-2 mb-12">
          {sections.map(s => (
            <a
              key={s.heading}
              href={`#${s.heading.toLowerCase().replace(/ /g, "-")}`}
              className="text-xs font-bold uppercase tracking-widest border border-[#1e1f5e] text-[#1e1f5e] hover:bg-[#1e1f5e] hover:text-white px-4 py-2 transition-colors"
            >
              {s.heading}
            </a>
          ))}
        </div>

        <div className="space-y-12">
          {sections.map(section => (
            <section key={section.heading} id={section.heading.toLowerCase().replace(/ /g, "-")}>
              <h2 className="text-xs font-black uppercase tracking-widest text-[#DB0606] mb-4 pb-2 border-b border-gray-200">
                {section.heading}
              </h2>
              <div>
                {section.faqs.map((faq, i) => (
                  <FaqItem key={i} q={faq.q} a={faq.a} />
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Still need help */}
        <div className="mt-16 bg-gray-50 border border-gray-200 p-8 text-center">
          <h3 className="text-lg font-black text-gray-900 mb-2">Still have a question?</h3>
          <p className="text-gray-500 text-sm mb-6">Our team is available Monday – Friday, 9:00 am – 5:00 pm.</p>
          <div className="flex items-center justify-center gap-4 flex-wrap text-sm">
            <a href="tel:+441642750616" className="text-[#1e1f5e] font-bold hover:underline">+44 (0)1642 750 616</a>
            <span className="text-gray-300">|</span>
            <a href="mailto:admin@vectis.co.uk" className="text-[#1e1f5e] font-bold hover:underline">admin@vectis.co.uk</a>
          </div>
        </div>
      </div>
    </div>
  )
}
