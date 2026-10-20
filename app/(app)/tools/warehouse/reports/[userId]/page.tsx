import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { parseRange, personActivity, personOnRecord, warehouseReport, type ActivityItem, type PersonDay, type PersonTotals, type ReportSource } from "@/lib/goods-in/reports"
import { Empty, ErrorBox, PageHeader, box, mono, td, th } from "../../_components/ui"
import { londonYmd } from "../../history/london-days"
import { DailyChart, ExportButtons } from "../charts"
import { dayPoints } from "../day-points"
import { Definitions, HourStrip, MissingNote, REPORTS_PATH, RangeBar, SectionTitle, Tiles, WiderRangeLink, dayLong, dayShort, hourSpan, isOneDay, londonTime, num, oneParam, plural, rangeQuery, rangeWords } from "../parts"

// Goods In → Reports → one person: their figures for the days picked, a line and a bar per day,
// when in the day they work, and the latest things they did (codes open Find or the receipt).
//
// ⚠ Who may open whose page is decided HERE, before anything about the person is read: a Warehouse
// manager or admin may open anyone's; a warehouse-tier person only their own — anyone else's id is
// refused without saying whose it is, or whether it exists. Read-only (nothing is written, not even
// an Access Log row), and nothing touches Business Central.

export const dynamic = "force-dynamic"
export const metadata = { title: "Goods In — Reports" }

