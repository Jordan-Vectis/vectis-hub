import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { isGaConfigured, getMarketingReport, realtimeActiveUsers, rangeDays, SECTION_CATALOG, DEFAULT_SECTION_IDS, type GaRange, type MetricKey } from "@/lib/ga"
import MarketingCharts from "./marketing-charts"
import InfoTip from "./info-tip"
import LayoutBar from "./layout-bar"

const BOT_TIP = "When on, hides traffic from countries that are mostly automated bots/scrapers (currently China, Hong Kong, Taiwan, Singapore, India, Vietnam, Indonesia, Philippines, Thailand, Pakistan and Bangladesh) so the figures better reflect real visitors. Japan and Korea are deliberately kept in (likely genuine collectors). Ask IT to adjust the list if needed."
const UK_TIP = "When on, shows only visitors based in the United Kingdom — every figure and report on the page is restricted to UK traffic. This is stricter than 'Hide bot traffic' (it already excludes everywhere else), so you don't need both on at once."

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

const STATS: { key: MetricKey; label: string; fmt: (n: number) => string; higherBetter: boolean; help: string }[] = [
  { key: "activeUsers",            label: "Active users",     fmt: fmtNum,      higherBetter: true,  help: "The number of different people who visited the site in this period. Someone who comes back several times is still counted once." },
  { key: "newUsers",               label: "New users",        fmt: fmtNum,      higherBetter: true,  help: "People visiting for the first time — Google has no record of them before now." },
  { key: "sessions",               label: "Sessions",         fmt: fmtNum,      higherBetter: true,  help: "Individual visits. One person can have several sessions if they come back. A session ends after 30 minutes of inactivity." },
  { key: "screenPageViews",        label: "Page views",       fmt: fmtNum,      higherBetter: true,  help: "The total number of pages viewed across all visits." },
  { key: "averageSessionDuration", label: "Avg session",      fmt: fmtDuration, higherBetter: true,  help: "How long the average visit lasts." },
  { key: "engagementRate",         label: "Engagement",       fmt: fmtPct,      higherBetter: true,  help: "The share of visits where someone actually did something — stayed over 10 seconds, viewed more than one page, or triggered a key event — rather than leaving immediately. Higher is better." },
  { key: "bounceRate",             label: "Bounce rate",      fmt: fmtPct,      higherBetter: false, help: "The opposite of engagement — the share of visits where someone left almost straight away without doing anything. Lower is better." },
  { key: "engagedSessions",        label: "Engaged sessions", fmt: fmtNum,      higherBetter: true,  help: "The count of visits that were 'engaged' (lasted over 10 seconds, had a key event, or viewed 2+ pages)." },
  { key: "keyEvents",              label: "Key events",       fmt: fmtNum,      higherBetter: true,  help: "Important actions you've told Google to track — e.g. a contact form sent or a phone-number click. Google used to call these 'conversions'." },
]

