// ─── "Where do I go to…" — the map behind the top-bar Help box ───────────────
//
// Jordan, 2026-09-02: a Help box in the top bar you can ask "where do I go to do an overnight
// run", answering ONLY about the parts of the Hub the person asking may actually open.
//
// ⚠⚠ PERMISSIONS ARE ENFORCED BY FILTERING THE CONTEXT, NOT BY ASKING THE MODEL TO KEEP A
// SECRET. `allowedDestinations()` drops everything the person cannot reach before the question
// is ever sent, so a model that ignores every instruction still cannot mention Accounts to
// someone without Accounts. Never "fix" a leak here by adding a line to the prompt.
//
// Where the knowledge comes from (Jordan's choice over hand-written help pages):
//   1. APP_CARD_DEFS   — the Hub cards: label, description, href, which app permission gates it.
//   2. APP_SECTIONS    — the per-app sidebar sections a role can be restricted to.
//   3. DESTINATIONS    — below: the tabs and pages that matter but appear in neither, because
//                        the answer to most real questions is a TAB, not an app.
//
// ⚠ (3) is hand-written and is the part that can go stale. Keep entries short, keep the `app`
// key honest (it is what gates them), and add one whenever a screen worth finding is built.
// `assertHelpMap()` catches a bad app key at build time; it cannot check that a route exists.

import { APP_CARD_DEFS } from "@/lib/app-cards"
import { ALL_APPS, APP_SECTIONS, hasAppAccess, getAllowedSections, type AppKey } from "@/lib/apps"

export type Destination = {
  /** What it is called on screen — say it back to the user in these words. */
  name: string
  /** Where it is. A path so the answer can link straight to it. */
  href: string
  /** The app permission that gates it. Undefined = everyone signed in can reach it. */
  app?: AppKey
  /** The section key within that app, when the app has per-section permissions. */
  section?: string
  /** One line: what you actually DO there. This is what makes an answer useful. */
  what: string
  /** Extra words someone might ask with, that are not in the name. */
  also?: string[]
}

