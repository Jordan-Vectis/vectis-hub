import { getDepartment } from "../departments/data"
import { SITE } from "../news-stories/news/shared"
import { WHY_VECTIS } from "../home-sections"
import { BUILT_IN_PAGES, deptSlugOf } from "./pages"
import { block, esc, htmlToBlocks, pageData, para, type PageData } from "./seed-tools"

// Every built-in page of the test website expressed as the page editor's blocks — what the editor
// opens with the first time a page is edited, so nothing has to be retyped and the page starts out
// looking as it does now (Jordan, 2026-09-24: "I need it for every page"). SERVER ONLY (the
// department pages are read from the database). A seed is never shown on the site by itself: the
// site keeps the built-in design until the page is published from the editor.
//
// Keep these in step with the built-in pages' words when those change.

const INCREMENTS = "Value | Increment\n£5 - £50 | £5\n£50 - £200 | £10\n£200 - £700 | £20\n£700 - £1,000 | £50\n£1,000 - £3,000 | £100\n£3,000 - £7,000 | £200\n£7,000 - £10,000 | £500\n£10,000+ | £1000"

function home(): PageData {
  return pageData("Home", [
    block("LiveHero"),
    block("LiveUpcoming"),
    block("LiveStats"),
    block("Section", {
      background: "#ffffff", width: "standard", paddingY: "large",
      content: [
        block("Heading", { kicker: "The Vectis Difference", text: "Why Choose Vectis?", level: "h2", size: "l", align: "center", uppercase: true }),
        block("Cards", { columns: "3", style: "plain", align: "center", caps: true, items: WHY_VECTIS.map(w => ({ icon: w.iconName, emoji: "", kicker: "", title: w.title, text: w.desc, link: "", linkLabel: "" })) }),
      ],
    }),
    block("Section", {
      background: "#32348a", width: "standard", paddingY: "xl",
      content: [
        block("Heading", { kicker: "Free Valuation", text: "Ready to Sell Your Collection?", level: "h2", size: "xl", align: "center", uppercase: true }),
        block("Text", { text: para("Our specialists will assess your items for free and guide you through the entire process — from valuation to payment."), align: "center", width: "reading", colour: "#d1d5db" }),
        block("Buttons", { align: "center", size: "l", buttons: [
          { label: "Get a free valuation", link: "/sell-with-us", style: "red", newTab: false },
          { label: "Register to bid", link: "/portal/register", style: "outlineLight", newTab: false },
        ] }),
      ],
    }),
    block("LiveSpecialisms"),
  ], {
    seoTitle: "Vectis Auctions — World's No.1 Diecast Specialist",
    seoDescription: "Vectis Auctions is the world's leading specialist auction house for diecast, tinplate and collectable toys. Browse upcoming auctions, bid live, or sell your collection.",
  })
}

function howToBid(): PageData {
  const h = (text: string) => block("Heading", { text, level: "h2", size: "xs", uppercase: true, colour: "#111827" })
  const t = (html: string) => block("Text", { text: html, size: "s" })
  return pageData("How to Bid", [
    block("Section", {
      width: "wide", paddingY: "medium",
      content: [
        block("Heading", { text: "How to Bid", level: "h1", size: "l", rule: "blue" }),
        t(para("There are several ways you can bid in one of our auctions.")),
        h("Bid online"),
        t(para("The best, quickest and most convenient way to bid is on our website, you can do this by creating an account. When your account has been approved you will be able to, keep track of your bids, view your favourite items, view your purchased items and track your parcels")),
        h("Before the sale"),
        t(para("You can tell us what is the maximum you want to bid and we’ll bid on your behalf up to the maximum you are willing to pay.") +
          `<p>To contact us by telephone please call <a href="tel:+441642750616">+44 (0) 1642 750616</a>. Offices are open Monday to Friday 9.00am until 5.00pm (UK time).</p>` +
          `<p>Email us at <a href="mailto:admin@vectis.co.uk">admin@vectis.co.uk</a></p>`),
        h("Telephone bidding"),
        t(para("As of the August 2023 auctions, there is a £100 minimum phone bid in effect") +
          `<p>If you would like to bid live via the telephone please contact us prior to the day of the auction on <a href="tel:+441642750616">+44 (0) 1642 750616</a>. On the day of the sale you will need to be available so that we can contact you via the telephone during the live auction. This option is available for ALL LOTS OVER £100 and there is NO CHARGE to you. We will call you several minutes prior to the lot being offered for auction.</p>` +
          para("We cannot guarantee that all telephone requests will be honoured due to the rising demand for telephone bidding. Although we will try to accommodate every request, we cannot be held responsible for any missed calls due to human or technical errors.")),
        h("Bidding increments"),
        t(para("We participate in ‘live bidding’ for all sales. To enable us to do this the following bidding increments will apply")),
        block("Table", { rows: INCREMENTS, header: true, style: "plain", lastRight: false }),
        t(`<p><strong>Please Note:</strong> A reserve is set at 60% of bottom estimate for all Lots, if your bid does not meet this level you will need to bid again.</p>` + para("The Buyers Premium is 22.5% +VAT (TOTAL 27%).")),
      ],
    }),
  ], { seoDescription: "Bid online, leave a commission bid before the sale, or bid by telephone — how bidding at Vectis works, with the bidding increments and the buyer's premium." })
}

