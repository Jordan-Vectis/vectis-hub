// How to Bid on the test website — the live site's wording (Jordan, 2026-09-24), laid out as the
// live page is: a heading with a short rule, small capital section headings, plain paragraphs, the
// increments as a two-column table. Prose reads best at a measured width, so the text sits in a
// wide-but-bounded column on the left of a full-width page.

export const metadata = {
  title: "How to Bid",
  description: "Bid online, leave a commission bid before the sale, or bid by telephone — how bidding at Vectis works, with the bidding increments and the buyer's premium.",
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

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-black uppercase tracking-wider text-gray-900 mt-8 mb-3">{children}</h2>
}

export default function HowToBidPage() {
  return (
    <div className="bg-white">
      <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 py-10">
        <h1 className="text-3xl font-black text-[#32348A]">How to Bid</h1>
        <div className="w-10 h-1 bg-[#32348A] mt-3 mb-6" aria-hidden="true" />

        <div className="max-w-5xl text-sm text-gray-800 leading-relaxed">
          <p>There are several ways you can bid in one of our auctions.</p>

          <H>Bid online</H>
          <p>The best, quickest and most convenient way to bid is on our website, you can do this by creating an account. When your account has been approved you will be able to, keep track of your bids, view your favourite items, view your purchased items and track your parcels</p>

          <H>Before the sale</H>
          <p>You can tell us what is the maximum you want to bid and we&rsquo;ll bid on your behalf up to the maximum you are willing to pay.</p>
          <p className="mt-3">To contact us by telephone please call <a href="tel:+441642750616" className="text-[#32348A] underline">+44 (0) 1642 750616</a>. Offices are open Monday to Friday 9.00am until 5.00pm (UK time).</p>
          <p className="mt-3">Email us at <a href="mailto:admin@vectis.co.uk" className="text-[#32348A] underline">admin@vectis.co.uk</a></p>

          <H>Telephone bidding</H>
          <p>As of the August 2023 auctions, there is a £100 minimum phone bid in effect</p>
          <p className="mt-3">If you would like to bid live via the telephone please contact us prior to the day of the auction on <a href="tel:+441642750616" className="text-[#32348A] underline">+44 (0) 1642 750616</a>. On the day of the sale you will need to be available so that we can contact you via the telephone during the live auction. This option is available for ALL LOTS OVER £100 and there is NO CHARGE to you. We will call you several minutes prior to the lot being offered for auction.</p>
          <p className="mt-3">We cannot guarantee that all telephone requests will be honoured due to the rising demand for telephone bidding. Although we will try to accommodate every request, we cannot be held responsible for any missed calls due to human or technical errors.</p>

          <H>Bidding increments</H>
          <p>We participate in &lsquo;live bidding&rsquo; for all sales. To enable us to do this the following bidding increments will apply</p>
          <table className="mt-4 text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-left font-black text-gray-900 pr-24 pb-1">Value</th>
                <th scope="col" className="text-left font-black text-gray-900 pb-1">Increment</th>
              </tr>
            </thead>
            <tbody>
              {INCREMENTS.map(([value, increment]) => (
                <tr key={value}>
                  <td className="pr-24 py-0.5 text-gray-700">{value}</td>
                  <td className="py-0.5 text-gray-700">{increment}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-8"><strong className="font-black text-gray-900">Please Note:</strong> A reserve is set at 60% of bottom estimate for all Lots, if your bid does not meet this level you will need to bid again.</p>
          <p className="mt-3">The Buyers Premium is 22.5% +VAT (TOTAL 27%).</p>
        </div>
      </div>
    </div>
  )
}
