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

// Totals (no dimension) for the headline stat cards.
async function totals(range: GaRange) {
  const [res] = await client().runReport({
    property: propertyPath(),
    dateRanges: [{ startDate: `${rangeDays(range)}daysAgo`, endDate: "today" }],
    metrics: [
      { name: "activeUsers" }, { name: "newUsers" }, { name: "sessions" },
      { name: "screenPageViews" }, { name: "averageSessionDuration" },
      { name: "engagementRate" }, { name: "keyEvents" }, { name: "eventCount" },
    ],
  })
  const v = res.rows?.[0]?.metricValues ?? []
  const num = (i: number) => Number(v[i]?.value ?? 0)
  return {
    activeUsers: num(0), newUsers: num(1), sessions: num(2), pageViews: num(3),
    avgSessionDuration: num(4), engagementRate: num(5), keyEvents: num(6), eventCount: num(7),
  }
}

export type MarketingReport = Awaited<ReturnType<typeof getMarketingReport>>

export async function getMarketingReport(range: GaRange) {
  const [summary, series, channels, sources, pages, devices, countries, newReturning] = await Promise.all([
    totals(range),
    report(range, "date", "activeUsers", { secondaryMetric: "sessions" }),
    report(range, "sessionDefaultChannelGroup", "sessions", { secondaryMetric: "activeUsers" }),
    report(range, "sessionSourceMedium", "sessions", { limit: 12 }),
    report(range, "pageTitle", "screenPageViews", { limit: 12, secondaryMetric: "activeUsers" }),
    report(range, "deviceCategory", "activeUsers"),
    report(range, "country", "activeUsers", { limit: 12 }),
    report(range, "newVsReturning", "activeUsers"),
  ])
  return { summary, series, channels, sources, pages, devices, countries, newReturning }
}