type Params = Promise<{ userId: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** The activity list shows the latest 60; "Show the latest 500" (?list=500) asks for personActivity's most. */
const ACTIVITY_LIMIT = 60
const ACTIVITY_MAX = 500

const cleanId = (raw: string) => {
  let s = raw
  try { s = decodeURIComponent(raw) } catch { /* already decoded */ }
  return s.trim().slice(0, 64)
}

const errText = (e: unknown, max: number) => String((e as { message?: string })?.message ?? e).slice(0, max)

export default async function GoodsInPersonReportPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ userId: rawId }, sp] = await Promise.all([params, searchParams])
  const userId = cleanId(rawId)
  const user = await getGoodsInUser()
  if (!user) redirect("/hub") // the section's layout has already turned them away and logged it
  const seesEveryone = atLeast(user, "manager")
  const range = parseRange({ range: oneParam(sp.range), from: oneParam(sp.from), to: oneParam(sp.to) })
  const backHref = `${REPORTS_PATH}?${rangeQuery(range)}`

  if (!seesEveryone && userId !== user.id) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <PageHeader title="Reports" back={{ href: backHref, label: "Reports" }} />
        <div className={`${box} px-5 py-6 text-sm text-gray-700 dark:text-gray-200 max-w-2xl`}>
          <p className="font-semibold mb-1">You can see your own figures only</p>
          <p className="text-gray-600 dark:text-gray-300">Warehouse managers and admins can see everyone&apos;s.</p>
          <Link href={`${REPORTS_PATH}/${encodeURIComponent(user.id)}?${rangeQuery(range)}`} className="mt-3 inline-flex items-center min-h-11 underline text-indigo-700 dark:text-indigo-300">
            Open your own figures
          </Link>
        </div>
      </div>
    )
  }

  const limit = oneParam(sp.list) === String(ACTIVITY_MAX) ? ACTIVITY_MAX : ACTIVITY_LIMIT

  // ⚠ Every throw is an ERROR, shown and logged — a missing table never throws (it comes back in
  // `missing`, the amber Run Migrations note), so nothing here is read as "not set up yet".
  let person: PersonTotals | undefined
  let days: PersonDay[] = []
  let hours: { hour: number; count: number }[] = []
  let activity: ActivityItem[] = []
  let shown = range
  let missing: ReportSource[] | undefined
  let error: string | null = null
  let activityError: string | null = null
  try {
    const [report, act] = await Promise.all([
      warehouseReport(range, userId),
      // The list is a nicety beside the figures: if it fails, the figures still show. A
      // warehouse-tier viewer never sees anyone else's name in it (an overtaken scan's message
      // names whoever moved the item since).
      personActivity(userId, range, limit, { hideOtherNames: !seesEveryone }).then(
        items => ({ items, error: null as string | null }),
        (e: unknown) => {
          console.error("goods-in person activity error:", e)
          return { items: [] as ActivityItem[], error: errText(e, 200) }
        },
      ),
    ])
    shown = report.range
    missing = report.missing
    person = report.people.find(p => p.userId === userId)
    days = report.days.filter(d => d.userId === userId)
    hours = report.hours.filter(h => h.userId === userId)
    activity = act.items
    activityError = act.error
  } catch (e) {
    console.error("goods-in person report error:", e)
    error = errText(e, 300)
  }

  // Their name: as stored on what they did in the range, else their Hub account, else as stored on
  // anything they ever did in Goods In (a former member of staff whose account has gone). Only an id
  // that is NONE of those is a 404 — and only when every read worked: a read that failed falls back
  // to "This person" rather than calling a real person's page "doesn't exist".
  let name = person?.name ?? null
  if (!name) {
    let row: { name: string | null; email: string | null } | null = null
    let unsure = !!error
    try {
      row = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
    } catch (e) {
      console.error("goods-in person report: couldn't read the user:", e)
      unsure = true
    }
    if (!row && !unsure) {
      let onRecord: { name: string | null } | null = null
      try {
        onRecord = await personOnRecord(userId)
      } catch (e) {
        console.error("goods-in person report: couldn't check for past activity:", e)
        unsure = true
      }
      if (!onRecord && !unsure) notFound()
      name = onRecord?.name ?? null
    }
    name = name || row?.name || row?.email || (userId === user.id ? user.name : null) || "This person"
  }

  const oneDay = isOneDay(shown)
  const own = userId === user.id
  const path = `${REPORTS_PATH}/${encodeURIComponent(userId)}`
  const p = person

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={own && !seesEveryone ? "Your figures" : name}
        back={{ href: backHref, label: seesEveryone ? "All warehouse reports" : "Reports" }}
        intro={own ? "Your moves, handheld scans and check-ins in Goods In, day by day." : `What ${name} has done in Goods In — moves, handheld scans and check-ins, day by day.`}
        actions={p ? <ExportButtons people={[p]} days={days} range={shown} who={name} /> : undefined}
      />

      <div className="space-y-6">
        <RangeBar path={path} range={shown} />

        {error && <ErrorBox>These figures couldn&apos;t be worked out just now: {error}. Try again in a moment, or pick fewer days.</ErrorBox>}
        <MissingNote missing={missing} />

        {!error && !p && (
          <Empty>
            <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Nothing recorded {oneDay ? "on" : "for"} {rangeWords(shown)}</p>
            <p className="max-w-xl mx-auto">
              {own ? "When you" : `When ${name}`} move{own ? "" : "s"} a tote, pallet or lot, scan{own ? "" : "s"} with the handheld scanner or book{own ? "" : "s"} a receipt in, it shows here — the figures for each day, when in the day, and a list of the latest things done.
            </p>
            <WiderRangeLink path={path} range={shown} />
          </Empty>
        )}

        {p && (
          <>
            <Tiles tiles={[
              { label: "Moves", value: num(p.moves), sub: p.bulk ? `${num(p.bulk)} of them in bulk` : "on every screen" },
              { label: "Put away", value: num(p.putAway), sub: "totes and pallets to storage" },
              { label: "To bench", value: num(p.toBench), sub: "totes and pallets to a bench" },
              { label: "Lots shelved", value: num(p.lotsShelved), sub: "single lots moved" },
              { label: "Scans", value: num(p.scans), sub: p.refused || p.stale ? `${num(p.refused)} refused · ${num(p.stale)} overtaken` : "from the handheld scanner" },
              { label: "Check-ins", value: num(p.checkIns), sub: p.checkIns ? `${plural(p.totesBooked, "tote")} · ${plural(p.palletsBooked, "pallet")}` : "receipts booked in" },
              oneDay
                ? { label: "First – last", value: <span className={mono}>{londonTime(p.firstAt)}–<wbr />{londonTime(p.lastAt)}</span>, sub: "UK time" }
                : { label: "Days active", value: num(p.activeDays), sub: "days with anything done" },
              { label: "Busiest hour", value: <span className={mono}>{p.busiestHour == null ? "—" : `${String(p.busiestHour).padStart(2, "0")}:00`}</span>, sub: p.busiestHour == null ? "no times recorded" : hourSpan(p.busiestHour) },
              { label: "Scanners used", value: num(p.scanners), sub: p.late ? `${plural(p.late, "scan")} sent late` : "different handheld scanners" },
              { label: "Refused scans", value: num(p.refused), sub: p.stale ? `and ${num(p.stale)} overtaken` : "turned down by the Hub" },
            ]} />

            {!oneDay && (() => {
              const { points, caption, unit } = dayPoints(days, shown)
              return (
                <section className={`${box} p-4 sm:p-5`} aria-label="Each day">
                  <SectionTitle>Each day</SectionTitle>
                  <DailyChart points={points} caption={caption} unit={unit} />
                </section>
              )
            })()}

            <section aria-label="Day by day">
              <SectionTitle aside={<span className="text-xs text-gray-500 dark:text-gray-400">Newest first. Days with nothing done aren&apos;t listed. Times are UK time.</span>}>
                Day by day — {plural(days.length, "day")}
              </SectionTitle>
              <DayTable days={days} />
            </section>

            <section className={`${box} p-4 sm:p-5`} aria-label="When in the day">
              <SectionTitle>When in the day</SectionTitle>
              <HourStrip hours={hours} empty="No times recorded in these days." />
            </section>
          </>
        )}

        {!error && (p || activity.length > 0) && (
          <section aria-label="Latest activity">
            <SectionTitle aside={activity.length >= limit ? <ListCutOff limit={limit} moreHref={`${path}?${rangeQuery(shown)}&list=${ACTIVITY_MAX}`} historyHref={`/tools/warehouse/history?from=${shown.from}&to=${shown.to}`} /> : undefined}>
              Latest activity
            </SectionTitle>
            {activityError
              ? <ErrorBox>The list of what was done couldn&apos;t be loaded just now: {activityError}</ErrorBox>
              : <ActivityList items={activity} />}
          </section>
        )}

        <Definitions ownOnly={!seesEveryone} />
      </div>
    </div>
  )
}