// ⚠ Ordered roughly by how often someone needs to find it, because the model sees this list
// in order and the earlier entries carry more weight when two could answer the same question.
export const DESTINATIONS: Destination[] = [
  // ── Auction AI ──────────────────────────────────────────────────────────────
  {
    name: "Auction AI → Auto Pipeline", href: "/tools/auction-ai?tab=pipeline", app: "AUCTION_AI",
    what: "Runs a whole sale through the AI in three stages — Batch Run writes the descriptions, Key Points Check puts every key point back in, Double Check reads them over. Start it here and leave the tab open, or queue it to run overnight with nothing open.",
    also: ["overnight run", "run a sale through ai", "describe a sale", "pipeline", "auto apply"],
  },
  {
    name: "Auction AI → Auto Pipeline → the overnight queue", href: "/tools/auction-ai/overnight", app: "AUCTION_AI",
    what: "Queue several sales, each with its own instruction, model and settings, and they work through the night on the server with nothing left open. The morning report for each run lives here too.",
    also: ["overnight", "queue a sale", "run it tonight", "leave it running", "morning report"],
  },
  {
    name: "Auction AI → Batch Run", href: "/tools/auction-ai?tab=batch", app: "AUCTION_AI",
    what: "Describe a set of photos in one go without running the whole pipeline.",
    also: ["descriptions from photos"],
  },
  {
    name: "Auction AI → AI Upgrade", href: "/tools/auction-ai?tab=upgrade", app: "AUCTION_AI",
    what: "Rewrite descriptions that already exist — shorten, expand, humanise, fix grammar, improve SEO and so on.",
    also: ["rewrite descriptions", "tidy up wording"],
  },
  {
    name: "Auction AI → Description Copier", href: "/tools/auction-ai?tab=copier", app: "AUCTION_AI",
    what: "Steps through a sale one lot at a time with a Copy button, for typing descriptions into Business Central. The import macro drives this screen.",
    also: ["copy into bc", "macro", "paste into business central"],
  },
  {
    name: "Auction AI → Instructions", href: "/tools/auction-ai?tab=instructions", app: "AUCTION_AI",
    what: "The saved AI instructions every run uses. Edit, add, favourite, and export or import them between staging and production.",
    also: ["prompts", "change what the ai writes", "presets"],
  },
  {
    name: "Auction AI → Instructions Testing", href: "/tools/auction-ai?tab=instrtest", app: "AUCTION_AI",
    what: "Try an instruction change on 5–10 hand-picked lots before using it on a real sale. It only previews — it never writes anything to the catalogue.",
    also: ["test a prompt", "try wording"],
  },

  // ── Cataloguing ─────────────────────────────────────────────────────────────
  {
    name: "Cataloguing → Auction Manager", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "The list of sales. Open one to reach its lots, and every per-sale tab below.",
    also: ["sales list", "auctions", "open a sale"],
  },
  {
    name: "A sale → Manage Lots", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "Every lot in a sale, with filters and the mass actions — add or remove the condition line, clear descriptions, generate titles, set starting bids, change vendor, mark added to BC, delete.",
    also: ["bulk", "mass change", "add conditions", "starting bids", "delete lots"],
  },
  {
    name: "A sale → Review", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "Read the descriptions against the key points. Shows what needs attention, what only needs a wording check, and anything the AI flagged as a possible cataloguer mistake.",
    also: ["check descriptions", "key points missing", "ai flagged", "mistakes"],
  },
  {
    name: "A sale → Locking Check", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "The last check before a sale goes to BC and the website — blocking problems first, then the ones worth a look.",
    also: ["final check", "before publishing", "ready to lock"],
  },
  {
    name: "A sale → Push to BC", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "Builds the copy-and-paste sheet that puts descriptions, estimates and categories into Business Central, matched by unique ID.",
    also: ["send to business central", "export to bc"],
  },
  {
    name: "A sale → BC Match & Import", href: "/tools/cataloguing/auctions", app: "CATALOGUING", section: "AUCTION_MANAGER",
    what: "Upload BC's Lines export and it writes BC's own unique IDs onto our lots, matched by barcode. This is the only thing that fills in a lot's unique ID.",
    also: ["unique ids blank", "match bc", "import ids"],
  },
  {
    name: "Cataloguing → End of Day → BC", href: "/tools/cataloguing/end-of-day", app: "CATALOGUING", section: "END_OF_DAY",
    what: "Builds tonight's import sheet: every lot not yet in BC, grouped by tote, in the exact format the overnight macro reads. Run Data Sync first.",
    also: ["overnight sheet", "import sheet", "end of day", "tote sheet"],
  },
  {
    name: "Cataloguing → Tablet Cataloguing", href: "/tools/cataloguing/tablet/auctions", app: "CATALOGUING", section: "TABLET_CATALOGUING",
    what: "The tablet-shaped version of cataloguing, for entering lots on the shared iPads in the warehouse.",
    also: ["ipad", "tablet", "add lots on the floor"],
  },
  {
    name: "Cataloguing → Photography", href: "/tools/cataloguing/photography", app: "CATALOGUING", section: "PHOTOGRAPHY",
    what: "Upload photos to a sale's lots, matched by the barcode label in the picture or by the filename.",
    also: ["upload photos", "add pictures", "smart scan"],
  },
  {
    name: "Cataloguing → Lotting Up", href: "/tools/cataloguing/lotting-up", app: "CATALOGUING", section: "LOTTING_UP",
    what: "Work out how to split a bench of items into lots, with pricing from our own sold archive.",
    also: ["split into lots", "group items"],
  },
  {
    name: "Cataloguing → Item Valuations", href: "/tools/cataloguing/research", app: "CATALOGUING", section: "RESEARCH",
    what: "Price an item from photos, using what we have actually sold.",
    also: ["what is it worth", "valuation", "research"],
  },

  // ── Business Central ────────────────────────────────────────────────────────
  {
    name: "BC Warehouse → Data Sync", href: "/tools/bc-warehouse", app: "BC_WAREHOUSE",
    what: "Pulls the latest data down from Business Central. Anything in the Hub that says 'in BC' is answered from this, so run it before the checks that depend on it.",
    also: ["sync bc", "refresh bc", "out of date", "not showing in bc"],
  },
  {
    name: "BC Warehouse", href: "/tools/bc-warehouse", app: "BC_WAREHOUSE",
    what: "Where things are in the building according to BC — location heatmap, sale checklist, search by location, location history, tote data, collections due, unsold items.",
    also: ["where is a lot", "location", "tote", "find an item"],
  },
  {
    name: "Admin Centre", href: "/tools/lot-lookup", app: "ADMIN_CENTRE",
    what: "Answers 'where is this customer's item?' — search by receipt, tote, customer, sale or barcode and see the whole journey in one row.",
    also: ["customer ringing", "where is their item", "look up a receipt", "who catalogued it"],
  },
  {
    name: "BC Reports", href: "/tools/bc-reports", app: "BC_REPORTS",
    what: "Cataloguing, packing and shipping reports built from Business Central data.",
    also: ["reports from bc", "packing report", "shipping"],
  },
  {
    name: "BC Marketing", href: "/tools/bc-marketing", app: "BC_MARKETING",
    what: "Write marketing content from sale data — social posts, web descriptions, email lists, images.",
    also: ["social media", "marketing content", "newsletter"],
  },

  // ── Reports & people ────────────────────────────────────────────────────────
  {
    name: "Cataloguing Reports", href: "/tools/reports", app: "REPORTS",
    what: "How much each cataloguer has done over a period, with charts and printable PDFs.",
    also: ["performance", "how many lots", "per cataloguer", "league table"],
  },
  {
    name: "Cataloguing Reports → Activity", href: "/tools/reports/activity", app: "REPORTS",
    what: "Time accounted for during cataloguing, and the reasons people gave for gaps.",
    also: ["time", "breaks", "unaccounted"],
  },
  {
    name: "Marketing Reports", href: "/tools/marketing-reports", app: "MARKETING_REPORTS",
    what: "Website analytics — visitors, sources, pages, devices, countries — plus the saved Business Plan.",
    also: ["google analytics", "website traffic", "business plan"],
  },
  {
    name: "Manager Portal", href: "/tools/manager-portal", app: "MANAGER_PORTAL",
    what: "Sale progress and projected finish dates, and which departments cover which sales.",
    also: ["will we finish in time", "progress", "departments"],
  },
  {
    name: "Sale Statistics", href: "/tools/sale-statistics", app: "SALE_STATISTICS",
    what: "How a sale performed.",
    also: ["results", "how did it sell"],
  },

  // ── Operations ──────────────────────────────────────────────────────────────
  // ⚠ These three have NO `app` on purpose: their Hub cards are `allUsers: true`, so everyone
  // signed in can already open them. A destination's gate must match its card — gating one of
  // these behind an app key hid it from people who can plainly see it on their home page, which
  // is how the first version of this map was wrong (caught by the permission test, 2026-09-02).
  {
    name: "Packing / Dispatch", href: "/tools/packing",
    what: "Royal Mail dispatch — book parcels, print labels, and the packers' barcode sheet.",
    also: ["post", "royal mail", "dispatch", "labels"],
  },
  {
    name: "Auction Monitor", href: "/tools/auction-monitor",
    what: "Watch a live sale as it runs, with push alerts on the rules you set.",
    also: ["live sale", "watch the auction", "alerts"],
  },
  {
    name: "IT Help", href: "/tools/it-help",
    what: "The IT knowledge base and its own AI chat, for computer and equipment problems rather than 'where do I go' questions.",
    also: ["printer", "password", "broken", "it problem"],
  },
]