const FAQ: { heading: string; faqs: [string, string][] }[] = [
  { heading: "Bidding", faqs: [
    ["How can I bid?", "There are several ways to bid at Vectis. You can bid online via our website after registering and accepting the terms. You can also bid through The Saleroom platform, bid live online on auction day, arrange telephone bidding (minimum £100 per lot, arranged in advance), or submit absentee bids by post or email before the sale."],
    ["How do I bid live using the Vectis website?", "Log in or register at our website, view upcoming auctions and select 'Register to Bid Live', then accept the terms and conditions. During the live auction, click the bid amount buttons to submit your bids. Your status is displayed in green if you are the highest bidder, or red if you have been outbid."],
    ["What are the bidding increments?", "Bids are accepted in set increments based on the current bid value: £5–£50 in £5 steps; £50–£200 in £10 steps; £200–£700 in £20 steps; £700–£1,000 in £50 steps; £1,000–£3,000 in £100 steps; £3,000–£7,000 in £200 steps; £7,000–£10,000 in £500 steps; £10,000+ in £1,000 steps. Non-standard bids are rounded up to the nearest valid amount."],
    ["What is the reserve price?", "A reserve is set at 60% of the bottom estimate for all lots. If your bid does not meet this level you will need to increase your bid."],
    ["Can I bid by telephone?", "Yes. There is a £100 minimum for telephone bids. The service is available for all lots over £100 at no charge. One of our team will call you several minutes before your lot is offered. Please note we cannot guarantee all telephone requests will be honoured due to high demand — always arrange in advance."],
  ] },
  { heading: "Buying", faqs: [
    ["What is the Buyer's Premium?", "The Buyer's Premium is 22.5% plus VAT (27% total) on every lot purchased through the Vectis website. If you bid through The Saleroom platform, a combined premium of 32.94% applies, which includes VAT and Saleroom charges."],
    ["What payment methods are accepted?", "We accept credit and debit cards, bank transfers, and cheques (with bank guarantee or prior arrangement for amounts exceeding guarantee limits). American Express is not accepted."],
    ["What if there is an error in the catalogue description?", "Please contact us if you believe there is an error. We will always sell a lot based on the description rather than the image if a discrepancy exists. All catalogue statements are statements of opinion and are not warranties."],
  ] },
  { heading: "Payment", faqs: [
    ["I have won a lot — what do I do now?", "Invoices are emailed after the auction completes. You can set 'Auto Invoice Payment' in your account settings to automatically charge your registered payment method, or arrange manual payment after receiving your invoice. Once paid, your items will be dispatched."],
    ["How can I pay for my winning lots?", "Register a credit or debit card on your account (required for live bidding but you may use a different card for payment). Enable auto-payment in your account for the fastest dispatch processing. You can alternatively pay by bank transfer after receiving your invoice."],
  ] },
  { heading: "Selling", faqs: [
    ["What does Vectis charge for selling?", "Our commission rates are negotiable based on the value of your collection. Commission is all-inclusive plus VAT (VAT applies only to the commission, not the hammer price). Contact us for a personalised quote."],
    ["How do I start selling through auction?", "Send a list of your items with photographs to collections@vectis.co.uk, or write to our Thornaby office. Our specialists will evaluate your collection free of charge. You can also mail items directly, bring them to one of our toy fairs, visit the office in person, or we can arrange a collection for larger consignments."],
    ["What is Pre-Sales Advice?", "After your collection has been catalogued, you can access your pre-sale paperwork through your account under 'My Sales'. This shows lot numbers, descriptions and estimates before the auction. After the sale, post-sale advice shows your selling prices and vendor statements show the final payment due to you, typically within approximately 25 working days of the sale."],
  ] },
  { heading: "Post & Packing", faqs: [
    ["What are the post and packing charges?", "UK postage starts from £14.95 for small items and £24.95+ for larger lots, with surcharges for additional items. International shipping varies by Parcel Force destination zone (Zone 6–9 for Europe; quotes provided for the rest of the world). Average shipping time is 14 days, though peak periods may extend to 28 days."],
    ["Will my parcel be insured?", "Yes. All parcels are dispatched fully insured and traceable via courier or Royal Mail."],
    ["I am based in the USA — can I have items shipped?", "Yes, we ship worldwide including to the USA. Please note that US orders may be subject to import tariffs of 10–50% depending on the goods, as determined by US customs."],
  ] },
  { heading: "Condition & Grading", faqs: [
    ["How does Vectis grade toys?", "We use a six-point scale: Mint (perfect, as new); Near Mint (almost perfect with minimal flaws); Excellent (carefully used with minor imperfections); Good (obvious imperfections from use); Fair (heavy wear or major imperfections); Poor (very distressed condition). Please note no warranty can be given to the mechanical or electrical operation of any item."],
    ["Does Vectis test toys for working order?", "No. All items are sold as collectors' items and are not tested for mechanical or electrical operation unless specifically stated in the lot description."],
    ["How does Vectis grade vinyl records?", "Vinyl is graded on a six-point scale: Mint (brand new, no marks); Excellent (played slightly, minimal marks); Very Good (played many times with noticeable marks); Good (noticeably deteriorated sound quality); Fair (considerable surface noise, just playable); Poor (will not play properly)."],
  ] },
  { heading: "Problem Purchases", faqs: [
    ["I have a problem with my purchase — what should I do?", "First review the lot description and grading carefully in the catalogue. If you still have a concern, contact us using the returns form and send detailed photographs of any damage to returns@vectis.co.uk. Only claims submitted through the official returns process will be considered. Written claims must be submitted within ten days of the sale."],
  ] },
]
const anchorOf = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

