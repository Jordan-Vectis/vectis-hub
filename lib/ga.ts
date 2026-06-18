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

type Row = { name: string; value: number; secondary?: number }

// Run a single GA4 report and shape the rows as { name, value }.
async function report(
  range: GaRange,
  dimension: string,
  metric: string,
  opts: { limit?: number; secondaryMetric?: string } = {},
): Promise<Row[]> {
  const [res] = await client().runReport({
    property: propertyPath(),
    dateRanges: [{ startDate: `${rangeDays(range)}daysAgo`, endDate: "today" }],
    dimensions: [{ name: dimension }],
    metrics: [{ name: metric }, ...(opts.secondaryMetric ? [{ name: opts.secondaryMetric }] : [])],
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

async function totalsFor(startDate: string, endDate: string): Promise<Totals> {
  const [res] = await client().runReport({
    property: propertyPath(),
    dateRanges: [{ startDate, endDate }],
    metrics: METRIC_KEYS.map((name) => ({ name })),
  })
  const v = res.rows?.[0]?.metricValues ?? []
  const out = {} as Totals
  METRIC_KEYS.forEach((k, i) => { out[k] = Number(v[i]?.value ?? 0) })
  return out
}

// Active users in the last 30 minutes (GA4 realtime). null if unavailable.
export async function realtimeActiveUsers(): Promise<number | null> {
  try {
    const [res] = await client().runRealtimeReport({ property: propertyPath(), metrics: [{ name: "activeUsers" }] })
    return Number(res.rows?.[0]?.metricValues?.[0]?.value ?? 0)
  } catch { return null }
}

export type MarketingReport = Awaited<ReturnType<typeof getMarketingReport>>

export async function getMarketingReport(range: GaRange) {
  const days = rangeDays(range)
  const [current, previous, series, channels, sources, pages, landingPages, events, devices, countries, newReturning] = await Promise.all([
    totalsFor(`${days}daysAgo`, "today"),
    totalsFor(`${days * 2}daysAgo`, `${days + 1}daysAgo`),
    report(range, "date", "activeUsers", { secondaryMetric: "sessions" }),
    report(range, "sessionDefaultChannelGroup", "sessions", { secondaryMetric: "activeUsers" }),
    report(range, "sessionSourceMedium", "sessions", { limit: 12 }),
    report(range, "pageTitle", "screenPageViews", { limit: 12, secondaryMetric: "activeUsers" }),
    report(range, "landingPagePlusQueryString", "sessions", { limit: 12, secondaryMetric: "activeUsers" }),
    report(range, "eventName", "eventCount", { limit: 12 }),
    report(range, "deviceCategory", "activeUsers"),
    report(range, "country", "activeUsers", { limit: 12 }),
    report(range, "newVsReturning", "activeUsers"),
  ])
  const deltas = {} as Record<MetricKey, number | null>
  METRIC_KEYS.forEach((k) => { deltas[k] = previous[k] > 0 ? (current[k] - previous[k]) / previous[k] : null })
  return { summary: current, previous, deltas, series, channels, sources, pages, landingPages, events, devices, countries, newReturning }
}
