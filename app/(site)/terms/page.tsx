import Link from "next/link"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

// Terms & Conditions on the test website, laid out as vectis.co.uk's text pages are: the title with
// its short navy rule, a line under it, three parts (General / Sellers / Buyers) with the numbered
// clauses as running copy in a 900px column.

export async function generateMetadata() {
  return pageMetadata("terms", {
    title: "Terms & Conditions",
    description: "Vectis Auctions terms and conditions for buyers and sellers.",
  })
}

const PARTS = [
  { id: "general", label: "General" },
  { id: "sellers", label: "Sellers" },
  { id: "buyers", label: "Buyers" },
]

export default async function TermsPage() {
  // The page editor's published version (Website → Pages) when there is one; the built-in design otherwise.
  const page = await publishedPage("terms")
  if (page) return <PageBlocks data={page.data} />
  return (
    <div className="vs-page">
      <div className="vs-container">
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>
        <h1 className="vs-h2 vs-rule">Terms &amp; Conditions</h1>

        <div className="max-w-[900px]">
          <p className="vs-lead mt-8">Vectis Auctions Limited — Conditions of Business for Buyers and Sellers</p>

          {/* Jump to a part */}
          <nav aria-label="Parts of the terms" className="flex flex-wrap gap-x-6 gap-y-1 mt-5">
            {PARTS.map(p => <a key={p.id} href={`#${p.id}`} className="vs-link vs-link-sm min-h-[44px]">{p.label}</a>)}
          </nav>

          <div className="mt-10 space-y-12">

            {/* General */}
            <section id="general" className="scroll-mt-24">
              <h2 className="vs-h3 pb-3 mb-4 border-b border-[var(--vs-navy)]">General Conditions</h2>
              <div className="vs-prose">
                <h3>1. Agency</h3>
                <p>Vectis Auctions Limited act only as auctioneers and agents for the seller. All transactions are conducted on behalf of the vendor unless otherwise stated.</p>

                <h3>2. Accuracy &amp; Liability</h3>
                <p>The auctioneer makes every effort toward catalogue accuracy but sells all lots &ldquo;with all faults, imperfections and errors of description.&rdquo; Vectis Auctions Limited disclaims responsibility for the authenticity of any lot unless explicitly instructed otherwise by the seller in writing.</p>

                <h3>3. Catalogue Statements</h3>
                <p>All statements, whether printed in the catalogue or made orally, are statements of opinion only and are not to be taken as being or implying any warranties or representations of fact.</p>

                <h3>4. Claims</h3>
                <p>Buyers must submit written claims within ten days of the date of sale.</p>

                <h3>5. Auctioneer&apos;s Discretion</h3>
                <p>The auctioneer reserves the right to divide lots, combine lots, withdraw items, refuse bids, or cancel sales at any time without prior notice. In the event of a dispute the auctioneer&apos;s decision is final. The highest bidder acknowledged by the auctioneer shall be the buyer.</p>

                <h3>6. Reserve Prices</h3>
                <p>Lots are sold without reserve unless written reserve instructions are received prior to the sale. Where a reserve price is set and not met, the auctioneer may continue to offer the lot privately at or above the reserve price.</p>

                <h3>7. Forgery &amp; Rescission</h3>
                <p>Within fourteen days of purchase, a buyer who can demonstrate to the auctioneer&apos;s satisfaction that a lot is a deliberate forgery may return the item in its original condition for a full refund of the purchase price.</p>

                <h3>8. Third-Party Liability</h3>
                <p>Visitors to our premises assume all risk of personal injury or property damage. Vectis Auctions Limited disclaims all liability for injury or damage except that arising directly from the negligence of its own employees.</p>
              </div>
            </section>

            {/* Sellers */}
            <section id="sellers" className="scroll-mt-24">
              <h2 className="vs-h3 pb-3 mb-4 border-b border-[var(--vs-navy)]">Conditions for Sellers</h2>
              <div className="vs-prose">
                <h3>9. Delivery &amp; Acceptance</h3>
                <p>Goods delivered to Vectis become part of our auction inventory unless otherwise agreed in writing. Delivery of goods constitutes full acceptance of all conditions herein.</p>

                <h3>10. Collection of Goods</h3>
                <p>Vectis acts as agent in arranging collection of goods from vendors. We accept no responsibility for loss or damage caused by third-party collection contractors.</p>

                <h3>11. Storage</h3>
                <p>The auctioneer reserves the right to store goods as required and accepts no liability for loss or damage to stored goods except where caused by direct employee negligence. Storage charges may apply in certain circumstances.</p>

                <h3>12. Unsold Items</h3>
                <p>If goods remain uncollected twenty-one days after a removal request has been issued, Vectis Auctions Limited reserves the right to sell the goods to defray costs and outstanding storage charges.</p>

                <h3>13. Insurance</h3>
                <p>Unless instructed otherwise in writing, goods consigned to Vectis are insured against fire, burglary and water damage at their estimated auction value. Vectis is not responsible for uninsured items or accidental damage unless caused by employee negligence.</p>

                <h3>14. Reserve Prices</h3>
                <p>All reserves must be agreed by both Vectis Auctions Limited and the vendor. Where reserves are set without agreement and lots fail to sell, a charge of 7.5% of the agreed or estimated value will apply. For lots withdrawn after printing has commenced, a charge of 25% of the bottom estimate or reserve (whichever is greater) applies. For lots withdrawn before printing, the charge is 15%.</p>

                <h3>15. Vendor Indemnity</h3>
                <p>Sellers indemnify Vectis Auctions Limited against all claims, costs and expenses arising from or relating to goods consigned and sold on their behalf.</p>

                <h3>16. VAT</h3>
                <p>Vendors registered for VAT must declare their VAT status and registration number before delivery of goods.</p>

                <h3>17. Payment to Vendors</h3>
                <p>Net proceeds (hammer price less agreed commission, expenses and applicable charges) are transferred to the vendor within twenty-five working days of receipt of full payment from the buyer.</p>

                <h3>18. Photography &amp; Images</h3>
                <p>Vectis Auctions Limited retains absolute rights to photograph all consigned lots and use such images at its discretion for marketing, cataloguing and archival purposes.</p>
              </div>
            </section>

            {/* Buyers */}
            <section id="buyers" className="scroll-mt-24">
              <h2 className="vs-h3 pb-3 mb-4 border-b border-[var(--vs-navy)]">Conditions for Buyers</h2>
              <div className="vs-prose">
                <h3>19. Inspection &amp; Risk</h3>
                <p>Buyers must satisfy themselves as to the condition of lots before bidding. Each lot is at the sole risk of the buyer from the fall of the hammer. Vectis accepts no liability for damage or loss after this point.</p>

                <h3>20. Title &amp; Ownership</h3>
                <p>Legal title to a purchased lot does not pass to the buyer until full payment has been received. Vectis retains a lien on all lots until payment is cleared in full.</p>

                <h3>21. Bidding as Principal</h3>
                <p>All bidders are deemed to act as principals unless prior written acknowledgement confirms agent status on behalf of a named principal.</p>

                <h3>22. Bidding Increments</h3>
                <p>Bids must conform to the published increment scale. Odd-figure bids are rounded up to the next valid increment. In the event of tied bids, the first bid received takes precedence.</p>
                <table className="w-full max-w-[440px]">
                  <thead>
                    <tr>
                      <th scope="col">Bid Range</th>
                      <th scope="col">Increment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["£5 – £50", "£5"], ["£50 – £200", "£10"], ["£200 – £700", "£20"],
                      ["£700 – £1,000", "£50"], ["£1,000 – £3,000", "£100"],
                      ["£3,000 – £7,000", "£200"], ["£7,000 – £10,000", "£500"], ["£10,000+", "£1,000"],
                    ].map(([range, inc]) => (
                      <tr key={range}>
                        <td>{range}</td>
                        <td>{inc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3>23. Collection &amp; Removal of Lots</h3>
                <p>Lots must be collected on the day of sale and paid in full before removal. Postal bidders have seven days to arrange payment and collection (fourteen days for international buyers). All lots are sent at the buyer&apos;s risk although every effort is made to pack items safely.</p>

                <h3>24. Post-Removal Responsibility</h3>
                <p>Once goods have been removed from our premises by or on behalf of the buyer, no further responsibility for loss or damage, however or whenever caused, can be accepted by Vectis Auctions Limited.</p>

                <h3>25. Payment Methods</h3>
                <p>We accept cash, debit cards, credit cards (excluding American Express), cheques and bank transfers. Cheques exceeding bank guarantee limits require prior arrangement or same-day collection from established buyers.</p>

                <h3>26. Commission / Absentee Bids</h3>
                <p>The auctioneer will execute absentee bids at no charge to the bidder. However, Vectis Auctions Limited accepts no responsibility for any errors or omissions in the execution of such bids.</p>

                <h3>27. Buyer&apos;s Premium</h3>
                <p>Every buyer will pay on individual lots a sum equal to <strong>22.5% of the hammer price exclusive of VAT</strong> (27% total) as a buyer&apos;s premium. If purchasing through The Saleroom platform, a combined premium of 32.94% applies including VAT and Saleroom charges.</p>

                <h3>28. Mechanical &amp; Electrical Items</h3>
                <p>Items sold in our auctions are sold as collectors&apos; items only. No warranty is given to the mechanical or electrical operation of any item unless specifically stated in the lot description.</p>
              </div>
            </section>

            {/* Footer note */}
            <div className="vs-band p-6 text-sm">
              <p className="font-bold mb-1">Vectis Auctions Limited</p>
              <p>Registered in England &amp; Wales. Head office: Thornaby, Stockton-on-Tees, United Kingdom.</p>
              <p className="mt-2">These terms and conditions are subject to change. For the most up-to-date version please contact us at <a href="mailto:admin@vectis.co.uk" className="vs-text-link">admin@vectis.co.uk</a>.</p>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
