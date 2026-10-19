import Link from "next/link"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

// Contact Us on the test website — the nav's CONTACT US used to lead to the auction list (Jordan,
// 2026-09-24). Laid out as vectis.co.uk's: the title with its short navy rule, the four mailboxes
// as "what it's for / address" pairs like the footer, and "Find us" — phone, hours, address — in
// a navy box beside them. Everything here is from the company facts and the live page's own
// wording: the Thornaby address, the phone number, the office hours and the four mailboxes with
// what each is for. Nothing is invented.
export async function generateMetadata() {
  return pageMetadata("contact", {
    title: "Contact Us",
    description: "How to reach Vectis Auctions in Thornaby — phone, email and office hours, and which address to write to about selling, an order, or a parcel.",
  })
}

const MAILBOXES: { email: string; about: string; blurb: string }[] = [
  { email: "collections@vectis.co.uk", about: "Selling with us", blurb: "Auctioning your collectables — a free valuation and how a sale works." },
  { email: "admin@vectis.co.uk", about: "General enquiries", blurb: "Anything else — the office team will point you to the right person." },
  { email: "accounts@vectis.co.uk", about: "Accounts", blurb: "Invoices, payments and anything about money owed or due." },
  { email: "dispatch@vectis.co.uk", about: "Postage & packing", blurb: "Where your parcel is, shipping costs, and collecting in person." },
]

export default async function ContactPage() {
  // The page editor's published version (Website → Pages) when there is one; the built-in design otherwise.
  const page = await publishedPage("contact")
  if (page) return <PageBlocks data={page.data} />
  return (
    <div className="vs-page">
      <div className="vs-container">
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>
        <h1 className="vs-h2 vs-rule">Contact Us</h1>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] gap-10 lg:gap-16 mt-8">
          {/* Who to write to */}
          <div className="max-w-[760px]">
            <p className="vs-lead mb-8">
              Please don&apos;t hesitate to contact us on one of the addresses below if you have any questions or problems.
            </p>

            <h2 className="vs-h4 uppercase tracking-[1px] mb-4">Email</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
              {MAILBOXES.map(m => (
                <li key={m.email}>
                  <p className="font-medium">{m.about}</p>
                  <a href={`mailto:${m.email}`} className="vs-text-link break-all">{m.email}</a>
                  <p className="text-sm vs-muted mt-1">{m.blurb}</p>
                </li>
              ))}
            </ul>

            <h2 className="vs-h4 uppercase tracking-[1px] mt-10 mb-3">Before you write</h2>
            <div className="vs-prose">
              <ul>
                <li>Thinking of selling? <Link href="/sell-with-us">Sell with us</Link> explains the free valuation.</li>
                <li>New to bidding? <Link href="/how-to-bid">How to bid</Link> covers online, commission and telephone bids.</li>
                <li>Fees, postage and payment questions are answered in the <Link href="/faq">FAQs</Link>.</li>
              </ul>
            </div>
          </div>

          {/* Where and when */}
          <aside className="bg-[var(--vs-navy)] text-white p-7 sm:p-8 self-start" aria-labelledby="find-us">
            <h2 id="find-us" className="vs-h3 !text-white mb-6">Find us</h2>

            <p className="vs-caps text-white/70 mb-1">Telephone</p>
            <a href="tel:+441642750616" className="inline-block text-2xl font-medium text-white hover:underline">+44 (0)1642 750616</a>

            <p className="vs-caps text-white/70 mt-7 mb-1">Office hours</p>
            <p>Monday to Friday, 9:00am – 5:00pm (UK time).<br />Closed at weekends.</p>

            <p className="vs-caps text-white/70 mt-7 mb-1">Address</p>
            <address className="not-italic">
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
