// Marketing Business Plan — shared shapes and the snapshot builder.
//
// A plan is written against a set of Google Analytics figures. Those figures
// are FROZEN onto the plan (`MarketingPlan.snapshot`) the moment it is created
// or refreshed, because a plan that silently re-reads live GA would say
// something different every time it was opened or printed — and a target of
// "sessions 12,430 → 15,000" is meaningless if the 12,430 moves.
//
// Everything here is pure/serialisable so the same objects go to the page, the
// AI prompt and the PDF without three versions of the numbers drifting apart.
//
// ⚠ This module is imported by the CLIENT editor, so it must stay free of any
// value import from lib/ga — that would drag the @google-analytics/data client
// into the browser bundle. Types only here; the GA read lives in
// lib/marketing-plan-snapshot.ts.

import type { GaRange, MetricKey } from "@/lib/ga"

const RANGE_DAYS: Record<GaRange, number> = { "7d": 7, "28d": 28, "90d": 90, "365d": 365 }

// ─── Channels ───────────────────────────────────────────────────────────────
// The buckets actions are filed under. Deliberately close to GA's own default
// channel grouping so an action sits next to the figure that justifies it.
export const PLAN_CHANNELS: { key: string; label: string; hint: string }[] = [
  { key: "organic",  label: "Organic search",   hint: "Unpaid Google/Bing results — SEO, page titles, content." },
  { key: "paid",     label: "Paid search & ads", hint: "Google Ads and other paid clicks." },
  { key: "social",   label: "Social",            hint: "Facebook, Instagram, X, YouTube — paid or unpaid." },
  { key: "email",    label: "Email",             hint: "Newsletters and campaign emails to buyers and vendors." },
  { key: "referral", label: "Referrals & PR",    hint: "Links from other sites, press coverage, listings." },
  { key: "site",     label: "Website & UX",      hint: "Changes to the site itself — landing pages, search, speed." },
  { key: "other",    label: "Other",             hint: "Anything that doesn't fit a channel above." },
]

export const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(PLAN_CHANNELS.map((c) => [c.key, c.label]))
export function channelLabel(key: string): string { return CHANNEL_LABEL[key] ?? "Other" }

export const PLAN_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const
export const ACTION_STATUSES: { key: string; label: string }[] = [
  { key: "TODO",  label: "To do" },
  { key: "DOING", label: "In progress" },
  { key: "DONE",  label: "Done" },
]
export const EFFORT_LEVELS = ["Low", "Medium", "High"] as const

// ─── Snapshot ───────────────────────────────────────────────────────────────
// The GA sections a plan is built on. Fewer than the full catalog — these are
// the ones that actually change what you'd DO, rather than describe the tech
// people browse on.
export const PLAN_SECTION_IDS = [
  "channels", "sources", "landingPages", "pages", "siteSearch",
  "keyEvents", "regByChannel", "countries", "regions", "devices",
  "newReturning", "dayOfWeek",
]

export type PlanStat    = { key: string; label: string; value: string; raw: number; delta: number | null }
export type PlanSection = { id: string; title: string; suffix: string; rows: { name: string; value: number }[] }

export type PlanSnapshot = {
  takenAt:     string        // ISO
  rangeKey:    GaRange
  rangeLabel:  string        // "Last 28 days"
  ukOnly:      boolean
  excludeBots: boolean
  stats:       PlanStat[]
  sections:    PlanSection[]
}

export function rangeLabelFor(range: GaRange): string {
  return `Last ${RANGE_DAYS[range] ?? 28} days`
}

// ── Formatting (shared by the page, the AI prompt and the PDF) ──────────────
export function fmtNum(n: number): string { return Math.round(n).toLocaleString("en-GB") }
export function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return "—"
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
export function fmtPct(rate: number): string { return `${(rate * 100).toFixed(1)}%` }
export function fmtDelta(pct: number | null): string {
  if (pct === null || !isFinite(pct)) return "no comparison"
  return `${pct >= 0 ? "up" : "down"} ${Math.abs(pct * 100).toFixed(1)}% vs the previous period`
}

export const STAT_DEFS: { key: MetricKey; label: string; fmt: (n: number) => string; higherBetter: boolean }[] = [
  { key: "activeUsers",            label: "Active users",     fmt: fmtNum,      higherBetter: true  },
  { key: "newUsers",               label: "New users",        fmt: fmtNum,      higherBetter: true  },
  { key: "sessions",               label: "Sessions",         fmt: fmtNum,      higherBetter: true  },
  { key: "screenPageViews",        label: "Page views",       fmt: fmtNum,      higherBetter: true  },
  { key: "averageSessionDuration", label: "Avg session",      fmt: fmtDuration, higherBetter: true  },
  { key: "engagementRate",         label: "Engagement",       fmt: fmtPct,      higherBetter: true  },
  { key: "bounceRate",             label: "Bounce rate",      fmt: fmtPct,      higherBetter: false },
  { key: "engagedSessions",        label: "Engaged sessions", fmt: fmtNum,      higherBetter: true  },
  { key: "keyEvents",              label: "Key events",       fmt: fmtNum,      higherBetter: true  },
]

/** Is a movement in this metric good news? Used for the wording in the AI prompt. */
export function higherIsBetter(label: string): boolean {
  return STAT_DEFS.find((s) => s.label === label)?.higherBetter ?? true
}

/** Older/partial snapshots are read defensively — a plan saved before a shape
 *  change must still open rather than crash the page. */
export function asSnapshot(value: unknown): PlanSnapshot | null {
  if (!value || typeof value !== "object") return null
  const s = value as Partial<PlanSnapshot>
  if (!Array.isArray(s.stats) || !Array.isArray(s.sections)) return null
  return {
    takenAt:     typeof s.takenAt === "string" ? s.takenAt : "",
    rangeKey:    (s.rangeKey ?? "28d") as GaRange,
    rangeLabel:  s.rangeLabel ?? "",
    ukOnly:      !!s.ukOnly,
    excludeBots: !!s.excludeBots,
    stats:       s.stats,
    sections:    s.sections,
  }
}

// ─── The figures, as text ───────────────────────────────────────────────────
// One renderer used by BOTH the AI prompt and (in spirit) the PDF, so what the
// model was told and what the plan prints can't disagree.
export function snapshotToText(snap: PlanSnapshot): string {
  const scope = [
    snap.ukOnly ? "UK visitors only" : null,
    snap.excludeBots ? "bot-heavy countries excluded" : null,
  ].filter(Boolean).join(", ") || "all traffic"

  const head = snap.stats
    .map((s) => `- ${s.label}: ${s.value} (${fmtDelta(s.delta)}${higherIsBetter(s.label) ? "" : "; lower is better"})`)
    .join("\n")

  const tables = snap.sections
    .filter((sec) => sec.rows.length > 0)
    .map((sec) => `${sec.title}:\n${sec.rows.map((r) => `  - ${r.name}: ${fmtNum(r.value)} ${sec.suffix}`.trimEnd()).join("\n")}`)
    .join("\n\n")

  return `PERIOD: ${snap.rangeLabel} (scope: ${scope})

HEADLINE FIGURES
${head}

BREAKDOWNS
${tables}`
}
