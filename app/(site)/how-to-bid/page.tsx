// How to Bid on the test website — the live site's wording (Jordan, 2026-09-24), laid out as
// vectis.co.uk lays it out: "‹ BACK TO HOME", the title with its short navy rule, small capital
// section headings ("BID ONLINE", "BEFORE THE SALE"), plain paragraphs, the increments as a
// two-column table and the two closing notes. Prose reads best at a measured width, so the copy
// sits in a 900px column on the left of the page.

import Link from "next/link"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

export async function generateMetadata() {
  return pageMetadata("how-to-bid", {
    title: "How to Bid",
    description: "Bid online, leave a commission bid before the sale, or bid by telephone — how bidding at Vectis works, with the bidding increments and the buyer's premium.",
  })
}

const INCREMENTS: [string, string][] = [
  ["£5 - £50", "£5"],
  ["£50 - £200", "£10"],
  ["£200 - £700", "£20"],
  ["£700 - £1,000", "£50"],
  ["£1,000 - £3,000", "£100"],
  ["£3,000 - £7,000", "£200"],
  ["£7,000 - £10,000", "£500"],
  ["£10,000+", "£1000"],
]

// A section heading sits OUTSIDE the prose block: inside it the running-copy rules would size an
// h2 at 26px, and the live page shows these as small capitals.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="vs-h4 uppercase tracking-[1px] mb-3">{title}</h2>
      <div className="vs-prose">{children}</div>
    </section>
  )
}

export default async function HowToBidPage() {
  // The page editor's published version (Website → Pages) when there is one; the built-in design otherwise.
  const page = await publishedPage("how-to-bid")
  if (page) return <PageBlocks data={page.data} />
  return (
    <div className="vs-page">
      <div className="vs-container">
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>
        <h1 className="vs-h2 vs-rule">How to Bid</h1>

        <div className="max-w-[900px]">
          <p className="vs-lead mt-8">There are several ways you can bid in one of our auctions.</p>

          <Section title="Bid online">
            <p>The best, quickest and most convenient way to bid is on our website, you can do this by creating an account. When your account has been approved you will be able to, keep track of your bids, view your favourite items, view your purchased items and track your parcels</p>
          </Section>

          <Section title="Before the sale">
            <p>You can tell us what is the maximum you want to bid and we&rsquo;ll bid on your behalf up to the maximum you are willing to pay.</p>
            <p>To contact us by telephone please call <a href="tel:+441642750616">+44 (0) 1642 750616</a>. Offices are open Monday to Friday 9.00am until 5.00pm (UK time).</p>
            <p>Email us at <a href="mailto:admin@vectis.co.uk">admin@vectis.co.uk</a></p>
          </Section>

          <Section title="Telephone bidding">
            <p>As of the August 2023 auctions, there is a £100 minimum phone bid in effect</p>
            <p>If you would like to bid live via the telephone please contact us prior to the day of the auction on <a href="tel:+441642750616">+44 (0) 1642 750616</a>. On the day of the sale you will need to be available so that we can contact you via the telephone during the live auction. This option is available for ALL LOTS OVER £100 and there is NO CHARGE to you. We will call you several minutes prior to the lot being offered for auction.</p>
            <p>We cannot guarantee that all telephone requests will be honoured due to the rising demand for telephone bidding. Although we will try to accommodate every request, we cannot be held responsible for any missed calls due to human or technical errors.</p>
          </Section>

          <Section title="Bidding increments">
            <p>We participate in &lsquo;live bidding&rsquo; for all sales. To enable us to do this the following bidding increments will apply</p>
            <table className="w-full max-w-[440px]">
              <thead>
                <tr>
                  <th scope="col">Value</th>
                  <th scope="col">Increment</th>
                </tr>
              </thead>
              <tbody>
                {INCREMENTS.map(([value, increment]) => (
                  <tr key={value}>
                    <td>{value}</td>
                    <td>{increment}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p><strong>Please Note:</strong> A reserve is set at 60% of bottom estimate for all Lots, if your bid does not meet this level you will need to bid again.</p>
            <p>The Buyers Premium is 22.5% +VAT (TOTAL 27%).</p>
          </Section>
        </div>
      </div>
    </div>
  )
}
