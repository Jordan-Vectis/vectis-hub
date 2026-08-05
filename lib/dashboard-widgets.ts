// Manager Portal → Dashboard: the catalogue of things that can go on it.
//
// The registry lives in CODE and the arrangement lives in the DATABASE. A saved
// layout is only ever a list of keys and sizes, so:
//   - retiring a widget can't corrupt anyone's dashboard (an unknown key is
//     skipped, not an error), and
//   - a stored layout can never grant access to anything. Every widget names the
//     app it belongs to, the "+ Add" list is filtered by it, and the widget's
//     own route re-checks it server-side. A dashboard pulls figures out of a
//     dozen apps into one screen, which makes it the obvious accidental way
//     round the app permissions and the department gate — so the check is done
//     per widget, every time, not once for the page.
//
// To add a report: add an entry here and a route at
// /api/dashboard/widgets/<key>. Nothing else needs to change.

import type { AppKey } from "@/lib/apps"

/** How much width a widget takes on the dashboard grid. */
export type WidgetSize = "small" | "medium" | "wide"

export const SIZE_CLASS: Record<WidgetSize, string> = {
  small:  "md:col-span-1",
  medium: "md:col-span-2",
  wide:   "md:col-span-4",
}

export const SIZE_LABEL: Record<WidgetSize, string> = {
  small:  "Small",
  medium: "Medium",
  wide:   "Full width",
}

export type WidgetGroup =
  | "sales"      // sale progress, pace, projections
  | "people"     // who catalogued what, time, attendance
  | "results"    // sale results and money — BC
  | "warehouse"  // stock, totes, packing, shipping — BC
  | "queues"     // things waiting for someone
  | "web"        // marketing / site analytics

export const GROUP_LABEL: Record<WidgetGroup, string> = {
  sales:     "Sales & progress",
  people:    "People & pace",
  results:   "Sale results",
  warehouse: "Warehouse & despatch",
  queues:    "Needs action",
  web:       "Website",
}

export type WidgetDef = {
  key:   string
  label: string
  /** Shown in the Add picker — say what the number actually means. */
  description: string
  group: WidgetGroup
  /** The app this data belongs to. Nobody sees a widget for an app they can't open. */
  app:   AppKey
  defaultSize: WidgetSize
  /** Sizes this widget can be set to — a table is unreadable at "small". */
  sizes: WidgetSize[]
  /**
   * True when the widget's route calls Business Central. Those are slow (up to
   * a 45s timeout) and rate-limited, so the frame loads them after the local
   * ones rather than firing everything at once.
   */
  bc?: boolean
  /** Where the "open the full report" link goes. */
  href?: string
}

