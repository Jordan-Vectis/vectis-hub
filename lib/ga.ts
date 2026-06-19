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

// Build a GA4 dimensionFilter combining a country filter (UK-only, or the
// bot-country exclusion) and an optional eventName match. Returns undefined when
// nothing applies. UK-only takes precedence over the bot exclusion (it's stricter).
function buildFilter(excludeBots?: boolean, eventName?: string, ukOnly?: boolean) {
  const exprs: any[] = []
  if (ukOnly) exprs.push({ filter: { fieldName: "countryId", stringFilter: { value: "GB" } } })
  else if (excludeBots) exprs.push({ notExpression: { filter: { fieldName: "countryId", inListFilter: { values: BOT_COUNTRY_IDS } } } })
  if (eventName) exprs.push({ filter: { fieldName: "eventName", stringFilter: { value: eventName } } })
  if (exprs.length === 0) return undefined
  if (exprs.length === 1) return exprs[0]
  return { andGroup: { expressions: exprs } }
}

type Row = { name: string; value: number; secondary?: number }

// Run a single GA4 report and shape the rows as { name, value }.
async function report(
  range: GaRange,
  dimension: string,
  metric: string,
  opts: { limit?: number; secondaryMetric?: string; excludeBots?: boolean; eventName?: string; ukOnly?: boolean } = {},
): Promise<Row[]> {
  const [res] = await client().runReport({
    property: propertyPath(),
    dateRanges: [{ startDate: `${rangeDays(range)}daysAgo`, endDate: "today" }],
    dimensions: [{ name: dimension }],
    metrics: [{ name: metric }, ...(opts.secondaryMetric ? [{ name: opts.secondaryMetric }] : [])],
    dimensionFilter: buildFilter(opts.excludeBots, opts.eventName, opts.ukOnly) as any,
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

async function totalsFor(startDate: string, endDate: string, excludeBots?: boolean, ukOnly?: boolean): Promise<Totals> {
  const [res] = await client().runReport({
    property: propertyPath(),
    dateRanges: [{ startDate, endDate }],
    metrics: METRIC_KEYS.map((name) => ({ name })),
    dimensionFilter: buildFilter(excludeBots, undefined, ukOnly) as any,
  })
  const v = res.rows?.[0]?.metricValues ?? []
  const out = {} as Totals
  METRIC_KEYS.forEach((k, i) => { out[k] = Number(v[i]?.value ?? 0) })
  return out
}

// Active users in the last 30 minutes (GA4 realtime). null if unavailable.
export async function realtimeActiveUsers(excludeBots?: boolean, ukOnly?: boolean): Promise<number | null> {
  try {
    const [res] = await client().runRealtimeReport({
      property: propertyPath(),
      metrics: [{ name: "activeUsers" }],
      dimensionFilter: buildFilter(excludeBots, undefined, ukOnly) as any,
    })
    return Number(res.rows?.[0]?.metricValues?.[0]?.value ?? 0)
  } catch { return null }
}

// ─── Report-section catalog ──────────────────────────────────────────────────
// Each entry is one selectable report card. Add to this list to offer more.
export type SectionKind = "bars" | "donut"
export type SectionDef = {
  id: string
  title: string
  kind: SectionKind
  dimension: string
  metric: string
  secondaryMetric?: string
  limit?: number
  suffix?: string
  eventName?: string  // when set, the report is filtered to this GA event
  help: string
}

export const SECTION_CATALOG: SectionDef[] = [
  { id: "channels",     title: "Traffic by channel", kind: "bars",  dimension: "sessionDefaultChannelGroup", metric: "sessions",        secondaryMetric: "activeUsers", suffix: "sessions", help: "Where visits came from, grouped into broad buckets. Direct = typed your web address or used a bookmark. Organic Search = an unpaid Google/Bing result. Paid Search = a paid Google ad. Organic/Paid Social = social media, unpaid or paid. Referral = a link on another website. Email = from an email." },
  { id: "sources",      title: "Top sources",        kind: "bars",  dimension: "sessionSourceMedium",        metric: "sessions",        limit: 12, suffix: "sessions", help: "The exact source and medium each visit came from, e.g. 'google / organic' (unpaid Google) or 'facebook / cpc' (a paid Facebook click)." },
  { id: "referrers",    title: "Referring sites",    kind: "bars",  dimension: "pageReferrer",               metric: "sessions",        limit: 12, suffix: "sessions", help: "The other websites that linked visitors to you (the full referring page)." },
  { id: "pages",        title: "Top pages",          kind: "bars",  dimension: "pageTitle",                  metric: "screenPageViews", limit: 12, secondaryMetric: "activeUsers", suffix: "views", help: "The pages (by their title) that were viewed the most." },
  { id: "pagePaths",    title: "Top page URLs",      kind: "bars",  dimension: "pagePath",                   metric: "screenPageViews", limit: 12, suffix: "views", help: "The most-viewed pages by their web address (URL), rather than title." },
  { id: "landingPages", title: "Top landing pages",  kind: "bars",  dimension: "landingPagePlusQueryString", metric: "sessions",        limit: 12, secondaryMetric: "activeUsers", suffix: "sessions", help: "The first page people arrived on — where their visit began. Good for seeing which pages pull people in." },
  { id: "events",       title: "Events",             kind: "bars",  dimension: "eventName",                  metric: "eventCount",      limit: 12, suffix: "count", help: "Things visitors did on the site. Google automatically tracks page views, scrolls, clicks and similar; this counts how often each happened." },
  { id: "keyEvents",    title: "Key events",         kind: "bars",  dimension: "eventName",                  metric: "keyEvents",       limit: 12, suffix: "count", help: "Your important tracked actions (key events, formerly 'conversions') broken down by which one fired." },
  { id: "regByChannel", title: "Registrations by channel", kind: "bars", dimension: "sessionDefaultChannelGroup", metric: "eventCount", eventName: "register", limit: 12, suffix: "registrations", help: "Where the people who completed your 'register' event came from, grouped into channel buckets (Direct, Organic Search, Paid Social, Referral, etc.). Counts the 'register' event by the channel of the visit it happened in." },
  { id: "regBySource",  title: "Registrations by source",  kind: "bars", dimension: "sessionSourceMedium",        metric: "eventCount", eventName: "register", limit: 12, suffix: "registrations", help: "The exact source/medium that drove each registration, e.g. 'google / organic' or 'facebook / cpc'. Counts the 'register' event by where the visit came from." },
  { id: "siteSearch",   title: "Site search terms",  kind: "bars",  dimension: "searchTerm",                 metric: "eventCount",      limit: 15, suffix: "searches", help: "What people typed into the search box on the site. Only shows data if site-search tracking is set up in GA." },
  { id: "countries",    title: "Top countries",      kind: "bars",  dimension: "country",                    metric: "activeUsers",     limit: 12, suffix: "users", help: "Which countries your visitors are in. Heavy far-away traffic is often bots — use the 'Hide bot traffic' toggle." },
  { id: "regions",      title: "Top regions",        kind: "bars",  dimension: "region",                     metric: "activeUsers",     limit: 12, suffix: "users", help: "Which regions/counties your visitors are in." },
  { id: "cities",       title: "Top cities",         kind: "bars",  dimension: "city",                       metric: "activeUsers",     limit: 12, suffix: "users", help: "Which towns/cities your visitors are in." },
  { id: "languages",    title: "Languages",          kind: "bars",  dimension: "language",                   metric: "activeUsers",     limit: 10, suffix: "users", help: "The language setting of visitors' browsers." },
  { id: "devices",      title: "Devices",            kind: "donut", dimension: "deviceCategory",             metric: "activeUsers",     help: "The split between desktop computers, mobiles and tablets." },
  { id: "browsers",     title: "Browsers",           kind: "bars",  dimension: "browser",                    metric: "activeUsers",     limit: 10, suffix: "users", help: "Which web browsers visitors use (Chrome, Safari, etc.)." },
  { id: "os",           title: "Operating systems",  kind: "bars",  dimension: "operatingSystem",            metric: "activeUsers",     limit: 10, suffix: "users", help: "Which operating systems visitors use (Windows, iOS, Android, etc.)." },
  { id: "screens",      title: "Screen sizes",       kind: "bars",  dimension: "screenResolution",           metric: "activeUsers",     limit: 10, suffix: "users", help: "Common screen resolutions — useful for checking the site looks right on popular sizes." },
  { id: "newReturning", title: "New vs returning",   kind: "donut", dimension: "newVsReturning",             metric: "activeUsers",     help: "First-time visitors versus people who have visited before." },
  { id: "hour",         title: "Busiest hours",      kind: "bars",  dimension: "hour",                       metric: "activeUsers",     limit: 24, suffix: "users", help: "Which hours of the day are busiest (24-hour clock). Useful for timing emails and posts." },
  { id: "dayOfWeek",    title: "Busiest days",       kind: "bars",  dimension: "dayOfWeekName",              metric: "sessions",        limit: 7,  suffix: "sessions", help: "Which days of the week are busiest." },
]

export const DEFAULT_SECTION_IDS = ["channels", "sources", "regByChannel", "regBySource", "siteSearch", "pages", "landingPages", "events", "countries", "devices", "newReturning"]

// Run async work in capped-concurrency batches (GA4 allows ~10 concurrent requests).
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)))
  }
  return out
}