function faq(): PageData {
  return pageData("FAQ", [
    block("PageHeader", { kicker: "Help Centre", heading: "Frequently Asked Questions", intro: "Everything you need to know about bidding, buying, selling and shipping at Vectis Auctions.", background: "#1e1f5e", width: "text" }),
    block("Section", {
      width: "text", paddingY: "large",
      content: [
        block("Buttons", { size: "s", buttons: FAQ.map(s => ({ label: s.heading, link: `#${anchorOf(s.heading)}`, style: "chip", newTab: false })) }),
        ...FAQ.map(s => block("Box", {
          background: "", border: "none", padding: "none", anchor: anchorOf(s.heading),
          content: [
            block("Heading", { text: s.heading, level: "h2", size: "xs", uppercase: true, colour: "#db0606" }),
            block("Accordion", { style: "lines", openFirst: false, items: s.faqs.map(([q, a]) => ({ title: q, body: para(a) })) }),
          ],
        })),
        block("Box", {
          background: "#f9fafb", border: "light", padding: "large",
          content: [
            block("Heading", { text: "Still have a question?", level: "h3", size: "s", align: "center", colour: "#111827" }),
            block("Text", { text: para("Our team is available Monday – Friday, 9:00 am – 5:00 pm."), align: "center", size: "s", colour: "#6b7280" }),
            block("Buttons", { align: "center", size: "s", buttons: [
              { label: "+44 (0)1642 750 616", link: "tel:+441642750616", style: "link", newTab: false },
              { label: "admin@vectis.co.uk", link: "mailto:admin@vectis.co.uk", style: "link", newTab: false },
            ] }),
          ],
        }),
      ],
    }),
  ], { seoDescription: "Answers to the questions we're asked most about bidding, buying, paying, selling, postage and grading at Vectis Auctions." })
}