// ⚠ BC's own per-cataloguer figures are deliberately NOT here (2026-08-05,
// Jack): cataloguing numbers come from the Hub. The sale-progress widget shows
// the Hub and BC lot counts as two separate figures rather than one combined
// total, so you can see the gap between the systems — see the note in
// sale-progress's route about why it must still agree with the Sales tab.
export const WIDGETS: WidgetDef[] = [
  // ── Sales & progress ─────────────────────────────────────────────────────
  {
    key: "sale-progress",
    label: "Sales in progress",
    description: "Every active sale with its Hub lot count and its BC lot count side by side, the cataloguing pace, and the projected date it reaches the next hundred.",
    group: "sales", app: "MANAGER_PORTAL", defaultSize: "wide", sizes: ["medium", "wide"], bc: true,
    href: "/tools/manager-portal?tab=sales",
  },
  {
    key: "sale-countdown",
    label: "Next sales",
    description: "The sales coming up soonest, how many days away they are, and whether the current pace gets them finished in time.",
    group: "sales", app: "MANAGER_PORTAL", defaultSize: "medium", sizes: ["small", "medium", "wide"],
    href: "/tools/manager-portal?tab=sales",
  },
  {
    key: "department-load",
    label: "Workload by department",
    description: "Active sales grouped by department, with lots done and who has been working on them.",
    group: "sales", app: "MANAGER_PORTAL", defaultSize: "medium", sizes: ["medium", "wide"],
    href: "/tools/manager-portal?tab=departments",
  },

  // ── People & pace ────────────────────────────────────────────────────────
  {
    key: "lots-today",
    label: "Lots catalogued today",
    description: "Today's lot count for the whole team, with yesterday's for comparison.",
    group: "people", app: "REPORTS", defaultSize: "small", sizes: ["small", "medium"],
    href: "/tools/reports?range=today",
  },
  {
    key: "cataloguer-leaderboard",
    label: "Lots per cataloguer",
    description: "Who catalogued how many over the period you pick, with their daily average.",
    group: "people", app: "REPORTS", defaultSize: "medium", sizes: ["medium", "wide"],
    href: "/tools/reports",
  },
  {
    key: "time-per-lot",
    label: "Average time per lot",
    description: "Mean time on a lot across the team, from the cataloguing timing logs, with the per-person spread.",
    group: "people", app: "REPORTS", defaultSize: "medium", sizes: ["small", "medium", "wide"],
    href: "/tools/reports",
  },
  {
    key: "monthly-trend",
    label: "Lots per month",
    description: "Total lots catalogued each month, so you can see the trend rather than a single day's figure.",
    group: "people", app: "REPORTS", defaultSize: "wide", sizes: ["medium", "wide"],
    href: "/tools/reports",
  },

  // ── Sale results (BC) ────────────────────────────────────────────────────
  {
    key: "sale-value",
    label: "Sale value",
    description: "Total hammer across completed sales in the period, with buyer's premium earned and the number of sales it covers.",
    group: "results", app: "SALE_STATISTICS", defaultSize: "small", sizes: ["small", "medium"], bc: true,
    href: "/tools/sale-statistics",
  },
  {
    key: "sell-through",
    label: "Sell-through rate",
    description: "Percentage of offered lots that sold, and how the hammer compared with the high estimate.",
    group: "results", app: "SALE_STATISTICS", defaultSize: "small", sizes: ["small", "medium"], bc: true,
    href: "/tools/sale-statistics",
  },
  {
    key: "recent-sale-results",
    label: "Recent sale results",
    description: "The last few completed sales — hammer, lots sold, lots passed, sell-through and value against estimate.",
    group: "results", app: "SALE_STATISTICS", defaultSize: "wide", sizes: ["medium", "wide"], bc: true,
    href: "/tools/sale-statistics",
  },
  {
    key: "vendors-buyers",
    label: "Vendors & buyers",
    description: "Number of vendors selling and successful buyers over the period.",
    group: "results", app: "SALE_STATISTICS", defaultSize: "small", sizes: ["small", "medium"], bc: true,
    href: "/tools/sale-statistics",
  },

  // ── Warehouse & despatch (BC) ────────────────────────────────────────────
  {
    key: "warehouse-stock",
    label: "Stock awaiting cataloguing",
    description: "Items in the warehouse not yet catalogued, broken down by category, plus how many totes are open.",
    group: "warehouse", app: "BC_REPORTS", defaultSize: "medium", sizes: ["medium", "wide"], bc: true,
    href: "/tools/bc-reports",
  },
  {
    key: "packing-throughput",
    label: "Packing throughput",
    description: "Collections packed and lots packed per staff member, with each person's daily average.",
    group: "warehouse", app: "BC_REPORTS", defaultSize: "medium", sizes: ["medium", "wide"], bc: true,
    href: "/tools/bc-reports",
  },
  {
    key: "shipping-summary",
    label: "Despatch summary",
    description: "Parcels and items shipped by region, with revenue, over the period.",
    group: "warehouse", app: "BC_REPORTS", defaultSize: "medium", sizes: ["medium", "wide"], bc: true,
    href: "/tools/bc-reports",
  },

  // ── Needs action ─────────────────────────────────────────────────────────
  {
    key: "condition-reports",
    label: "Condition reports waiting",
    description: "Customer condition-report requests not yet answered, oldest first.",
    group: "queues", app: "CRM", defaultSize: "small", sizes: ["small", "medium"],
    href: "/tools/condition-reports",
  },
  {
    key: "job-board",
    label: "Open IT jobs",
    description: "Jobs on the IT board that are still open, and how long the oldest has been waiting.",
    group: "queues", app: "CRM", defaultSize: "small", sizes: ["small", "medium"],
    href: "/tools/job-board",
  },
  {
    key: "review-flags",
    label: "Lots flagged in Review",
    description: "Lots a cataloguer or the AI has flagged as needing a second look.",
    group: "queues", app: "CATALOGUING", defaultSize: "small", sizes: ["small", "medium"],
  },

  // ── Website ──────────────────────────────────────────────────────────────
  {
    key: "web-traffic",
    label: "Website traffic",
    description: "Sessions on the website over the period, against the previous one.",
    group: "web", app: "MARKETING_REPORTS", defaultSize: "small", sizes: ["small", "medium"], bc: false,
    href: "/tools/marketing-reports",
  },
]

