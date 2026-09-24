// The pages of the TEST website that the page editor (Website → Pages) can edit — Jordan,
// 2026-09-24: "I need it for every page". Pure data, safe on the server and in the editor.
//
// A page's `slug` is its address without the leading slash ("home" is /). Every page here has a
// built-in design in code; the editor starts from a copy of it expressed as blocks (seeds.ts), and
// the site keeps showing the built-in design until the page is PUBLISHED from the editor.
// Department pages ("departments/<slug>") and new pages of the editor's own ("<slug>") join them.

export type PageGroup = "Main pages" | "Help & information" | "Departments" | "New pages"

export type BuiltInPage = { slug: string; label: string; group: PageGroup }

export const BUILT_IN_PAGES: BuiltInPage[] = [
  { slug: "home", label: "Home", group: "Main pages" },
  { slug: "auctions", label: "Auction Calendar", group: "Main pages" },
  { slug: "departments", label: "Departments (the list of them)", group: "Main pages" },
  { slug: "sell-with-us", label: "Sell with us", group: "Main pages" },
  { slug: "news-stories/news", label: "News & Stories", group: "Main pages" },
  { slug: "how-to-bid", label: "How to Bid", group: "Help & information" },
  { slug: "faq", label: "FAQ", group: "Help & information" },
  { slug: "contact", label: "Contact Us", group: "Help & information" },
  { slug: "careers", label: "Careers", group: "Help & information" },
  { slug: "terms", label: "Terms & Conditions", group: "Help & information" },
]

export const DEPT_PREFIX = "departments/"

/** The page's address on the site. */
export const pathFor = (slug: string) => (slug === "home" ? "/" : `/${slug}`)

/** A new page's own address: lower-case words joined by single dashes. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A department's page slug ("departments/dinky-toys"), or null for anything else. */
export const deptSlugOf = (slug: string) => {
  if (!slug.startsWith(DEPT_PREFIX)) return null
  const d = slug.slice(DEPT_PREFIX.length)
  return /^[a-z0-9-]+$/.test(d) ? d : null
}

// ⚠ Every top-level address the app already answers — the Hub's own pages, the site's built-in
// pages, the public links and the API. A new page may not take one: the existing route would win
// and the new page could never be reached (or, worse, would shadow a Hub page's name in the list).
// Add to this when a new top-level route is created.
export const RESERVED_SLUGS = new Set([
  // the Hub
  "admin", "auction-controller", "contacts", "databases", "follow-ups", "hub", "jordan", "submissions", "tools", "website",
  // the test website's own routes
  "account", "auctions", "careers", "contact", "departments", "faq", "how-to-bid", "news-stories", "portal", "search", "sell-with-us", "terms",
  // top-level routes outside the groups
  "api", "first-aid", "generated", "login", "setup", "submit", "value", "site-block",
  // names that would only confuse
  "home", "index", "pages", "page", "new", "edit", "_next", "static", "public",
])

/** Why a new page can't have this address, or null when it can. */
export function slugProblem(slug: string): string | null {
  if (!slug) return "Give the page an address."
  if (slug.length > 60) return "Keep the address under 60 characters."
  if (!SLUG_RE.test(slug)) return "Use lower-case letters, numbers and single dashes only (like about-us)."
  if (RESERVED_SLUGS.has(slug)) return `/${slug} is already a page of the site or the Hub — choose another address.`
  return null
}

/** Turns a page name into a suggested address ("About Us" → "about-us"). */
export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