const MAILBOXES: [string, string, string][] = [
  ["collections@vectis.co.uk", "Selling with us", "Auctioning your collectables — a free valuation and how a sale works."],
  ["admin@vectis.co.uk", "General enquiries", "Anything else — the office team will point you to the right person."],
  ["accounts@vectis.co.uk", "Accounts", "Invoices, payments and anything about money owed or due."],
  ["dispatch@vectis.co.uk", "Postage & packing", "Where your parcel is, shipping costs, and collecting in person."],
]

function contact(): PageData {
  const label = (text: string, colour = "#111827") => block("Heading", { text, level: "h2", size: "xs", uppercase: true, colour })
  return pageData("Contact Us", [
    block("Section", {
      width: "wide", paddingY: "medium",
      content: [
        block("Heading", { kicker: "Get in touch", text: "Contact Us", level: "h1", size: "l", rule: "red" }),
        block("Columns", {
          layout: "2-1", gap: "large", valign: "top",
          col1: [
            label("Email — the right address gets the quickest answer"),
            block("Cards", { columns: "2", style: "bordered", align: "left", caps: false, items: MAILBOXES.map(([email, about, blurb]) => ({ icon: "", emoji: "", kicker: about, title: email, text: blurb, link: `mailto:${email}`, linkLabel: "" })) }),
            label("Before you write"),
            block("Text", { size: "s", text: `<ul><li>Thinking of selling? <a href="/sell-with-us">Sell with us</a> explains the free valuation.</li><li>New to bidding? <a href="/how-to-bid">How to bid</a> covers online, commission and telephone bids.</li><li>Fees, postage and payment questions are answered in the <a href="/faq">FAQs</a>.</li></ul>` }),
          ],
          col2: [
            block("Box", {
              background: "#32348a", border: "none", padding: "large",
              content: [
                label("Telephone", "#2ab4a6"),
                block("Text", { size: "l", text: `<p><a href="tel:+441642750616"><strong>+44 (0)1642 750616</strong></a></p>` }),
                label("Office hours", "#2ab4a6"),
                block("Text", { size: "s", text: "<p>Monday to Friday, 9:00am – 5:00pm (UK time).<br>Closed at weekends.</p>" }),
                label("Address", "#2ab4a6"),
                block("Text", { size: "s", text: "<p>Vectis Auctions Ltd<br>Fleck Way<br>Teesside Industrial Estate<br>Thornaby<br>TS17 9JZ<br>United Kingdom</p>" }),
              ],
            }),
          ],
        }),
      ],
    }),
  ], { seoDescription: "How to reach Vectis Auctions in Thornaby — phone, email and office hours, and which address to write to about selling, an order, or a parcel." })
}