export const WIDGETS_BY_KEY: Record<string, WidgetDef> =
  Object.fromEntries(WIDGETS.map(w => [w.key, w]))

/** One widget as it sits on somebody's dashboard. */
export type DashboardWidgetPlacement = { key: string; size: WidgetSize }

/**
 * What every widget route returns.
 *
 * This is the whole reason the dashboard can absorb 40 reports without becoming
 * 40 components: the frame knows how to draw these five shapes, so adding a
 * report is a route that returns one of them and an entry in WIDGETS. No new
 * rendering code, and every card looks like every other card.
 *
 * `note` is a footnote for a caveat that would otherwise mislead — "BC only",
 * "excludes withdrawn", "last 30 days".
 */
export type WidgetBody =
  | { kind: "stat";  value: string; sub?: string; delta?: { text: string; good: boolean } }
  | { kind: "stats"; items: { label: string; value: string; sub?: string }[] }
  | { kind: "list";  rows: { label: string; value: string; sub?: string; href?: string }[] }
  | { kind: "bars";  rows: { label: string; value: number; display?: string }[] }
  | { kind: "table"; columns: string[]; align?: ("left" | "right")[]; rows: (string | number)[][] }

export type WidgetPayload = WidgetBody & { note?: string; empty?: string }

/**
 * What a person sees before they have arranged anything themselves, and what an
 * admin has not set a role default for. Deliberately short — an empty dashboard
 * is confusing, a full one is noise.
 */
export const STARTER_LAYOUT: DashboardWidgetPlacement[] = [
  { key: "sale-progress",          size: "wide" },
  { key: "lots-today",             size: "small" },
  { key: "cataloguer-leaderboard", size: "medium" },
  { key: "time-per-lot",           size: "medium" },
]

/**
 * Clean a stored layout: drop unknown keys (a retired widget), drop anything the
 * viewer has no app access to, force a size the widget actually supports, and
 * de-duplicate. Used on read AND on write, so nothing can be persisted that
 * wouldn't survive being read back.
 */
export function sanitiseLayout(
  raw: unknown,
  canUse: (app: AppKey) => boolean,
): DashboardWidgetPlacement[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: DashboardWidgetPlacement[] = []
  for (const item of raw) {
    const key = typeof item?.key === "string" ? item.key : null
    if (!key || seen.has(key)) continue
    const def = WIDGETS_BY_KEY[key]
    if (!def || !canUse(def.app)) continue
    seen.add(key)
    const size: WidgetSize = def.sizes.includes(item?.size) ? item.size : def.defaultSize
    out.push({ key, size })
  }
  return out
}
