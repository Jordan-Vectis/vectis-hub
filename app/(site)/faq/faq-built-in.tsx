// The FAQ page's built-in design, laid out as vectis.co.uk's: the title with its short navy rule,
// a section per topic, and each question as a <details> fold-out — the browser opens and closes
// them and turns the chevron on its own open state, so no script is needed and the page reads
// whole before any JavaScript arrives. The page itself (./page.tsx) shows the page editor's
// published version instead when there is one.

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

// The in-page anchors ("#bidding", "#post-&-packing") are spelt exactly as they always were, so a
// link made to one of them still lands.
const anchor = (heading: string) => heading.toLowerCase().replace(/ /g, "-")

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-[var(--vs-line)]">
      <summary className="flex items-center justify-between gap-4 py-4 cursor-pointer text-[18px] font-medium leading-snug text-[var(--vs-navy)] hover:text-[var(--vs-navy-dark)]">
        <span>{q}</span>
        <svg className="w-5 h-5 shrink-0 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <p className="pb-5 pr-9 max-w-[760px] leading-relaxed">{a}</p>
    </details>
  )
}

export default function FaqBuiltIn() {
  return (
    <div className="vs-page">
      <div className="vs-container">
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>
        <h1 className="vs-h2 vs-rule">Frequently Asked Questions</h1>

        <div className="max-w-[900px]">
          <p className="vs-lead mt-8">
            Everything you need to know about bidding, buying, selling and shipping at Vectis Auctions.
          </p>

          {/* Jump to a topic — the same anchors the sections carry. */}
          <nav aria-label="FAQ topics" className="flex flex-wrap gap-x-6 gap-y-1 mt-5">
            {sections.map(s => (
              <a key={s.heading} href={`#${anchor(s.heading)}`} className="vs-link vs-link-sm min-h-[44px]">{s.heading}</a>
            ))}
          </nav>

          <div className="mt-10 space-y-12">
            {sections.map(section => (
              <section key={section.heading} id={anchor(section.heading)} className="scroll-mt-24">
                <h2 className="vs-h3 pb-3 border-b border-[var(--vs-navy)]">{section.heading}</h2>
                {section.faqs.map(faq => (
                  <FaqItem key={faq.q} q={faq.q} a={faq.a} />
                ))}
              </section>
            ))}
          </div>

          {/* Still need help */}
          <div className="vs-band mt-16 p-8 text-center">
            <h2 className="vs-h4 mb-2">Still have a question?</h2>
            <p className="vs-muted mb-5">Our team is available Monday – Friday, 9:00 am – 5:00 pm.</p>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
              <a href="tel:+441642750616" className="vs-text-link">+44 (0)1642 750 616</a>
              <a href="mailto:admin@vectis.co.uk" className="vs-text-link">admin@vectis.co.uk</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