const JOBS = [
  { title: "Auction Packing Assistant", salary: "£12.25 per hour", type: "Permanent, Full-time", hours: "",
    description: "Support the post-auction logistics team by packing and checking customer orders for dispatch, ensuring every lot reaches its new owner safely.",
    responsibilities: ["Packing and checking customer orders for dispatch", "Preparing paperwork and processing shipping information", "Maintaining a clean, safe working environment", "Manual handling and warehouse duties", "Supporting post-auction logistics operations", "Representing the company professionally"],
    essential: ["Excellent customer service skills", "Strong attention to detail and accuracy", "Reliable, motivated team player", "Valid UK driving licence"],
    desirable: ["Experience in packing or dispatch", "Familiarity with shipping hubs", "Microsoft Office competency"],
    benefits: ["Free on-site parking"] },
  { title: "Online Auction Cataloguer", salary: "£22,500 – £25,000 per year", type: "Permanent, Full-time", hours: "Monday – Friday, 09:00 – 17:00",
    description: "Research, describe and value a wide variety of collectables for our online auction catalogues, working as part of our experienced specialist team.",
    responsibilities: ["Cataloguing diverse collectables for online auctions", "Unpacking collections and sorting into lots", "Inputting titles, descriptions and estimates into the auction system", "Collaborating with the cataloguing team", "Customer liaison regarding collection suitability", "Attending exhibitions and promotional events", "Supporting marketing messaging consistency"],
    essential: ["Good knowledge of collectables", "Computer literacy including Microsoft Office", "Excellent customer service skills", "Strong written and verbal communication", "Accuracy and efficiency in a fast-paced environment"],
    desirable: ["E-commerce experience", "Familiarity with online auction platforms (e.g. eBay)"],
    benefits: ["Company pension", "Concessionary selling rate", "Free on-site parking"] },
  { title: "Digital Marketing & Sales Executive", salary: "£25,000 – £35,000 per year", type: "Permanent, Full-time", hours: "Monday – Friday, on-site only",
    description: "Lead our digital marketing and sales growth — from SEO and paid campaigns to building relationships with toy and collectables manufacturers worldwide.",
    responsibilities: ["Planning and implementing SEO, PPC, email and social media campaigns", "Creating engaging website and social content", "Managing and optimising paid advertising (Google Ads, Facebook)", "Monitoring performance metrics and analytics", "Identifying new toy/collectables manufacturing opportunities", "Building manufacturer relationships and qualifying leads", "Growing LinkedIn presence and proactive lead generation", "Preparing proposals and following up on sales enquiries"],
    essential: ["Proven digital marketing, sales or business development experience", "Understanding of SEO, paid advertising, email and social media", "Excellent written and verbal communication skills", "Commercial awareness and target-driven approach", "Strong organisational skills across multiple projects", "Analytical ability to interpret data"],
    desirable: ["Toy or collectables sector experience", "Paid advertising budget management", "CMS experience", "Graphic design skills (Canva, Adobe)"],
    benefits: ["Company pension", "Free on-site parking"] },
  { title: "Online Auction Cataloguer — Dolls & Bears", salary: "From £22,500 per year", type: "Permanent, Full-time", hours: "Monday – Friday, 09:00 – 17:00",
    description: "Specialist cataloguing role focused on dolls, teddy bears and related collectables — including Steiff, Charlie Bears, Merrythought and Barbie.",
    responsibilities: ["Cataloguing dolls and bears for online auctions", "Identifying and organising collectables into lots", "Inputting accurate titles, descriptions and estimates", "Supporting other cataloguers during sales", "Customer communication regarding collection suitability", "Attending exhibitions and events for promotion", "Collaborating with the marketing team"],
    essential: ["Good knowledge of dolls, bears and collectables", "Strong computer literacy including Microsoft Office", "Excellent customer service skills", "Effective written and verbal communication", "Strong attention to detail and organisational skills"],
    desirable: ["E-commerce experience", "Online auction platform experience (e.g. eBay)"],
    benefits: ["Company pension", "Concessionary selling rate", "Free on-site parking"] },
]

function careers(): PageData {
  return pageData("Careers", [
    block("PageHeader", { kicker: "Join the Team", heading: "Careers at Vectis", intro: "Vectis is the largest toy and collectables auction house in the world, processing over 50,000 lots annually across more than 90 auctions per year. Our employees are our greatest asset.", background: "#1e1f5e", width: "text" }),
    block("Section", {
      width: "text", paddingY: "large",
      content: [
        block("Quote", { text: "Find a job you enjoy doing, and you will never have to work a day in your life.", by: "Mark Twain" }),
        block("Text", { text: para("We are committed to creating a positive and inclusive work environment where everyone can thrive and grow. If you share our passion for toys and collectables and want to be part of a world-class specialist auction house, we'd love to hear from you."), colour: "#4b5563" }),
        block("Heading", { text: "Current Vacancies", level: "h2", size: "m", colour: "#111827" }),
        ...JOBS.map(j => block("Job", { ...j, responsibilities: j.responsibilities.join("\n"), essential: j.essential.join("\n"), desirable: j.desirable.join("\n"), benefits: j.benefits.join("\n"), applyEmail: "admin@vectis.co.uk" })),
        block("Box", {
          background: "#f9fafb", border: "light", padding: "large",
          content: [
            block("Heading", { text: "Don't see the right role?", level: "h3", size: "s", colour: "#111827" }),
            block("Text", { size: "s", colour: "#4b5563", text: para("We're always interested in hearing from talented people who share our passion. Send a speculative application and we'll keep your details on file.") }),
            block("Buttons", { size: "s", buttons: [{ label: "Get in Touch", link: "mailto:admin@vectis.co.uk?subject=Speculative Application", style: "outline", newTab: false }] }),
          ],
        }),
      ],
    }),
  ], { seoDescription: "Join the team at Vectis — the world's largest toy and collectables auction house. View current vacancies." })
}