function Delta({ pct, higherBetter }: { pct: number | null; higherBetter: boolean }) {
  if (pct === null || !isFinite(pct)) return null
  const up = pct >= 0
  const good = up === higherBetter
  return (
    <span className={`text-xs font-semibold ${good ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
      {up ? "↑" : "↓"} {Math.abs(pct * 100).toFixed(1)}%
    </span>
  )
}

export default async function MarketingReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; bots?: string; uk?: string; fav?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  const isAdmin = session.user.role === "ADMIN"

  const sp = await searchParams
  const range: GaRange = (["7d", "28d", "90d", "365d"].includes(sp.range ?? "") ? sp.range : "28d") as GaRange
  const excludeBots = sp.bots === "hide"
  const ukOnly = sp.uk === "1"
  const favOnly = sp.fav === "1"
  const linkFor = (opts: { range?: GaRange; bots?: boolean; uk?: boolean; fav?: boolean }) => {
    const r = opts.range ?? range
    const b = opts.bots ?? excludeBots
    const u = opts.uk ?? ukOnly
    const f = opts.fav ?? favOnly
    const parts = [`range=${r}`]
    if (b) parts.push("bots=hide")
    if (u) parts.push("uk=1")
    if (f) parts.push("fav=1")
    return `/tools/marketing-reports?${parts.join("&")}`
  }

  // Saved shared layouts. The one shown = the user's picked layout (mr_layout
  // cookie) → the default → the first → the hardcoded fallback set.
  const dbLayouts = await prisma.marketingLayout.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] })
  const layouts = dbLayouts.map((l) => ({ id: l.id, name: l.name, sections: l.sections, isDefault: l.isDefault }))
  const validIds = new Set(SECTION_CATALOG.map((s) => s.id))
  const cookieLayoutId = (await cookies()).get("mr_layout")?.value
  const activeLayout = layouts.find((l) => l.id === cookieLayoutId) ?? layouts.find((l) => l.isDefault) ?? layouts[0] ?? null
  const selectedSections = activeLayout ? activeLayout.sections.filter((id) => validIds.has(id)) : DEFAULT_SECTION_IDS

  // Shared favourites — starred sections are pinned to the top for everyone, and
  // always shown even if not in the active layout. The "favourites only" toggle
  // shows just these. Ordered by catalog position for stability.
  const dbFavourites = await prisma.marketingFavourite.findMany()
  const favSet = new Set(dbFavourites.map((f) => f.sectionId).filter((id) => validIds.has(id)))
  const favouriteIds = SECTION_CATALOG.map((s) => s.id).filter((id) => favSet.has(id))
  const restSections = selectedSections.filter((id) => !favSet.has(id))
  const sectionsToShow = favOnly ? favouriteIds : [...favouriteIds, ...restSections]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Marketing Reports</h1>
          <p className="text-base text-gray-500 mt-1">Website analytics for vectis.co.uk, live from Google Analytics.</p>
        </div>
        {isGaConfigured() && (
          <div className="flex items-center gap-2 flex-wrap">
            <LayoutBar
              layouts={layouts}
              activeId={activeLayout?.id ?? null}
              catalog={SECTION_CATALOG.map((s) => ({ id: s.id, title: s.title }))}
              isAdmin={isAdmin}
            />
            <Link
              href={linkFor({ fav: !favOnly })}
              className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                favOnly
                  ? "bg-pink-600 border-pink-600 text-white"
                  : "bg-gray-100 dark:bg-[#2C2C2E] border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
              title="Show only the favourited reports"
            >
              {favOnly ? "★ Favourites only" : "☆ Favourites only"}
            </Link>
            <Link
              href={linkFor({ uk: !ukOnly })}
              className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                ukOnly
                  ? "bg-pink-600 border-pink-600 text-white"
                  : "bg-gray-100 dark:bg-[#2C2C2E] border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {ukOnly ? "✓ UK only" : "🇬🇧 UK only"}
            </Link>
            <InfoTip text={UK_TIP} />
            <Link
              href={linkFor({ bots: !excludeBots })}
              className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                excludeBots
                  ? "bg-pink-600 border-pink-600 text-white"
                  : "bg-gray-100 dark:bg-[#2C2C2E] border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {excludeBots ? "✓ Bot traffic hidden" : "Hide bot traffic"}
            </Link>
            <InfoTip text={BOT_TIP} />
            <div className="flex gap-1.5 bg-gray-100 dark:bg-[#2C2C2E] rounded-xl p-1 ml-1">
              {RANGES.map((r) => (
                <Link
                  key={r.key}
                  href={linkFor({ range: r.key })}
                  className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    range === r.key ? "bg-pink-600 text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {r.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {!isGaConfigured() ? (
        <SetupCard />
      ) : (
        <ReportBody
          range={range}
          excludeBots={excludeBots}
          ukOnly={ukOnly}
          sections={sectionsToShow}
          favouriteIds={favouriteIds}
          favOnly={favOnly}
          canEditFavourites={isAdmin}
        />
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

async function ReportBody({ range, excludeBots, ukOnly, sections, favouriteIds, favOnly, canEditFavourites }: { range: GaRange; excludeBots: boolean; ukOnly: boolean; sections: string[]; favouriteIds: string[]; favOnly: boolean; canEditFavourites: boolean }) {
  let data: Awaited<ReturnType<typeof getMarketingReport>> | null = null
  let realtime: number | null = null
  let error: string | null = null
  try {
    [data, realtime] = await Promise.all([getMarketingReport(range, excludeBots, sections, ukOnly), realtimeActiveUsers(excludeBots, ukOnly)])
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap -mt-2">
        <p className="text-sm text-gray-400">Last {rangeDays(range)} days <span className="text-gray-500">· change vs the previous {rangeDays(range)} days</span></p>
        {realtime !== null && (
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            {fmtNum(realtime)} active right now
          </div>
        )}
      </div>

      {/* Headline stats with change vs previous period */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STATS.map((st) => (
          <div key={st.key} className={`${card} p-4`}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{st.label}<InfoTip text={st.help} /></p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{st.fmt(data!.summary[st.key])}</p>
            <div className="mt-1"><Delta pct={data!.deltas[st.key]} higherBetter={st.higherBetter} /></div>
          </div>
        ))}
      </div>

      <MarketingCharts data={data} favouriteIds={favouriteIds} favOnly={favOnly} canEditFavourites={canEditFavourites} />
    </div>
  )
}
