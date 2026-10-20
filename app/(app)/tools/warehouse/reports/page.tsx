import { redirect } from "next/navigation"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { parseRange, warehouseReport, type WarehouseReport } from "@/lib/goods-in/reports"
import { Empty, ErrorBox, PageHeader, box } from "../_components/ui"
import { DailyChart, ExportButtons, PersonBars } from "./charts"
import { dayPoints } from "./day-points"
import PeopleTable from "./people-table"
import { Definitions, HourStrip, MissingNote, REPORTS_PATH, RangeBar, SectionTitle, Tiles, WiderRangeLink, isOneDay, num, oneParam, personHref, plural, rangeWords } from "./parts"

// Goods In → Reports: what each warehouse person did, per day — moves, handheld scans and
// check-ins, counted from what Goods In already records (lib/goods-in/reports.ts does the
// counting, in grouped SQL, on London days). Read-only: nothing here writes anything, and nothing
// reads or writes Business Central.
//
// Who sees what — decided HERE on the server, never just hidden on the screen: a Warehouse manager
// or admin sees everyone; a warehouse-tier person sees only their own figures (the report itself is
// asked for them alone, so no one else's name ever reaches the page).

export const dynamic = "force-dynamic"
export const metadata = { title: "Goods In — Reports" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function GoodsInReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const user = await getGoodsInUser()
  if (!user) redirect("/hub") // the section's layout has already turned them away and logged it
  const seesEveryone = atLeast(user, "manager")
  const range = parseRange({ range: oneParam(sp.range), from: oneParam(sp.from), to: oneParam(sp.to) })

  // ⚠ Every throw is an ERROR, shown and logged. A missing table never throws — warehouseReport
  // checks first and names it in `missing` (the amber Run Migrations note) — so a "does not exist"
  // here is a real fault (an operator, a function, a type), never "not set up yet".
  let report: WarehouseReport | null = null
  let error: string | null = null
  try {
    report = await warehouseReport(range, seesEveryone ? undefined : user.id)
  } catch (e) {
    console.error("goods-in reports error:", e)
    error = String((e as { message?: string })?.message ?? e).slice(0, 300)
  }

  // Belt and braces: a warehouse-tier person's report is asked for them alone, and is filtered to
  // them again here, so nobody else's figures or name can reach their screen.
  if (report && !seesEveryone) {
    report = {
      ...report,
      people: report.people.filter(p => p.userId === user.id),
      days: report.days.filter(d => d.userId === user.id),
      hours: report.hours.filter(h => h.userId === user.id),
    }
  }

  const shown = report?.range ?? range
  const oneDay = isOneDay(shown)
  const hrefs = Object.fromEntries((report?.people ?? []).map(p => [p.userId, personHref(p.userId, shown)]))
  const me = report?.people.find(p => p.userId === user.id)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Reports"
        intro={seesEveryone
          ? "What each person in the warehouse is doing — moves, handheld scans and check-ins, per person and per day."
          : "What you've done in the warehouse — your moves, handheld scans and check-ins, per day. You see your own figures only."}
        actions={report && (report.people.length > 0 || report.days.length > 0)
          ? <ExportButtons people={report.people} days={report.days} range={shown} />
          : undefined}
      />

      <div className="space-y-6">
        <RangeBar path={REPORTS_PATH} range={shown} />

        {error && <ErrorBox>The report couldn&apos;t be worked out just now: {error}. Try again in a moment, or pick fewer days.</ErrorBox>}
        <MissingNote missing={report?.missing} />

        {report && report.people.length === 0 && (
          <Empty>
            <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Nothing recorded {oneDay ? "on" : "for"} {rangeWords(shown)}</p>
            <p className="max-w-xl mx-auto">
              {seesEveryone
                ? "As soon as anyone moves a tote, pallet or lot, scans with the handheld scanner or books a receipt in, their figures appear here — a line for each person, a chart of each day and when in the day the work was done."
                : "As soon as you move a tote, pallet or lot, scan with the handheld scanner or book a receipt in, your figures appear here — per day, and when in the day you did them."}
            </p>
            <WiderRangeLink path={REPORTS_PATH} range={shown} />
          </Empty>
        )}

        {report && report.people.length > 0 && (
          <>
            <Tiles tiles={[
              { label: "Scans", value: num(report.totals.scans), sub: "from the handheld scanner" },
              { label: "Moves", value: num(report.totals.moves), sub: report.totals.bulk ? `${num(report.totals.bulk)} of them in bulk` : "on every screen" },
              { label: "Put away", value: num(report.totals.putAway), sub: "totes and pallets to storage" },
              { label: "To bench", value: num(report.totals.toBench), sub: "totes and pallets to a bench" },
              { label: "Lots shelved", value: num(report.totals.lotsShelved), sub: "single lots moved" },
              { label: "Check-ins", value: num(report.totals.checkIns), sub: "receipts booked in" },
              { label: "Totes booked", value: num(report.totals.totesBooked), sub: report.totals.palletsBooked ? `and ${plural(report.totals.palletsBooked, "pallet")}` : "on those receipts" },
              seesEveryone
                ? { label: "People active", value: num(report.totals.people), sub: oneDay ? "did something that day" : "did something in these days" }
                : { label: "Days active", value: num(me?.activeDays ?? 0), sub: me?.busiestHour != null ? `busiest ${String(me.busiestHour).padStart(2, "0")}:00` : "days with anything done" },
              { label: "Refused scans", value: num(report.totals.refused), sub: report.totals.stale ? `and ${num(report.totals.stale)} overtaken` : "turned down by the Hub" },
              { label: "Sent late", value: num(report.totals.late), sub: "scanned offline, sent 5+ min later" },
            ]} />

            <section aria-label={seesEveryone ? "Per person" : "Your figures"}>
              <SectionTitle aside={<span className="text-xs text-gray-500 dark:text-gray-400">{oneDay ? "Tap a heading to sort. First and last are UK times." : "Tap a heading to sort. “A day” is the total ÷ days active. Pick a single day to see first and last times."}</span>}>
                {seesEveryone ? `Per person — ${plural(report.people.length, "person", "people")}` : "Your figures"}
              </SectionTitle>
              <PeopleTable people={report.people} hrefs={hrefs} oneDay={oneDay} totals={seesEveryone && report.people.length > 1 ? report.totals : undefined} />
            </section>

            {!oneDay && (() => {
              const { points, caption, unit } = dayPoints(report.days, shown)
              return (
                <section className={`${box} p-4 sm:p-5`} aria-label="Each day">
                  <SectionTitle>{seesEveryone ? "Each day — everyone" : "Each day"}</SectionTitle>
                  <DailyChart points={points} caption={caption} unit={unit} />
                </section>
              )
            })()}

            {seesEveryone && (
              <section className={`${box} p-4 sm:p-5`} aria-label="Compare people">
                <SectionTitle>Compare people</SectionTitle>
                <PersonBars people={report.people} hrefs={hrefs} />
              </section>
            )}

            <section className={`${box} p-4 sm:p-5`} aria-label="When in the day">
              <SectionTitle>{seesEveryone ? "When in the day — everyone" : "When in the day"}</SectionTitle>
              <HourStrip hours={report.hours} empty="No times recorded in these days." />
            </section>
          </>
        )}

        <Definitions ownOnly={!seesEveryone} />
      </div>
    </div>
  )
}