const clause = (n: number, title: string, text: string) => `<h3>${n}. ${esc(title)}</h3><p>${text}</p>`

function terms(): PageData {
  const part = (anchor: string, heading: string, html: BlockDataList) => block("Box", {
    background: "", border: "none", padding: "none", anchor,
    content: [block("Heading", { text: heading, level: "h2", size: "s", colour: "#111827" }), block("Divider", { style: "line" }), ...html],
  })
  const text = (html: string) => block("Text", { text: html, size: "s", colour: "#4b5563" })
  return pageData("Terms & Conditions", [
    block("PageHeader", { kicker: "Legal", heading: "Terms & Conditions", intro: "Vectis Auctions Limited — Conditions of Business for Buyers and Sellers", background: "#1e1f5e", width: "text" }),
    block("Section", {
      width: "text", paddingY: "large",
      content: [
        block("Buttons", { size: "s", buttons: [["General", "#general"], ["Sellers", "#sellers"], ["Buyers", "#buyers"]].map(([label, link]) => ({ label, link, style: "chip", newTab: false })) }),
        part("general", "General Conditions", [text(
          clause(1, "Agency", "Vectis Auctions Limited act only as auctioneers and agents for the seller. All transactions are conducted on behalf of the vendor unless otherwise stated.") +
          clause(2, "Accuracy & Liability", "The auctioneer makes every effort toward catalogue accuracy but sells all lots “with all faults, imperfections and errors of description.” Vectis Auctions Limited disclaims responsibility for the authenticity of any lot unless explicitly instructed otherwise by the seller in writing.") +
          clause(3, "Catalogue Statements", "All statements, whether printed in the catalogue or made orally, are statements of opinion only and are not to be taken as being or implying any warranties or representations of fact.") +
          clause(4, "Claims", "Buyers must submit written claims within ten days of the date of sale.") +
          clause(5, "Auctioneer's Discretion", "The auctioneer reserves the right to divide lots, combine lots, withdraw items, refuse bids, or cancel sales at any time without prior notice. In the event of a dispute the auctioneer's decision is final. The highest bidder acknowledged by the auctioneer shall be the buyer.") +
          clause(6, "Reserve Prices", "Lots are sold without reserve unless written reserve instructions are received prior to the sale. Where a reserve price is set and not met, the auctioneer may continue to offer the lot privately at or above the reserve price.") +
          clause(7, "Forgery & Rescission", "Within fourteen days of purchase, a buyer who can demonstrate to the auctioneer's satisfaction that a lot is a deliberate forgery may return the item in its original condition for a full refund of the purchase price.") +
          clause(8, "Third-Party Liability", "Visitors to our premises assume all risk of personal injury or property damage. Vectis Auctions Limited disclaims all liability for injury or damage except that arising directly from the negligence of its own employees."),
        )]),
        part("sellers", "Conditions for Sellers", [text(
          clause(9, "Delivery & Acceptance", "Goods delivered to Vectis become part of our auction inventory unless otherwise agreed in writing. Delivery of goods constitutes full acceptance of all conditions herein.") +
          clause(10, "Collection of Goods", "Vectis acts as agent in arranging collection of goods from vendors. We accept no responsibility for loss or damage caused by third-party collection contractors.") +
          clause(11, "Storage", "The auctioneer reserves the right to store goods as required and accepts no liability for loss or damage to stored goods except where caused by direct employee negligence. Storage charges may apply in certain circumstances.") +
          clause(12, "Unsold Items", "If goods remain uncollected twenty-one days after a removal request has been issued, Vectis Auctions Limited reserves the right to sell the goods to defray costs and outstanding storage charges.") +
          clause(13, "Insurance", "Unless instructed otherwise in writing, goods consigned to Vectis are insured against fire, burglary and water damage at their estimated auction value. Vectis is not responsible for uninsured items or accidental damage unless caused by employee negligence.") +
          clause(14, "Reserve Prices", "All reserves must be agreed by both Vectis Auctions Limited and the vendor. Where reserves are set without agreement and lots fail to sell, a charge of 7.5% of the agreed or estimated value will apply. For lots withdrawn after printing has commenced, a charge of 25% of the bottom estimate or reserve (whichever is greater) applies. For lots withdrawn before printing, the charge is 15%.") +
          clause(15, "Vendor Indemnity", "Sellers indemnify Vectis Auctions Limited against all claims, costs and expenses arising from or relating to goods consigned and sold on their behalf.") +
          clause(16, "VAT", "Vendors registered for VAT must declare their VAT status and registration number before delivery of goods.") +
          clause(17, "Payment to Vendors", "Net proceeds (hammer price less agreed commission, expenses and applicable charges) are transferred to the vendor within twenty-five working days of receipt of full payment from the buyer.") +
          clause(18, "Photography & Images", "Vectis Auctions Limited retains absolute rights to photograph all consigned lots and use such images at its discretion for marketing, cataloguing and archival purposes."),
        )]),
        part("buyers", "Conditions for Buyers", [
          text(
            clause(19, "Inspection & Risk", "Buyers must satisfy themselves as to the condition of lots before bidding. Each lot is at the sole risk of the buyer from the fall of the hammer. Vectis accepts no liability for damage or loss after this point.") +
            clause(20, "Title & Ownership", "Legal title to a purchased lot does not pass to the buyer until full payment has been received. Vectis retains a lien on all lots until payment is cleared in full.") +
            clause(21, "Bidding as Principal", "All bidders are deemed to act as principals unless prior written acknowledgement confirms agent status on behalf of a named principal.") +
            clause(22, "Bidding Increments", "Bids must conform to the published increment scale. Odd-figure bids are rounded up to the next valid increment. In the event of tied bids, the first bid received takes precedence."),
          ),
          block("Table", { rows: "Bid Range | Increment\n£5 – £50 | £5\n£50 – £200 | £10\n£200 – £700 | £20\n£700 – £1,000 | £50\n£1,000 – £3,000 | £100\n£3,000 – £7,000 | £200\n£7,000 – £10,000 | £500\n£10,000+ | £1,000", header: true, style: "striped", lastRight: true }),
          text(
            clause(23, "Collection & Removal of Lots", "Lots must be collected on the day of sale and paid in full before removal. Postal bidders have seven days to arrange payment and collection (fourteen days for international buyers). All lots are sent at the buyer's risk although every effort is made to pack items safely.") +
            clause(24, "Post-Removal Responsibility", "Once goods have been removed from our premises by or on behalf of the buyer, no further responsibility for loss or damage, however or whenever caused, can be accepted by Vectis Auctions Limited.") +
            clause(25, "Payment Methods", "We accept cash, debit cards, credit cards (excluding American Express), cheques and bank transfers. Cheques exceeding bank guarantee limits require prior arrangement or same-day collection from established buyers.") +
            clause(26, "Commission / Absentee Bids", "The auctioneer will execute absentee bids at no charge to the bidder. However, Vectis Auctions Limited accepts no responsibility for any errors or omissions in the execution of such bids.") +
            clause(27, "Buyer's Premium", "Every buyer will pay on individual lots a sum equal to <strong>22.5% of the hammer price exclusive of VAT</strong> (27% total) as a buyer's premium. If purchasing through The Saleroom platform, a combined premium of 32.94% applies including VAT and Saleroom charges.") +
            clause(28, "Mechanical & Electrical Items", "Items sold in our auctions are sold as collectors' items only. No warranty is given to the mechanical or electrical operation of any item unless specifically stated in the lot description."),
          ),
        ]),
        block("Box", {
          background: "#f9fafb", border: "light", padding: "medium",
          content: [block("Text", { size: "s", colour: "#6b7280", text: `<p><strong>Vectis Auctions Limited</strong></p><p>Registered in England &amp; Wales. Head office: Thornaby, Stockton-on-Tees, United Kingdom.</p><p>These terms and conditions are subject to change. For the most up-to-date version please contact us at <a href="mailto:admin@vectis.co.uk">admin@vectis.co.uk</a>.</p>` })],
        }),
      ],
    }),
  ], { seoDescription: "Vectis Auctions terms and conditions for buyers and sellers." })
}
type BlockDataList = ReturnType<typeof block>[]