export type ReportSection = SectionDef & { rows: Row[] }
export type MarketingReport = Awaited<ReturnType<typeof getMarketingReport>>

export async function getMarketingReport(range: GaRange, excludeBots = false, sectionIds: string[] = DEFAULT_SECTION_IDS, ukOnly = false) {
  const days = rangeDays(range)
  const b = excludeBots
  const [current, previous, series] = await Promise.all([
    totalsFor(`${days}daysAgo`, "today", b, ukOnly),
    totalsFor(`${days * 2}daysAgo`, `${days + 1}daysAgo`, b, ukOnly),
    report(range, "date", "activeUsers", { secondaryMetric: "sessions", excludeBots: b, ukOnly }),
  ])

  const defs = sectionIds.map((id) => SECTION_CATALOG.find((s) => s.id === id)).filter(Boolean) as SectionDef[]
  const sections: ReportSection[] = await mapLimit(defs, 6, async (def) => ({
    ...def,
    rows: await report(range, def.dimension, def.metric, { secondaryMetric: def.secondaryMetric, limit: def.limit, excludeBots: b, eventName: def.eventName, ukOnly }),
  }))

  const deltas = {} as Record<MetricKey, number | null>
  METRIC_KEYS.forEach((k) => { deltas[k] = previous[k] > 0 ? (current[k] - previous[k]) / previous[k] : null })
  return { summary: current, previous, deltas, series, sections }
}