/** Every AppKey mentioned in the map really exists. Cheap guard against a typo'd key
 *  silently making an entry invisible to everyone (a wrong key never matches a permission). */
export function assertHelpMap(): string[] {
  const valid = new Set(ALL_APPS.map(a => a.key as string))
  return DESTINATIONS
    .filter(d => d.app && !valid.has(d.app))
    .map(d => `${d.name}: unknown app key "${d.app}"`)
}

export type HelpContext = {
  destinations: Destination[]
  /** The Hub cards this person can open, so "what can I do here" is answerable too. */
  cards: { name: string; href: string; what: string }[]
}

/**
 * Everything this person is allowed to be told about.
 *
 * ⚠ This is the security boundary. A destination survives only if the person passes
 * `hasAppAccess` for its app AND, where the app has per-section permissions, has that section.
 * Entries with no `app` are open to anyone signed in.
 */
export function allowedHelpContext(
  role: string,
  allowedApps: string[],
  appPermissions: Record<string, any> | null | undefined,
): HelpContext {
  const canOpen = (app?: AppKey, section?: string): boolean => {
    if (!app) return true
    if (!hasAppAccess(role, allowedApps, app)) return false
    if (!section) return true
    const sections = getAllowedSections(role, appPermissions, app)
    return sections === null || sections.includes(section)
  }

  const destinations = DESTINATIONS.filter(d => canOpen(d.app, d.section))

  const cards = APP_CARD_DEFS
    .filter(c => !c.comingSoon)
    .filter(c => c.allUsers || (c.appKey ? hasAppAccess(role, allowedApps, c.appKey) : role === "ADMIN"))
    .map(c => ({ name: c.defaultLabel, href: c.href, what: c.defaultDescription }))

  return { destinations, cards }
}

/** The context as the text the model reads. Kept stable and boring so Claude can cache it. */
export function helpContextText(ctx: HelpContext): string {
  const sections = APP_SECTIONS as Record<string, { key: string; label: string }[]>
  const lines: string[] = []

  lines.push("PLACES IN THE VECTIS HUB THIS PERSON CAN OPEN")
  lines.push("")
  for (const d of ctx.destinations) {
    lines.push(`- ${d.name} — ${d.href}`)
    lines.push(`  ${d.what}`)
    if (d.also?.length) lines.push(`  Also asked as: ${d.also.join(", ")}`)
  }

  lines.push("")
  lines.push("HUB CARDS THIS PERSON SEES ON THE HOME PAGE")
  for (const c of ctx.cards) lines.push(`- ${c.name} — ${c.href} — ${c.what}`)

  const shown = new Set(ctx.destinations.map(d => d.app).filter(Boolean) as string[])
  const withSections = Object.entries(sections).filter(([app]) => shown.has(app))
  if (withSections.length) {
    lines.push("")
    lines.push("SECTIONS WITHIN THOSE TOOLS")
    for (const [app, list] of withSections) {
      lines.push(`- ${app}: ${list.map(s => s.label).join(", ")}`)
    }
  }

  return lines.join("\n")
}
