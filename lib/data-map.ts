// The data map — every table in the Hub's database, in plain English.
//
// Rendered as a section on Admin → Data & Compliance. Its job is to answer
// "what does the Hub actually hold, and where does a given thing live?"
// without anyone reading schema.prisma or clicking through Browse Any Table.
//
// ⚠ HAND-WRITTEN ON PURPOSE. The point is the plain-English sentence, which
// nothing can generate — a field list is not an explanation. The page checks
// this map against the real model list at render time and says so if a table
// is missing, so a new model shows up as a gap instead of vanishing quietly.
//
// ⚠ ADD A LINE HERE WHENEVER YOU ADD A PRISMA MODEL. Same standing rule as the
// STORES / PROCESSORS / MONITORING arrays on that page.
//
// `personal` marks whose personal data a table holds, because that is what the
// compliance page exists for:
//   customer — customers, vendors and bidders
//   staff    — Vectis staff (monitoring included)
//   public   — people with no Hub account at all (accident reports, inductions)
// No marker means no personal data: settings, lists, wording, cached figures.

export type PersonalKind = "customer" | "staff" | "public"

export type DataMapTable = {
  /** Prisma model name, exactly as in schema.prisma — the page matches on this. */
  model: string
  /** One sentence, plain English. What is in it, in the words the team uses. */
  what: string
  personal?: PersonalKind
  /** Set when a table is no longer written to, and say why. */
  dormant?: boolean
}

export type DataMapArea = {
  area: string
  blurb: string
  tables: DataMapTable[]
}