/** Said when the activity list was cut off: how many are shown, a way to see more, and where the rest is. */
function ListCutOff({ limit, moreHref, historyHref }: { limit: number; moreHref: string; historyHref: string }) {
  const link = "inline-flex items-center min-h-11 underline text-indigo-700 dark:text-indigo-300"
  return (
    <span className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-x-3">
      <span>Showing the latest {num(limit)}.</span>
      {limit < ACTIVITY_MAX && <Link href={moreHref} className={link}>Show the latest {num(ACTIVITY_MAX)}</Link>}
      <Link href={historyHref} className={link}>History lists every move on these days (everyone&apos;s)</Link>
    </span>
  )
}

// ─── Day by day ───────────────────────────────────────────────────────────────────────────

function DayTable({ days }: { days: PersonDay[] }) {
  const rows = [...days].sort((a, b) => b.day.localeCompare(a.day))
  const n = (v: number) => (v ? num(v) : <span className="text-gray-500 dark:text-gray-400">0</span>)
  const r = `${td} text-right tabular-nums whitespace-nowrap`
  const h = `${th} text-right`
  return (
    <div className={`${box} overflow-x-auto overscroll-x-contain`}>
      <table className="w-full">
        <thead className="border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th className={`${th} sticky left-0 bg-white dark:bg-gray-900`}>Day</th>
            <th className={h}>Moves</th>
            <th className={h}>Put away</th>
            <th className={h}>To bench</th>
            <th className={h}>Lots shelved</th>
            <th className={h}>Scans</th>
            <th className={h}>Refused</th>
            <th className={h}>Check-ins</th>
            <th className={h}>Totes</th>
            <th className={h}>Pallets</th>
            <th className={h}>First</th>
            <th className={h}>Last</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(d => (
            <tr key={d.day} className="group hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className={`${td} whitespace-nowrap font-medium sticky left-0 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800`} title={dayLong(d.day)}>{dayShort(d.day)} <span className="text-gray-500 dark:text-gray-400">{d.day.slice(0, 4)}</span></td>
              <td className={`${r} font-semibold`}>{n(d.moves)}</td>
              <td className={r}>{n(d.putAway)}</td>
              <td className={r}>{n(d.toBench)}</td>
              <td className={r}>{n(d.lotsShelved)}</td>
              <td className={`${r} font-semibold`}>{n(d.scans)}</td>
              <td className={r}>{n(d.refused)}</td>
              <td className={`${r} font-semibold`}>{n(d.checkIns)}</td>
              <td className={r}>{n(d.totesBooked)}</td>
              <td className={r}>{n(d.palletsBooked)}</td>
              <td className={`${r} ${mono}`}>{londonTime(d.firstAt)}</td>
              <td className={`${r} ${mono}`}>{londonTime(d.lastAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Latest activity ──────────────────────────────────────────────────────────────────────

const KIND_WORDS: Record<ActivityItem["kind"], string> = { move: "Move", scan: "Scan", "check-in": "Check-in" }

// What happened to a scan, in words (the word is the key — no colour stands alone).
const OUTCOME: Record<string, { label: string; tone: string }> = {
  applied: { label: "Done", tone: "border-emerald-300 text-emerald-800 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:bg-emerald-950/40" },
  already: { label: "Already sent", tone: "border-gray-300 text-gray-700 bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:bg-gray-800" },
  refused: { label: "Refused", tone: "border-amber-300 text-amber-900 bg-amber-50 dark:border-amber-800 dark:text-amber-200 dark:bg-amber-950/40" },
  stale: { label: "Overtaken", tone: "border-amber-300 text-amber-900 bg-amber-50 dark:border-amber-800 dark:text-amber-200 dark:bg-amber-950/40" },
}

function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <Empty>Nothing to list in these days.</Empty>
  // Grouped by London day, newest first (the list arrives newest first).
  const groups: { day: string; items: ActivityItem[] }[] = []
  for (const it of items) {
    const day = londonYmd(new Date(it.at))
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(it)
    else groups.push({ day, items: [it] })
  }
  return (
    <div className={`${box} divide-y divide-gray-100 dark:divide-gray-800`}>
      {groups.map(g => (
        <div key={g.day}>
          <p className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-500 dark:text-gray-400">{dayLong(g.day)}</p>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800/70">
            {g.items.map((it, i) => {
              const outcome = it.outcome ? OUTCOME[it.outcome] ?? { label: it.outcome, tone: OUTCOME.already.tone } : null
              const body = (
                <>
                  <span className={`${mono} text-sm text-gray-500 dark:text-gray-400 w-12 shrink-0 pt-0.5`}>{londonTime(it.at)}</span>
                  <span className="shrink-0 inline-flex items-center rounded border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 w-[4.75rem] justify-center">
                    {KIND_WORDS[it.kind] ?? it.kind}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 dark:text-white break-words">
                      <span className={`font-semibold ${it.href ? "text-indigo-700 dark:text-indigo-300 group-hover:underline" : ""}`}>{it.title}</span>
                      {outcome && <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium align-middle ${outcome.tone}`}>{outcome.label}</span>}
                    </p>
                    {it.detail && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 break-words">{it.detail}</p>}
                  </div>
                </>
              )
              const row = "px-4 py-2.5 min-h-11 flex items-start gap-3"
              return (
                <li key={`${it.at}-${i}`}>
                  {/* The whole row is the tap target (≥ 44px) when it opens Find or the receipt. */}
                  {it.href
                    ? <Link href={it.href} className={`${row} group hover:bg-gray-50 dark:hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-indigo-500`}>{body}</Link>
                    : <div className={row}>{body}</div>}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
