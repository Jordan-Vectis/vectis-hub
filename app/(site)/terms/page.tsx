import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

export async function generateMetadata() {
  return pageMetadata("terms", {
    title: "Terms & Conditions",
    description: "Vectis Auctions terms and conditions for buyers and sellers.",
  })
}

export default async function TermsPage() {
  // The page editor's published version (Website → Pages) when there is one; the built-in design otherwise.
  const page = await publishedPage("terms")
  if (page) return <PageBlocks data={page.data} />
  return (
    <div className="bg-white">

      {/* Hero */}
      <div className="bg-[#1e1f5e] text-white py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-[#DB0606] text-xs font-black uppercase tracking-widest mb-3">Legal</p>
          <h1 className="text-4xl font-black mb-4">Terms &amp; Conditions</h1>
          <p className="text-white/70">Vectis Auctions Limited — Conditions of Business for Buyers and Sellers</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-14">

        {/* Quick nav */}
        <div className="flex flex-wrap gap-2 mb-12 text-xs">
          <a href="#general" className="border border-gray-300 text-gray-600 hover:border-[#1e1f5e] hover:text-[#1e1f5e] px-3 py-1.5 transition-colors font-semibold uppercase tracking-wider">General</a>
          <a href="#sellers" className="border border-gray-300 text-gray-600 hover:border-[#1e1f5e] hover:text-[#1e1f5e] px-3 py-1.5 transition-colors font-semibold uppercase tracking-wider">Sellers</a>
          <a href="#buyers" className="border border-gray-300 text-gray-600 hover:border-[#1e1f5e] hover:text-[#1e1f5e] px-3 py-1.5 transition-colors font-semibold uppercase tracking-wider">Buyers</a>
        </div>

        <div className="prose prose-gray max-w-none space-y-10 text-sm leading-relaxed">

          {/* General */}
          <section id="general">
            <h2 className="text-xl font-black text-gray-900 mb-6 pb-3 border-b border-gray-200 not-prose">
              General Conditions
            </h2>

            <div className="space-y-6 text-gray-600">
              <div>
                <h3 className="font-bold text-gray-800 mb-1">1. Agency</h3>
                <p>Vectis Auctions Limited act only as auctioneers and agents for the seller. All transactions are conducted on behalf of the vendor unless otherwise stated.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">2. Accuracy &amp; Liability</h3>
                <p>The auctioneer makes every effort toward catalogue accuracy but sells all lots &ldquo;with all faults, imperfections and errors of description.&rdquo; Vectis Auctions Limited disclaims responsibility for the authenticity of any lot unless explicitly instructed otherwise by the seller in writing.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">3. Catalogue Statements</h3>
                <p>All statements, whether printed in the catalogue or made orally, are statements of opinion only and are not to be taken as being or implying any warranties or representations of fact.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">4. Claims</h3>
                <p>Buyers must submit written claims within ten days of the date of sale.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">5. Auctioneer&apos;s Discretion</h3>
                <p>The auctioneer reserves the right to divide lots, combine lots, withdraw items, refuse bids, or cancel sales at any time without prior notice. In the event of a dispute the auctioneer&apos;s decision is final. The highest bidder acknowledged by the auctioneer shall be the buyer.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">6. Reserve Prices</h3>
                <p>Lots are sold without reserve unless written reserve instructions are received prior to the sale. Where a reserve price is set and not met, the auctioneer may continue to offer the lot privately at or above the reserve price.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">7. Forgery &amp; Rescission</h3>
                <p>Within fourteen days of purchase, a buyer who can demonstrate to the auctioneer&apos;s satisfaction that a lot is a deliberate forgery may return the item in its original condition for a full refund of the purchase price.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">8. Third-Party Liability</h3>
                <p>Visitors to our premises assume all risk of personal injury or property damage. Vectis Auctions Limited disclaims all liability for injury or damage except that arising directly from the negligence of its own employees.</p>
              </div>
            </div>
          </section>

          {/* Sellers */}
          <section id="sellers">
            <h2 className="text-xl font-black text-gray-900 mb-6 pb-3 border-b border-gray-200 not-prose">
              Conditions for Sellers
            </h2>

            <div className="space-y-6 text-gray-600">
              <div>
                <h3 className="font-bold text-gray-800 mb-1">9. Delivery &amp; Acceptance</h3>
                <p>Goods delivered to Vectis become part of our auction inventory unless otherwise agreed in writing. Delivery of goods constitutes full acceptance of all conditions herein.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">10. Collection of Goods</h3>
                <p>Vectis acts as agent in arranging collection of goods from vendors. We accept no responsibility for loss or damage caused by third-party collection contractors.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">11. Storage</h3>
                <p>The auctioneer reserves the right to store goods as required and accepts no liability for loss or damage to stored goods except where caused by direct employee negligence. Storage charges may apply in certain circumstances.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">12. Unsold Items</h3>
                <p>If goods remain uncollected twenty-one days after a removal request has been issued, Vectis Auctions Limited reserves the right to sell the goods to defray costs and outstanding storage charges.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">13. Insurance</h3>
                <p>Unless instructed otherwise in writing, goods consigned to Vectis are insured against fire, burglary and water damage at their estimated auction value. Vectis is not responsible for uninsured items or accidental damage unless caused by employee negligence.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">14. Reserve Prices</h3>
                <p>All reserves must be agreed by both Vectis Auctions Limited and the vendor. Where reserves are set without agreement and lots fail to sell, a charge of 7.5% of the agreed or estimated value will apply. For lots withdrawn after printing has commenced, a charge of 25% of the bottom estimate or reserve (whichever is greater) applies. For lots withdrawn before printing, the charge is 15%.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">15. Vendor Indemnity</h3>
                <p>Sellers indemnify Vectis Auctions Limited against all claims, costs and expenses arising from or relating to goods consigned and sold on their behalf.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">16. VAT</h3>
                <p>Vendors registered for VAT must declare their VAT status and registration number before delivery of goods.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">17. Payment to Vendors</h3>
                <p>Net proceeds (hammer price less agreed commission, expenses and applicable charges) are transferred to the vendor within twenty-five working days of receipt of full payment from the buyer.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">18. Photography &amp; Images</h3>
                <p>Vectis Auctions Limited retains absolute rights to photograph all consigned lots and use such images at its discretion for marketing, cataloguing and archival purposes.</p>
              </div>
            </div>
          </section>

          {/* Buyers */}
          <section id="buyers">
            <h2 className="text-xl font-black text-gray-900 mb-6 pb-3 border-b border-gray-200 not-prose">
              Conditions for Buyers
            </h2>

            <div className="space-y-6 text-gray-600">
              <div>
                <h3 className="font-bold text-gray-800 mb-1">19. Inspection &amp; Risk</h3>
                <p>Buyers must satisfy themselves as to the condition of lots before bidding. Each lot is at the sole risk of the buyer from the fall of the hammer. Vectis accepts no liability for damage or loss after this point.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">20. Title &amp; Ownership</h3>
                <p>Legal title to a purchased lot does not pass to the buyer until full payment has been received. Vectis retains a lien on all lots until payment is cleared in full.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">21. Bidding as Principal</h3>
                <p>All bidders are deemed to act as principals unless prior written acknowledgement confirms agent status on behalf of a named principal.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">22. Bidding Increments</h3>
                <p>Bids must conform to the published increment scale. Odd-figure bids are rounded up to the next valid increment. In the event of tied bids, the first bid received takes precedence.</p>
                <div className="mt-3 border border-gray-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2 text-gray-500 font-bold uppercase tracking-wider">Bid Range</th>
                        <th className="text-right px-4 py-2 text-gray-500 font-bold uppercase tracking-wider">Increment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["£5 – £50", "£5"], ["£50 – £200", "£10"], ["£200 – £700", "£20"],
                        ["£700 – £1,000", "£50"], ["£1,000 – £3,000", "£100"],
                        ["£3,000 – £7,000", "£200"], ["£7,000 – £10,000", "£500"], ["£10,000+", "£1,000"],
                      ].map(([range, inc], i) => (
                        <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                          <td className="px-4 py-2 text-gray-700">{range}</td>
                          <td className="px-4 py-2 text-right font-bold text-[#1e1f5e]">{inc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">23. Collection &amp; Removal of Lots</h3>
                <p>Lots must be collected on the day of sale and paid in full before removal. Postal bidders have seven days to arrange payment and collection (fourteen days for international buyers). All lots are sent at the buyer&apos;s risk although every effort is made to pack items safely.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">24. Post-Removal Responsibility</h3>
                <p>Once goods have been removed from our premises by or on behalf of the buyer, no further responsibility for loss or damage, however or whenever caused, can be accepted by Vectis Auctions Limited.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">25. Payment Methods</h3>
                <p>We accept cash, debit cards, credit cards (excluding American Express), cheques and bank transfers. Cheques exceeding bank guarantee limits require prior arrangement or same-day collection from established buyers.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">26. Commission / Absentee Bids</h3>
                <p>The auctioneer will execute absentee bids at no charge to the bidder. However, Vectis Auctions Limited accepts no responsibility for any errors or omissions in the execution of such bids.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">27. Buyer&apos;s Premium</h3>
                <p>Every buyer will pay on individual lots a sum equal to <strong>22.5% of the hammer price exclusive of VAT</strong> (27% total) as a buyer&apos;s premium. If purchasing through The Saleroom platform, a combined premium of 32.94% applies including VAT and Saleroom charges.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-1">28. Mechanical &amp; Electrical Items</h3>
                <p>Items sold in our auctions are sold as collectors&apos; items only. No warranty is given to the mechanical or electrical operation of any item unless specifically stated in the lot description.</p>
              </div>
            </div>
          </section>

          {/* Footer note */}
          <div className="bg-gray-50 border border-gray-200 p-6 text-xs text-gray-500 leading-relaxed">
            <p className="font-bold text-gray-700 mb-1">Vectis Auctions Limited</p>
            <p>Registered in England &amp; Wales. Head office: Thornaby, Stockton-on-Tees, United Kingdom.</p>
            <p className="mt-2">These terms and conditions are subject to change. For the most up-to-date version please contact us at <a href="mailto:admin@vectis.co.uk" className="text-[#1e1f5e] hover:underline">admin@vectis.co.uk</a>.</p>
          </div>

        </div>
      </div>
    </div>
  )
}