/** A department's page: its banner, the copy, the side box, its news, highlighted lots and past auctions. */
async function department(slug: string): Promise<PageData | null> {
  const d = await getDepartment(slug).catch(() => null)
  if (!d) return null
  const keys = new Set(d.extraImageKeys ?? [])
  const byPath = new Map((d.extraImages ?? []).map(x => [x.path, x.file]))
  // A picture inside the copy: our R2 copy's key where it was uploaded, else the site's own file.
  const pictureOf = (path: string) => {
    const file = byPath.get(path)
    if (file && keys.has(`news-photos/${file}`)) return `news-photos/${file}`
    return /^https?:\/\//i.test(path) ? path : SITE + path
  }
  const hero = d.heroKey ?? (d.heroPath ? (/^https?:\/\//i.test(d.heroPath) ? d.heroPath : SITE + d.heroPath) : "")
  const copy = htmlToBlocks(d.copyHtml, { picture: pictureOf, site: SITE, demoteH1: true })
  const side = htmlToBlocks(d.sideHtml, { picture: pictureOf, site: SITE, dark: true })
  const hasHeading = copy.some(b => b.type === "Heading")
  return pageData(d.name, [
    block("PageHeader", {
      heading: d.pageTitle ?? d.name, picture: hero, darken: 55, height: "medium", width: "wide", background: "#32348a",
      crumbs: [{ label: "Departments", link: "/departments" }, { label: d.name, link: "" }],
    }),
    block("Section", {
      background: "#f9fafb", width: "wide", paddingY: "medium",
      content: [
        block("Columns", {
          layout: "2-1", gap: "large", valign: "top",
          col1: [block("Box", {
            background: "#ffffff", border: "light", padding: "large",
            content: [
              ...(!hasHeading && d.heading ? [block("Heading", { text: d.heading, level: "h2", size: "l" })] : []),
              ...(copy.length ? copy : [block("Text", { text: para("No text is held for this department yet.") })]),
            ],
          })],
          col2: [
            block("Box", {
              background: "#32348a", border: "none", padding: "medium",
              content: side.length ? side : [
                block("Heading", { kicker: "Selling", text: "Sell your collection with us", level: "h3", size: "m" }),
                block("Text", { size: "s", text: para("Looking to sell? From a single piece to a room of thousands, our Collections Team will guide you through the process — a free valuation, no lotting fees, and worldwide marketing at no extra cost.") }),
                block("Buttons", { buttons: [{ label: "Get started", link: "/sell-with-us", style: "white", newTab: false }] }),
              ],
            }),
            block("LiveNews", { department: slug, heading: "Latest news", count: 3, layout: "list" }),
          ],
        }),
      ],
    }),
    block("LiveHighlights", { department: slug }),
    block("LivePastAuctions", { department: slug }),
  ])
}

const SIMPLE: Record<string, () => PageData> = {
  home,
  auctions: () => pageData("Auction Calendar", [block("LiveCalendar")]),
  departments: () => pageData("Departments", [block("LiveDepartments")]),
  "sell-with-us": () => pageData("Sell with us", [block("LiveSellForm")], { seoTitle: "Sell With Us — Free Valuation", seoDescription: "Submit your toys and collectables to Vectis for a free specialist valuation." }),
  "news-stories/news": () => pageData("News & Stories", [block("LiveNewsIndex")]),
  "how-to-bid": howToBid,
  faq,
  contact,
  careers,
  terms,
}

/** The blocks a page starts from in the editor: its built-in design, or a plain start for a new page. */
export async function seedFor(slug: string, title?: string): Promise<PageData> {
  if (SIMPLE[slug]) return SIMPLE[slug]()
  const dept = deptSlugOf(slug)
  if (dept) {
    const d = await department(dept)
    if (d) return d
  }
  const name = title || BUILT_IN_PAGES.find(p => p.slug === slug)?.label || "New page"
  return pageData(name, [
    block("PageHeader", { heading: name, background: "#1e1f5e", width: "standard" }),
    block("Section", { width: "standard", paddingY: "large", content: [block("Text", { text: para("Start writing here — or drag blocks in from the left.") })] }),
  ])
}
