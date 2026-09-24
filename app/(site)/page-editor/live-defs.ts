import { DepartmentFieldUI } from "./fields-ui"

// The page editor's LIVE blocks — each shows something the Hub already holds (the banner slides,
// upcoming sales, the auction calendar, news, a department's lots…), so it is always up to date and
// nobody retypes it. Only the words around it are settings here. Pure: the site gives each one its
// server-side render (live.tsx); the editor shows the site's own render of it in a frame
// (/site-block), so the preview is exactly what the site will show.
//
// ⚠ Never rename a key — saved pages refer to blocks by it.

const department = (label = "Department") => ({ type: "custom" as const, label, render: DepartmentFieldUI })
const text = (label: string) => ({ type: "text" as const, label })
const textarea = (label: string) => ({ type: "textarea" as const, label })

export type LiveDef = { label: string; fields: Record<string, any>; defaultProps: Record<string, unknown>; help: string }

export const LIVE_DEFS = {
  LiveHero: {
    label: "Live: Banner slides (from the Banner Manager)",
    help: "The home page's rotating banner — its slides, pictures and colours are edited in Website → Banner Manager.",
    fields: {},
    defaultProps: {},
  },
  LiveUpcoming: {
    label: "Live: Upcoming auctions",
    help: "The next published sales, with their pictures and dates.",
    fields: { kicker: text("Small line above"), heading: text("Heading"), count: { type: "select", label: "How many", options: [3, 6, 9, 12].map(n => ({ label: String(n), value: n })) } },
    defaultProps: { kicker: "Don't Miss", heading: "Upcoming Auctions", count: 6 },
  },
  LiveCalendar: {
    label: "Live: Auction calendar (upcoming and results, with search)",
    help: "The whole calendar — the Upcoming and View Results tabs, the search, the date picker and the list.",
    fields: { title: text("Title") },
    defaultProps: { title: "Auction Calendar" },
  },
  LiveStats: {
    label: "Live: Stats band (counted from the Hub)",
    help: "Years since 1988, lots sold, auctions a year and the number of departments — counted, never typed.",
    fields: {},
    defaultProps: {},
  },
  LiveSpecialisms: {
    label: "Live: Specialisms (the sale types)",
    help: "A strip of the auction types, each opening the calendar filtered to it.",
    fields: { kicker: text("Small line above"), heading: text("Heading") },
    defaultProps: { kicker: "Explore by Category", heading: "Our Specialisms" },
  },
  LiveDepartments: {
    label: "Live: Departments (every department's tile)",
    help: "A tile for every department collected from vectis.co.uk, each opening its page.",
    fields: { kicker: text("Small line above"), heading: text("Heading"), intro: textarea("A line or two under the heading") },
    defaultProps: {
      kicker: "Specialist teams",
      heading: "Departments",
      intro: "Vectis has a number of specialist departments, each holding a series of auctions through the year. Pick a department for what we sell, highlighted lots, the latest news and past results.",
    },
  },
  LiveHighlights: {
    label: "Live: A department's highlighted lots",
    help: "The hand-picked past lots from the department's page on vectis.co.uk, linked to our own results pages where we hold them.",
    fields: { department: department(), kicker: text("Small line above"), heading: text("Heading") },
    defaultProps: { department: "", kicker: "From the archive", heading: "Highlighted lots" },
  },
  LivePastAuctions: {
    label: "Live: A department's past auctions",
    help: "The department's finished sales, newest first, each opening its results.",
    fields: { department: department(), kicker: text("Small line above"), heading: text("Heading"), count: { type: "select", label: "How many", options: [4, 8, 12].map(n => ({ label: String(n), value: n })) } },
    defaultProps: { department: "", kicker: "Results", heading: "Past auctions", count: 8 },
  },
  LiveNews: {
    label: "Live: Latest news",
    help: "The newest News & Stories — all of them, one category's, or a department's.",
    fields: {
      heading: text("Heading"),
      department: department("Only this department's news (optional)"),
      category: text("…or only this category (optional, e.g. TV & Film)"),
      count: { type: "select", label: "How many", options: [3, 4, 6, 8].map(n => ({ label: String(n), value: n })) },
      layout: { type: "radio", label: "Look", options: [{ label: "Compact list", value: "list" }, { label: "Cards", value: "cards" }] },
    },
    defaultProps: { heading: "Latest news", department: "", category: "", count: 3, layout: "list" },
  },
  LiveNewsIndex: {
    label: "Live: News & Stories (search, featured and every story)",
    help: "The whole News & Stories listing — the search, the category pick, the featured stories and every story, 24 a page.",
    fields: { kicker: text("Small line above"), title: text("Title"), intro: textarea("A line under the title") },
    defaultProps: { kicker: "From the saleroom", title: "News & Stories", intro: "Sold prices, stories and news from the world's leading toy and collectables auction house." },
  },
  LiveSellForm: {
    label: "Live: Sell with us — the valuation form",
    help: "The form customers fill in to ask for a valuation, with their photos. What they send arrives in Submissions.",
    fields: {},
    defaultProps: {},
  },
} satisfies Record<string, LiveDef>

export type LiveType = keyof typeof LIVE_DEFS
export const LIVE_TYPES = Object.keys(LIVE_DEFS) as LiveType[]