export const DATA_MAP: DataMapArea[] = [
  {
    area: "Staff, access and devices",
    blurb: "Who can sign in, what they are allowed to open, and the kit they use.",
    tables: [
      { model: "User", personal: "staff", what: "A staff account: name, email, username, hashed password, role, which apps they may open, their timer settings, and the last tote, vendor and receipt they typed." },
      { model: "BCToken", personal: "staff", what: "One person's Business Central sign-in token, so the BC tools can read BC as them. Tokens only — no password." },
      { model: "Department", what: "The departments, and which sale types each one is allowed to see." },
      { model: "UserDepartment", personal: "staff", what: "Which staff belong to which department." },
      { model: "RoleDefault", what: "The apps, permissions and dashboard a new account gets for each role." },
      { model: "DashboardLayout", personal: "staff", what: "The widgets each person has chosen for their own home page." },
      { model: "TermsAcceptance", personal: "staff", what: "Who accepted the tablet terms, which version they signed, and their drawn signature." },
      { model: "TermsRevocation", personal: "staff", what: "A terms acceptance an admin has cancelled so the person signs again: what they had signed and when, who revoked it and why. Kept rather than deleted, so the old signature is still on record." },
      { model: "AccessDenialLog", personal: "staff", what: "Every time someone was refused an app: what their session claimed and what the database actually said. The diagnostic behind the cataloguer bounce." },
      { model: "Device", personal: "staff", what: "The tablets and scanners: serial number, type, MAC address and who has it." },
      { model: "Packer", personal: "staff", what: "The packing staff list — full time, agency or ex-staff — with the name aliases their labels come through under." },
      { model: "AppCard", what: "The Hub's app cards: order, label, description, and whether each is visible or pinned." },
      { model: "Announcement", what: "The site-wide banner message and how loudly it is shown." },
      { model: "AppReload", what: "A one-line token that tells open tabs to reload themselves after a release." },
      { model: "IdleTimerConfig", what: "The activity timer's settings: the amber and red thresholds, the reasons offered, and the wording." },
      { model: "MigrationState", what: "Which database migrations the Run Migrations button has already applied." },
    ],
  },
  {
    area: "Customers and submissions",
    blurb: "People who sell to us or buy from us, and the items they offer.",
    tables: [
      { model: "Contact", personal: "customer", what: "The customer record: name, address, postcode, phone, email, notes, and whether they are a seller, a buyer or both." },
      { model: "CustomerAccount", personal: "customer", what: "A website account for bidding: sign-in details, session token, and shipping and billing addresses." },
      { model: "Submission", personal: "customer", what: "An item offered to us: how it came in, its status through the pipeline, follow-ups, and who is handling it." },
      { model: "SubmissionNote", personal: "customer", what: "Staff notes written against a submission." },
      { model: "Item", what: "The individual items in a submission, with their photos and any estimate the customer was given elsewhere." },
      { model: "Valuation", what: "A cataloguer's estimate and comments on a submission item." },
      { model: "ContactLog", personal: "customer", what: "A record of contacting the customer: method, notes, outcome, and whether it was a follow-up." },
      { model: "Logistics", personal: "customer", what: "How a submission's items reach us — collection address, name, phone and email, and whether they have arrived." },
    ],
  },
  {
    area: "Cataloguing",
    blurb: "Sales, lots, and everything the cataloguing tools write.",
    tables: [
      { model: "CatalogueAuction", what: "A sale: code, name, date, type, and the flags for where it has got to — catalogued, added to BC, photographed, published, complete." },
      { model: "CatalogueLot", personal: "customer", what: "The lot itself: title, description, key points, barcode, tote, receipt, vendor, estimates, condition, photos and status. The single most important table in the Hub." },
      { model: "CatalogueAuctionAccess", personal: "staff", what: "Extra people let into one sale, beyond what their department would give them." },
      { model: "CatalogueAuctionFavourite", personal: "staff", what: "The ⭐ sales each person is currently working on. Per person, not a status on the sale." },
      { model: "LotCategory", what: "The cataloguing categories, in the order they appear in the dropdowns." },
      { model: "LotSubcategory", what: "The subcategories under each category." },
      { model: "ConditionWording", what: "The box and packaging condition wording presets offered in the lot editors." },
      { model: "CataloguePhotoSession", what: "A Photo Only session: the barcode label photo, the item photos taken with it, and who took them." },
      { model: "CatalogueBulkUndo", personal: "staff", what: "One bulk change made on Manage Lots, kept in full so it can be undone." },
      { model: "CatalogueLotEvent", personal: "staff", what: "The Lot Change Log: every lot created, edited, photographed or deleted — old value, new value, which tool did it, and who." },
      { model: "EodCheckDismissal", what: "End of Day warnings someone has ticked as “ignore”, so the panels show live problems only." },
      { model: "CatalogueBcCorrection", what: "The ticks on the BC Corrections list. The list itself is worked out live from the BC tote data — these rows only remember what has been dealt with." },
      { model: "SavedAiFlag", what: "A snapshot of an AI-flagged lot exactly as it was when someone saved it off to look at later." },
      { model: "ManagerPortalHiddenCategory", what: "Categories hidden from the Manager Portal's tote-dates view, and who hid them." },
      { model: "WebDescription", what: "The sale description written for the website." },
      { model: "ConditionReport", personal: "customer", what: "A condition report a customer has emailed in, pulled from the mailbox and matched to a sale and lot: their name, email, phone and question." },
      { model: "CatalogueLotDraft", dormant: true, what: "Held the Lot Wizard's half-finished lots for the Resume banner. That feature was removed on 7 August 2026, so nothing writes here any more." },
    ],
  },
  {
    area: "AI and the overnight pipeline",
    blurb: "The instructions, the runs, and what each run produced.",
    tables: [
      { model: "AiPreset", what: "The AI instructions themselves — the one source every run resolves against. Editing an instruction means editing a row here." },
      { model: "AiPresetCategory", what: "How those instructions are grouped and ordered on the Instructions tab." },
      { model: "PipelineRun", what: "One Auto Pipeline run: the sale, the instruction, the model, and which stage it reached." },
      { model: "PipelineLot", what: "One lot's journey through a pipeline run — the generated description, the double-check findings, the key-point fixes, and whether it was applied to the catalogue." },
      { model: "PipelineQueueItem", personal: "staff", what: "A sale queued for the overnight run with its own settings, plus the progress the server-side runner reports back and who queued it." },
      { model: "UpgradeLot", what: "An overnight AI Upgrade's rewrite, held back for the morning review page. Nothing reaches the catalogue until someone accepts it." },
      { model: "AuctionRun", what: "A saved Auction AI run — the sale code, the instruction used and when." },
      { model: "AuctionLot", what: "One lot inside a saved run: what the AI produced, what it started from, and which key points it thought were missing or added." },
      { model: "DisabledModel", what: "AI models switched off so they stop appearing in the pickers." },
      { model: "ToolModel", what: "Which AI model each tool uses." },
      { model: "AiModelRate", what: "The per-million-token prices behind the run cost estimates. An unpriced model reads as “price not set”, never as free." },
      { model: "BcSourceFile", what: "The uploaded Business Central extension source code. Vendor code — no personal data." },
      { model: "BcSourceGuide", what: "The AI-written guide to each BC extension, and whether a person has edited it since." },
    ],
  },
  {
    area: "Staff activity and monitoring",
    blurb: "The most sensitive area in the Hub — see the monitoring note above.",
    tables: [
      { model: "CatalogueTimingLog", personal: "staff", what: "How long each lot took and how long its key points took, per person, per sale." },
      { model: "IdleLog", personal: "staff", what: "A break or gap in someone's work, how long it ran, the reason they gave and any notes." },
      { model: "IdleGateDecision", personal: "staff", what: "Every time the activity gate ran: how long the gap was, whether they were blocked, and what the device's own clock and timezone claimed against the real time." },
      { model: "CataloguerLotStart", personal: "staff", what: "When each person started the lot they are on, stamped by the server rather than the tablet." },
      { model: "ResearchLog", personal: "staff", what: "Time spent on the Research tab, per person." },
      { model: "ReportExcludedUser", personal: "staff", what: "People left out of the report maths, and who excluded them." },
      { model: "ReportExcludedDay", personal: "staff", what: "Single days left out of one person's report maths — an odd day that would otherwise distort the figures." },
    ],
  },
  {
    area: "Business Central (the synced copy)",
    blurb: "Our cache of what BC holds. BC is the source of truth; these tables are a read-only copy that a sync refreshes.",
    tables: [
      { model: "WarehouseItem", personal: "customer", what: "BC's items as last synced: barcode, unique ID, receipt, vendor number, name and email, tote, location, lot number, estimates, hammer price and who catalogued it." },
      { model: "WarehouseTote", personal: "customer", what: "BC's receipt totes as last synced — tote number to receipt to vendor. What every tote check compares against." },
      { model: "WarehouseSyncLog", what: "Each sync run: what it pulled, how far it got, and any error." },
      { model: "BCCatalogueDay", what: "A day's BC cataloguing figures and when they were fetched." },
      { model: "BCCatalogueEntry", personal: "staff", what: "How many items each person catalogued in BC on a given day." },
      { model: "BCPackingDay", what: "A day's BC packing figures and when they were fetched." },
      { model: "BCPackingEntry", personal: "staff", what: "How many lots each packer handled on a given day, per document." },
    ],
  },
  {
    area: "Internal warehouse",
    blurb: "Vectis's own warehouse records — separate from the BC copy above.",
    tables: [
      { model: "WarehouseReceipt", personal: "customer", what: "A receipt booked in here: the customer it belongs to, its commission rate and status." },
      { model: "WarehouseContainer", what: "A box or tote of goods on a receipt, with its description and category." },
      { model: "WarehouseLocation", what: "The shelf and location codes goods can be put in." },
      { model: "WarehouseMovement", personal: "staff", what: "Every move of a container to a location, with who moved it and when." },
    ],
  },
  {
    area: "Packing and dispatch",
    blurb: "Getting sold lots to the buyer.",
    tables: [
      { model: "Parcel", personal: "customer", what: "A parcel for Royal Mail: recipient name, address, email and phone, weight, service, special instructions, tracking number and the label PDF." },
      { model: "ParcelLot", what: "Which lots are in which parcel." },
    ],
  },
  {
    area: "Live auction and bidding",
    blurb: "The sale as it runs.",
    tables: [
      { model: "LiveAuction", what: "A sale's live state — running or not, and which lot is up." },
      { model: "BidderRegistration", personal: "customer", what: "A customer registered to bid on a sale, and that they accepted the terms." },
      { model: "CommissionBid", personal: "customer", what: "A maximum bid a customer left on a lot before the sale, with any notes." },
    ],
  },
  {
    area: "Marketing and website",
    blurb: "Copy, images, plans and the public site's front page.",
    tables: [
      { model: "MarketingDraft", what: "A piece of generated marketing copy, its type and status, and a snapshot of the lots it was written from." },
      { model: "MarketingHashtag", what: "The hashtag bank, by category." },
      { model: "SocialPost", what: "A social post: the copy, its image, hashtags, and when it is scheduled or was posted." },
      { model: "SocialImage", what: "The images uploaded for social posts, with their labels and tags." },
      { model: "MarketingLayout", what: "A saved arrangement of the Marketing Reports sections." },
      { model: "MarketingFavourite", what: "The report sections someone has pinned." },
      { model: "MarketingPlan", what: "A saved business plan — its summary, audience and competitors, plus a FROZEN copy of the analytics figures as they were when the plan was made." },
      { model: "MarketingPlanObjective", what: "A target on a plan: the measure, where it started, where it should get to and by when." },
      { model: "MarketingPlanAction", what: "A job on a plan's to-do list: channel, owner, effort, impact and status." },
      { model: "HeroSlide", what: "The website's hero carousel slides — title, subtitle, button, image and whether each is live." },
    ],
  },
  {
    area: "IT helpdesk and knowledge",
    blurb: "Tickets, the mailbox jobs behind them, and the IT knowledge base.",
    tables: [
      { model: "Ticket", personal: "staff", what: "A helpdesk ticket: what is wrong, its priority and status, who raised it, who it is assigned to and how it was resolved." },
      { model: "TicketComment", personal: "staff", what: "A comment on a ticket, with its author." },
      { model: "TicketCategory", what: "The ticket categories and their order." },
      { model: "KnowledgeArticle", personal: "staff", what: "An IT knowledge-base article, its tags and who wrote or last edited it." },
      { model: "ITJob", personal: "staff", what: "A job pulled from the IT mailbox: the sender's name and email, the message, its status and who is on it." },
      { model: "ITJobMessage", personal: "staff", what: "A reply on an IT job, inbound or outbound, with its author." },
      { model: "ITJobAttachment", what: "A file attached to an IT job or one of its messages, stored in R2." },
      { model: "ITMailboxAuth", what: "The sign-in token that lets the Hub read the IT mailbox. Token only — no password." },
      { model: "ConditionMailboxAuth", what: "The same, for the condition-report mailbox, plus which folder it watches." },
      { model: "EmailTemplate", what: "Reusable email wording, by category." },
      { model: "MacroFile", what: "The macro files staff download — the AutoHotkey scripts and their descriptions." },
    ],
  },
  {
    area: "Accounts",
    blurb: "Card and bank statement reconciliation. Admin only.",
    tables: [
      { model: "AccountingMonth", what: "A month of card and bank paperwork, and whether it is starred." },
      { model: "AccountingDocument", what: "One receipt or invoice: supplier, item, website, date, VAT code, gross, VAT and net, its image, and whether it has been reviewed." },
      { model: "AccountingSupplierRule", what: "A rule that sets a supplier's VAT code and column automatically when its name matches." },
      { model: "AccountingCardholder", personal: "staff", what: "The people whose cards are reconciled." },
      { model: "BankStatement", personal: "staff", what: "An uploaded statement: its label, whose card it is, and the page images." },
      { model: "BankTransaction", what: "A single line on a statement — dates, description, reference, amount and any fee — and which documents it was matched to." },
    ],
  },
  {
    area: "Facilities",
    blurb: "First aid, the building plan and inductions. ⚠ The first aid page is the only page outside the staff login, so some of this is readable by anyone on site.",
    tables: [
      { model: "FirstAider", personal: "staff", what: "The first aiders shown on the PUBLIC first aid page: name, job title, where they sit, phone number and photo." },
      { model: "FirstAidKit", what: "Where each first aid kit and defibrillator is, including its pin on the site plan." },
      { model: "FirstAidInfo", what: "The emergency steps, site address, assembly point and any extra notes on the public page." },
      { model: "AccidentReport", personal: "public", what: "The accident book. Sent from the public page by anyone on site: the injured person's name, address and occupation, what happened and the injury — so it routinely holds health information about a named person. An employer-only section is added inside the Hub. A salted hash of the sender's IP is kept to rate-limit the form; the address itself is never stored." },
      { model: "SitePlan", what: "The building drawing that other records pin onto. Images only." },
      { model: "InductionSlide", what: "The induction slides: text, image, video and layout." },
      { model: "InductionForm", what: "A form new starters read and sign, including which details it asks for." },
      { model: "InductionFormItem", what: "One point on an induction form, and whether it must be ticked." },
      { model: "InductionSignature", personal: "public", what: "A signed induction: typed name, company, job title, start date, the exact wording they agreed to, which points they ticked, their drawn signature and which staff member took it. ⚠ These people usually have no Hub account — new starters, agency staff and contractors." },
    ],
  },
  {
    area: "Training",
    blurb: "The in-app training decks and who has completed them.",
    tables: [
      { model: "TrainingModule", what: "A training module: its title, blurb, icon and which app it teaches." },
      { model: "TrainingSlide", what: "A slide in a module — text, image, video and where its “try it” button goes." },
      { model: "TrainingExercise", what: "A practice task in a module: the brief, the expected answer, the hint and the explanation." },
      { model: "TrainingProgress", personal: "staff", what: "How far each person has got: slides seen, tasks passed, attempts and when they finished." },
      { model: "TrainingSignature", personal: "staff", what: "The declaration signed at the end of a module, with the drawn signature and the score at the time." },
    ],
  },
  {
    area: "Documents and files",
    blurb: "File stores. The files themselves live in Cloudflare R2 — these tables hold the names, sizes and folder structure.",
    tables: [
      { model: "DocumentFolder", what: "A folder in the Admin document store, and its parent." },
      { model: "DocumentFile", personal: "staff", what: "A file in the document store: name, size, type, and who uploaded it." },
      { model: "InvoiceFile", personal: "staff", what: "A file in the invoice store: name, size, type, and who uploaded it." },
    ],
  },
  {
    area: "The app's own record of itself",
    blurb: "What the Hub keeps about the Hub.",
    tables: [
      { model: "PatchNote", what: "The “what's new” note shown to staff in a popup." },
      { model: "PatchNoteSeen", personal: "staff", what: "Who has seen which patch note." },
      { model: "DeployChange", what: "The commits captured at each release — the history behind Admin → Patches & Changes." },
      { model: "ChangeReport", what: "A saved AI progress report for a period, and how many changes it covered." },
      { model: "ClaudeMemory", dormant: true, what: "An older store for the Claude memory notes. The viewer at Admin → Claude Memory is a static page now, so nothing writes here — it only still appears in the backups." },
    ],
  },
  {
    area: "Personal tools (no Vectis data)",
    blurb: "Tables behind one user's own private tools. No customer, staff or auction records are involved, and nothing here feeds any Vectis report.",
    tables: [
      { model: "JordanSavedChat", personal: "staff", what: "Saved personal AI chats — one user's own, visible only to them." },
      { model: "JordanCvProfile", personal: "staff", what: "One user's own CV details, kept for the personal CV tool." },
      { model: "JordanCvApplication", personal: "staff", what: "A job application written from that CV: the advert, the covering letter and the tailored CV." },
      { model: "JordanCar", personal: "staff", what: "One user's own vehicle details and renewal dates." },
      { model: "JordanCarRecord", personal: "staff", what: "A service, MOT or repair record against one of those vehicles." },
      { model: "JordanDocFolder", what: "A folder in that user's personal document store." },
      { model: "JordanDocFile", personal: "staff", what: "A file in that personal store: name, size and type. The file itself is in R2." },
      { model: "McocChampion", what: "A game roster entry for a personal hobby tool." },
      { model: "McocChampionProfile", what: "Reference notes for that game tool." },
      { model: "McocWarFight", what: "A saved fight layout in that game tool." },
      { model: "McocMiniNode", what: "A single node in one of those saved layouts." },
    ],
  },
]

/** Every model named in the map, for the completeness check on the page. */
export const MAPPED_MODELS: string[] = DATA_MAP.flatMap(a => a.tables.map(t => t.model))

export const DATA_MAP_COUNTS = {
  areas:  DATA_MAP.length,
  tables: MAPPED_MODELS.length,
  personal: MAPPED_MODELS.length - DATA_MAP.flatMap(a => a.tables).filter(t => !t.personal).length,
}
