import { BetaAnalyticsDataClient } from "@google-analytics/data"

// Google Analytics 4 (GA4) Data API wrapper for the Marketing Reports page.
// Configure via two Railway env vars:
//   GA4_PROPERTY_ID         — the numeric GA4 property id (Admin → Property Settings)
//   GA_SERVICE_ACCOUNT_JSON — the full service-account key JSON (one line), the
//                             service account added as a Viewer on the GA4 property
//                             with the Analytics Data API enabled.

export function isGaConfigured(): boolean {
  return !!(process.env.GA4_PROPERTY_ID && process.env.GA_SERVICE_ACCOUNT_JSON)
}

let cached: BetaAnalyticsDataClient | null = null
function client(): BetaAnalyticsDataClient {
  if (cached) return cached
  const raw = process.env.GA_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error("GA_SERVICE_ACCOUNT_JSON not set")
  const creds = JSON.parse(raw)
  cached = new BetaAnalyticsDataClient({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    projectId: creds.project_id,
  })
  return cached
}

const propertyPath = () => `properties/${process.env.GA4_PROPERTY_ID}`

export type GaRange = "7d" | "28d" | "90d" | "365d"
const RANGE_DAYS: Record<GaRange, number> = { "7d": 7, "28d": 28, "90d": 90, "365d": 365 }
export function rangeDays(range: GaRange): number { return RANGE_DAYS[range] ?? 28 }

// Country IDs (ISO 3166-1) treated as mostly bot/scraper traffic. The "hide bots"
// toggle excludes these from every report. Deliberately leaves out Japan/Korea —
// likely genuine diecast/model collectors. Adjust this list as needed.
export const BOT_COUNTRY_IDS = ["CN", "HK", "TW", "SG", "IN", "VN", "ID", "PH", "TH", "PK", "BD"]

// A GA4 dimensionFilter that excludes the bot countries (by countryId), or
// undefined when the toggle is off.
function botFilter(excludeBots?: boolean) {
  if (!excludeBots) return undefined
  return { notExpression: { filter: { fieldName: "countryId", inListFilter: { values: BOT_COUNTRY_IDS } } } }
}

type Row = { name: string; value: number; secondary?: number }

// Run a single GA4 report and shape the rows as { name, value }.
async function report(
  range: GaRange,
  dimension: string,
  metric: string,
  opts: { limit?: number; secondaryMetric?: string; excludeBots?: boolean } = {},
): Promise<Row[]> {
  const [res] = await client().runReport({
    property: propertyPath(),
    dateRanges: [{ startDate: `${rangeDays(range)}daysAgo`, endDate: "today" }],
    dimensions: [{ name: dimension }],
    metrics: [{ name: metric }, ...(opts.secondaryMetric ? [{ name: opts.secondaryMetric }] : [])],
    dimensionFilter: botFilter(opts.excludeBots) as any,
    orderBys: dimension === "date"
      ? [{ dimension: { dimensionName: "date" } }]
      : [{ metric: { metricName: metric }, desc: true }],
    limit: opts.limit ? (opts.limit as unknown as number) : undefined,
  })
  return (res.rows ?? []).map((r) => ({
    name: r.dimensionValues?.[0]?.value ?? "(none)",
    value: Number(r.metricValues?.[0]?.value ?? 0),
    secondary: opts.secondaryMetric ? Number(r.metricValues?.[1]?.value ?? 0) : undefined,
  }))
}

// Headline metrics fetched as a keyed object so current vs previous can be diffed.
const METRIC_KEYS = [
  "activeUsers", "newUsers", "sessions", "screenPageViews", "averageSessionDuration",
  "engagementRate", "bounceRate", "engagedSessions", "keyEvents", "eventCount",
] as const
export type MetricKey = typeof METRIC_KEYS[number]
export type Totals = Record<MetricKey, number>

async function totalsFor(startDate: string, endDate: string, excludeBots?: boolean): Promise<Totals> {
  const [res] = await client().runReport({
    property: propertyPath(),
    dateRanges: [{ startDate, endDate }],
    metrics: METRIC_KEYS.map((name) => ({ name })),
    dimensionFilter: botFilter(excludeBots) as any,
  })
  const v = res.rows?.[0]?.metricValues ?? []
  const out = {} as Totals
  METRIC_KEYS.forEach((k, i) => { out[k] = Number(v[i]?.value ?? 0) })
  return out
}

// Active users in the last 30 minutes (GA4 realtime). null if unavailable.
export async function realtimeActiveUsers(excludeBots?: boolean): Promise<number | null> {
  try {
    const [res] = await client().runRealtimeReport({
      property: propertyPath(),
      metrics: [{ name: "activeUsers" }],
      dimensionFilter: botFilter(excludeBots) as any,
    })
    return Number(res.rows?.[0]?.metricValues?.[0]?.value ?? 0)
  } catch { return null }
}

export type MarketingReport = Awaited<ReturnType<typeof getMarketingReport>>

export async function getMarketingReport(range: GaRange, excludeBots = false) {
  const days = rangeDays(range)
  const b = excludeBots
  const [current, previous, series, channels, sources, pages, landingPages, events, devices, countries, newReturning] = await Promise.all([
    totalsFor(`${days}daysAgo`, "today", b),
    totalsFor(`${days * 2}daysAgo`, `${days + 1}daysAgo`, b),
    report(range, "date", "activeUsers", { secondaryMetric: "sessions", excludeBots: b }),
    report(range, "sessionDefaultChannelGroup", "sessions", { secondaryMetric: "activeUsers", excludeBots: b }),
    report(range, "sessionSourceMedium", "sessions", { limit: 12, excludeBots: b }),
    report(range, "pageTitle", "screenPageViews", { limit: 12, secondaryMetric: "activeUsers", excludeBots: b }),
    report(range, "landingPagePlusQueryString", "sessions", { limit: 12, secondaryMetric: "activeUsers", excludeBots: b }),
    report(range, "eventName", "eventCount", { limit: 12, excludeBots: b }),
    report(range, "deviceCategory", "activeUsers", { excludeBots: b }),
    report(range, "country", "activeUsers", { limit: 12, excludeBots: b }),
    report(range, "newVsReturning", "activeUsers", { excludeBots: b }),
  ])
  const deltas = {} as Record<MetricKey, number | null>
  METRIC_KEYS.forEach((k) => { deltas[k] = previous[k] > 0 ? (current[k] - previous[k]) / previous[k] : null })
  return { summary: current, previous, deltas, series, channels, sources, pages, landingPages, events, devices, countries, newReturning }
}
