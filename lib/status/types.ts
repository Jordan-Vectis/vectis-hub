// 🚦 Status Centre — the contract every service check follows.
//
// The page answers ONE question for an admin: "staff say something's broken —
// is it us or one of our suppliers?" (Jordan, 2026-09-10). So a check must say
// whether the Hub can actually DO ITS JOB with the service, not merely whether
// a host answers. The model case is 2026-09-09: the database answered every
// read, Railway and Neon's status pages were green, and ~1 in 4 saves failed.
//
// ⚠ Every check is READ-ONLY and FREE. Never send an email, create an order,
// publish a notification, write a probe row, spend AI generation quota or
// credits. A check that can't be made safe reports a passive signal instead
// ("last worked at …"), or "unknown".

/** ok = working · degraded = working with problems · down = not working ·
 *  unknown = couldn't tell (the check itself failed or can't run) ·
 *  off = not expected to run in this environment (e.g. background jobs on sandbox). */
export type StatusState = "ok" | "degraded" | "down" | "unknown" | "off"

export type StatusGroup = "hub" | "ai" | "business-central" | "email" | "suppliers"

export const GROUP_LABELS: Record<StatusGroup, string> = {
  "hub":              "The Hub and its own storage",
  "ai":               "AI",
  "business-central": "Business Central",
  "email":            "Email into the Hub",
  "suppliers":        "Other suppliers",
}

/** One plain-English line for the detail panel. Never a secret, key, token or connection string. */
export interface Fact { label: string; value: string; tone?: "good" | "warn" | "bad" }

export interface CheckResult {
  state: StatusState
  /** One plain-English sentence for the tile, e.g. "25 of 25 connections can save". */
  summary: string
  /** Extra lines for the detail panel. */
  facts?: Fact[]
  /** How long the service took to answer, when that means something. */
  latencyMs?: number
  /** Whose side a bad result is on, for a SUPPLIER's light. "hub" = the fix is in the Hub's own hands —
   *  a setting (Admin → AI Models), a key or variable missing or refused, a person's sign-in that needs
   *  redoing, the Hub's own job or copy gone stale — e.g. tools set to a model Google has retired.
   *  Leave it out when the supplier itself is down, slow, erroring or rate-limiting.
   *  Ignored for group "hub", which is always inside the Hub. (Jordan, 2026-09-10: the banner blamed
   *  "a supplier" for what was the Hub's own AI Models setting.) */
  cause?: "hub" | "supplier"
}

export interface CheckContext {
  /** RAILWAY_ENVIRONMENT_NAME ("production", "staging", "sandbox"…) or "development". */
  env: string
  isProduction: boolean
  /** True only where the server.js background jobs actually run (production build + CRON_SECRET set).
   *  ⚠ Staging/sandbox databases are BRANCHES of production and hold copied "last ran" timestamps
   *  that stopped moving the day they were made — check this FIRST and return "off", never red. */
  backgroundJobsExpected: boolean
  now: Date
}

export interface StatusCheckDef {
  /** Stable id: used in the database, the URL hash and the API. Never rename one. */
  key: string
  /** What an admin calls it: "Database", "Business Central". */
  name: string
  group: StatusGroup
  /** What the Hub uses it for, plain English. */
  what: string
  /** What stops working when it's down, plain English. */
  whenDown: string
  /** The supplier's own public status page, if there is one. */
  statusPage?: string
  /** Minimum minutes between automatic runs (default 5). "Check now" ignores it. */
  intervalMin?: number
  /** Hard cap the engine applies (default 25 000 ms); a check should use its own shorter timeouts. */
  timeoutMs?: number
  run(ctx: CheckContext): Promise<CheckResult>
}

// ── What /api/status returns ────────────────────────────────────────────────────

export interface Bucket { at: string; state: StatusState | null }

export interface ServiceView {
  key: string
  name: string
  group: StatusGroup
  what: string
  whenDown: string
  statusPage: string | null
  /** "pending" = never checked yet on this environment · "disabled" = switched off by an admin on the page
   *  (never checked, never counted, never rings the bell). */
  state: StatusState | "pending" | "disabled"
  /** Who switched it off and when; both null while it is on. */
  disabledBy: string | null
  disabledAt: string | null
  /** Whose side the current problem is on: always "hub" for the hub group; for a supplier, what its check said. */
  cause: "hub" | "supplier"
  summary: string
  facts: Fact[]
  latencyMs: number | null
  /** When the current state began. */
  since: string | null
  lastCheckedAt: string | null
  lastOkAt: string | null
  /** Share of checks in which it was NOT down (ok or degraded), 0–100; null when there's no history. */
  uptime: { h24: number | null; d7: number | null; d30: number | null }
  /** Worst state in each of the last 24 hours, oldest first. */
  hours: Bucket[]
  /** Worst state on each of the last 30 days (London days), oldest first. */
  days: Bucket[]
}

export interface NotificationView {
  id: string
  level: "info" | "warning" | "error" | "success"
  title: string
  body: string | null
  href: string | null
  createdAt: string
}

export interface StatusResponse {
  env: string
  generatedAt: string
  /** False until Run Migrations has created the Status Centre tables — the page still shows live results. */
  historyAvailable: boolean
  services: ServiceView[]
  /** The most recent status alerts (newest first) — the same items the bell shows. */
  alerts: NotificationView[]
}

export interface RunResponse {
  ran: string[]
  changed: string[]
  results: { key: string; state: StatusState; summary: string }[]
  error?: string
}
