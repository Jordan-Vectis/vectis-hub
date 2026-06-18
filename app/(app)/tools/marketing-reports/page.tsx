import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { isGaConfigured, getMarketingReport, rangeDays, type GaRange } from "@/lib/ga"
import MarketingCharts from "./marketing-charts"

export const dynamic = "force-dynamic"
export const metadata = { title: "Marketing Reports" }

const RANGES: { key: GaRange; label: string }[] = [
  { key: "7d",   label: "7 days" },
  { key: "28d",  label: "28 days" },
  { key: "90d",  label: "90 days" },
  { key: "365d", label: "1 year" },
]

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-GB")
}
function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return "—"
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"

export default async function MarketingReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const { range: rangeParam } = await searchParams
  const range: GaRange = (["7d", "28d", "90d", "365d"].includes(rangeParam ?? "") ? rangeParam : "28d") as GaRange

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Marketing Reports</h1>
          <p className="text-base text-gray-500 mt-1">Website analytics for vectis.co.uk, live from Google Analytics.</p>
        </div>
        {isGaConfigured() && (
          <div className="flex gap-1.5 bg-gray-100 dark:bg-[#2C2C2E] rounded-xl p-1">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={`/tools/marketing-reports?range=${r.key}`}
                className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  range === r.key ? "bg-pink-600 text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {!isGaConfigured() ? (
        <SetupCard />
      ) : (
        <ReportBody range={range} />
      )}
    </div>
  )
}

function SetupCard() {
  return (
    <div className={`${card} p-6 max-w-2xl`}>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Connect Google Analytics</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
        This page reads live data from the GA4 property via the Google Analytics Data API. To switch it on, two
        environment variables need setting on Railway:
      </p>
      <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-2 mb-4">
        <li><code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">GA4_PROPERTY_ID</code> — the numeric property id (GA4 Admin → Property Settings).</li>
        <li><code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">GA_SERVICE_ACCOUNT_JSON</code> — the full service-account key JSON, as one line.</li>
      </ul>
      <ol className="text-sm text-gray-600 dark:text-gray-300 space-y-1.5 list-decimal pl-5">
        <li>In Google Cloud, create a service account and enable the <strong>Google Analytics Data API</strong>.</li>
        <li>Add the service account&apos;s email as a <strong>Viewer</strong> on the GA4 property (Admin → Property Access Management).</li>
        <li>Create a JSON key for it and paste it into <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">GA_SERVICE_ACCOUNT_JSON</code>.</li>
        <li>Set <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">GA4_PROPERTY_ID</code>, then redeploy.</li>
      </ol>
    </div>
  )
}

async function ReportBody({ range }: { range: GaRange }) {
  let data: Awaited<ReturnType<typeof getMarketingReport>> | null = null
  let error: string | null = null
  try {
    data = await getMarketingReport(range)
  } catch (e: any) {
    error = e?.message ?? "Failed to load analytics"
  }

  if (error || !data) {
    return (
      <div className={`${card} p-6`}>
        <p className="text-base text-red-600 dark:text-red-400 font-semibold mb-1">Couldn&apos;t load Google Analytics</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 break-words">{error}</p>
        <p className="text-sm text-gray-400 mt-2">Check the property id and that the service account has Viewer access to the property.</p>
      </div>
    )
  }

  const s = data.summary
  const stats = [
    { label: "Active users",   value: fmtNum(s.activeUsers) },
    { label: "New users",      value: fmtNum(s.newUsers) },
    { label: "Sessions",       value: fmtNum(s.sessions) },
    { label: "Page views",     value: fmtNum(s.pageViews) },
    { label: "Avg session",    value: fmtDuration(s.avgSessionDuration) },
    { label: "Engagement",     value: fmtPct(s.engagementRate) },
    { label: "Key events",     value: fmtNum(s.keyEvents) },
  ]

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-400 -mt-2">Last {rangeDays(range)} days</p>

      {/* Headline stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {stats.map((st) => (
          <div key={st.label} className={`${card} p-4`}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{st.label}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{st.value}</p>
          </div>
        ))}
      </div>

      <MarketingCharts data={data} />
    </div>
  )
}
