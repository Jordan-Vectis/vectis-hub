import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { findUserGaps, fmtWorkingGap, type GapSave, type GapIdle, type IdleGap } from "@/lib/idle-gaps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Unaccounted Time" }

// Admin-only report: working-hours gaps between a cataloguer's consecutive lot
// saves that were never accounted for with an idle reason. Tamper-proof — it
// reads the save history the client can't rewrite, so it catches the outcome
// however the in-app popup was avoided.

// ⚠ EVERY date here must name Europe/London. This is a SERVER component, so the bare
// Date methods run on Railway, whose clock is UTC — "2026-08-19T00:00:00" parsed there is
// 01:00 London through BST, so the day ran 01:00–00:59 instead of midnight to midnight.

// A London wall-clock time as a real instant. Read the wall clock as if it were UTC, ask
// what London calls that instant, and take the difference back off — which is the offset
// in force on that date, so it is right either side of the March/October changeover.
function londonInstant(dateStr: string, time: string): Date {
  const naive = new Date(`${dateStr}T${time}Z`)
  if (isNaN(naive.getTime())) return new Date()
  const asLondon = new Date(naive.toLocaleString("en-US", { timeZone: "Europe/London" }))
  const asUtc    = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }))
  return new Date(naive.getTime() - (asLondon.getTime() - asUtc.getTime()))
}
function localDayStart(dateStr: string): Date { return londonInstant(dateStr, "00:00:00.000") }
function localDayEnd(dateStr: string): Date { return londonInstant(dateStr, "23:59:59.999") }
// en-CA renders YYYY-MM-DD, which is what the date inputs expect.
function ymd(d: Date): string { return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" }) }
// ⚠ timeZone is REQUIRED here. This is a SERVER component, so these format on Railway
// — whose clock is UTC — not in the reader's browser. Without it every time on this
// report reads an hour early through British Summer Time: a gap the lot list showed as
// 11:48 → 13:13 printed here as 10:48 → 12:13 (measured 2026-08-19).
function hm(d: Date): string { return d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }) }

// A save whose device claimed a non-UK timezone, or a clock more than an hour off
// the server, is the fingerprint of the 9–5 dodge (phone set to US / odd time).
// The skew tolerance is deliberately generous (1h, not minutes) so ordinary
// photo-upload latency can't false-flag an honest save; a "2am"/US clock is many
// hours off and still trips it.
function clockChanged(clientNow: Date | null, clientTz: string | null, serverAt: Date): boolean {
  if (clientTz && clientTz !== "Europe/London" && clientTz !== "Europe/Belfast") return true
  if (clientNow && Math.abs(clientNow.getTime() - serverAt.getTime()) > 60 * 60 * 1000) return true
  return false
}
// What the phone's screen actually showed at save (its own time, in its own tz).
function phoneClock(clientNow: Date | null, clientTz: string | null): string {
  if (!clientNow) return "—"
  try {
    return clientNow.toLocaleString("en-GB", { timeZone: clientTz || "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" })
  } catch { return clientNow.toLocaleString("en-GB", { timeZone: "Europe/London" }) }
}
const REASON_LABEL: Record<string, string> = {
  BLOCKED: "🚫 Blocked (asked for reason)", CLEARED_BY_REASON: "✓ Cleared by a logged reason",
  NEW_DAY_GRACE: "Start-of-day grace", DAY_OFF: "Day off (skipped)",
  UNDER_THRESHOLD: "Under threshold", TIMER_OFF: "Timer off", NO_HISTORY: "No prior save",
}

export default async function IdleGapsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; all?: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const sp = await searchParams
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 13 * 24 * 60 * 60 * 1000)   // default: last 14 days
  const fromStr = sp.from || ymd(weekAgo)
  const toStr = sp.to || ymd(today)
  const showExplained = sp.all === "1"
  const from = localDayStart(fromStr)
  const to = localDayEnd(toStr)

  // Every lot save + idle log in the window, plus each cataloguer's own threshold.
  const [saves, idles] = await Promise.all([
    prisma.catalogueTimingLog.findMany({
      where: { savedAt: { gte: from, lte: to } },
      select: { userId: true, userName: true, savedAt: true, lotId: true },
      orderBy: { savedAt: "asc" },
    }),
    prisma.idleLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { userId: true, idleStartedAt: true, idleDurationMs: true, reason: true },
    }),
  ])

  const userIds = [...new Set(saves.map((s) => s.userId))]
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, timerRedMins: true, showScanTimer: true } })
  const thresholdOf = new Map(users.map((u) => [u.id, (u.timerRedMins ?? 30) * 60 * 1000]))
  const timerOn = new Map(users.map((u) => [u.id, u.showScanTimer]))

  // Barcodes for the flagged gaps' surrounding saves (loose lotId, no relation).
  const lotIds = [...new Set(saves.map((s) => s.lotId).filter((x): x is string => !!x))]
  const barcodeByLot = new Map(
    (await prisma.catalogueLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, barcode: true } })).map((l) => [l.id, l.barcode]),
  )

  // Group per user, run the detector, collect gaps.
  const savesByUser = new Map<string, GapSave[]>()
  const nameByUser = new Map<string, string>()
  for (const s of saves) {
    if (!savesByUser.has(s.userId)) savesByUser.set(s.userId, [])
    savesByUser.get(s.userId)!.push({ savedAt: s.savedAt, lotBarcode: s.lotId ? barcodeByLot.get(s.lotId) ?? null : null })
    nameByUser.set(s.userId, s.userName)
  }
  const idlesByUser = new Map<string, GapIdle[]>()
  for (const i of idles) {
    if (!idlesByUser.has(i.userId)) idlesByUser.set(i.userId, [])
    idlesByUser.get(i.userId)!.push({ idleStartedAt: i.idleStartedAt, idleDurationMs: i.idleDurationMs, reason: i.reason })
  }

  const allGaps: IdleGap[] = []
  for (const [uid, us] of savesByUser) {
    const gaps = findUserGaps(uid, nameByUser.get(uid) ?? "Unknown", us, idlesByUser.get(uid) ?? [], thresholdOf.get(uid) ?? 30 * 60 * 1000)
    for (const g of gaps) if (showExplained || !g.explained) allGaps.push(g)
  }
  allGaps.sort((a, b) => b.start.getTime() - a.start.getTime())

  // Group the flagged gaps by cataloguer for display, worst (most gaps) first.
  const byUser = new Map<string, IdleGap[]>()
  for (const g of allGaps) {
    if (!byUser.has(g.userId)) byUser.set(g.userId, [])
    byUser.get(g.userId)!.push(g)
  }
  const groups = [...byUser.entries()].sort((a, b) => b[1].length - a[1].length)
  const unexplainedCount = allGaps.filter((g) => !g.explained).length

  // Idle-gate decision log — the server's decision on each meaningful save plus
  // what the device clock/timezone claimed. Table is created by Run Migrations, so
  // tolerate its absence before then.
  type Decision = { id: string; createdAt: Date; userName: string; reason: string; blocked: boolean; idleMs: number; thresholdMs: number; clientNow: Date | null; clientTz: string | null }
  let decisions: Decision[] = []
  try {
    decisions = await prisma.idleGateDecision.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, createdAt: true, userName: true, reason: true, blocked: true, idleMs: true, thresholdMs: true, clientNow: true, clientTz: true },
    })
  } catch { /* IdleGateDecision not migrated yet */ }
  const tamperedCount = decisions.filter((d) => clockChanged(d.clientNow, d.clientTz, d.createdAt)).length

  return (
    <div className="p-8">
      <div className="mb-6 max-w-3xl">
        <Link href="/admin/activity-timer" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Cataloguer Activity Timer</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Unaccounted Time</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Working-hours gaps (Mon–Fri, 9–5) between a cataloguer&apos;s consecutive lot saves that were never accounted for with an activity
          reason, and are longer than that person&apos;s own timer threshold. Read straight from the save history, so it catches the gap
          however the in-app popup was avoided. Gaps of a full working day or more are treated as time off and excluded.
        </p>
      </div>

      {/* Range picker */}
      <form className="flex items-end gap-3 flex-wrap mb-6 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">From</span>
          <input type="date" name="from" defaultValue={fromStr} className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">To</span>
          <input type="date" name="to" defaultValue={toStr} className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white" />
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 pb-2">
          <input type="checkbox" name="all" value="1" defaultChecked={showExplained} /> also show accounted-for gaps
        </label>
        <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium">Show</button>
      </form>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        <span className="font-semibold text-red-600 dark:text-red-400">{unexplainedCount}</span> unexplained gap{unexplainedCount === 1 ? "" : "s"} across {groups.length} cataloguer{groups.length === 1 ? "" : "s"} in this range.
      </p>

      {groups.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-500 py-8 text-center">No gaps found in this range. 🎉</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([uid, gaps]) => (
            <div key={uid} className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
                <p className="font-semibold text-gray-900 dark:text-white">{gaps[0].userName}</p>
                <div className="flex items-center gap-3 text-xs">
                  {timerOn.get(uid) === false && <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400">⚠ scan timer OFF</span>}
                  <span className="text-gray-500 dark:text-gray-400">{gaps.filter((g) => !g.explained).length} unexplained</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      <th className="px-4 py-2 font-medium">Day</th>
                      <th className="px-4 py-2 font-medium">Gap</th>
                      <th className="px-4 py-2 font-medium">Working time</th>
                      <th className="px-4 py-2 font-medium">Between lots</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gaps.map((g, i) => (
                      <tr key={i} className="border-t border-gray-100 dark:border-gray-800/70">
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{g.start.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short" })}</td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap tabular-nums">
                          {hm(g.start)} → {g.start.toDateString() !== g.end.toDateString() && <span className="text-amber-500">(next day) </span>}{hm(g.end)}
                        </td>
                        <td className="px-4 py-2 font-semibold text-gray-900 dark:text-white tabular-nums">{fmtWorkingGap(g.workingMs)}</td>
                        <td className="px-4 py-2 text-gray-500 dark:text-gray-400 font-mono text-xs">{g.beforeBarcode ?? "?"} → {g.afterBarcode ?? "?"}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {g.explained
                            ? <span className="text-emerald-600 dark:text-emerald-400">✓ {g.reason}</span>
                            : <span className="text-red-600 dark:text-red-400 font-medium">⚠ Unexplained</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Save-time gate decisions (tamper-proof; shows what the phone claimed) ── */}
      <div className="mt-10">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Save-time gate decisions</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
          What the activity check decided on each meaningful save, recorded server-side, next to the time and timezone the
          cataloguer&apos;s device reported. A device set to a non-UK timezone, or a clock well off the server, is the
          fingerprint of dodging the 9–5 check — and it can&apos;t be edited from the app.
        </p>
        {decisions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-500 py-6">No decisions recorded in this range yet.</p>
        ) : (
          <>
            {tamperedCount > 0 && (
              <p className="text-sm mt-3 mb-1">
                <span className="font-semibold text-red-600 dark:text-red-400">⚠ {tamperedCount}</span> save{tamperedCount === 1 ? "" : "s"} in this range were made with the device clock/timezone changed away from UK time.
              </p>
            )}
            <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900">
                    <th className="px-4 py-2 font-medium">Server time</th>
                    <th className="px-4 py-2 font-medium">Cataloguer</th>
                    <th className="px-4 py-2 font-medium">Gate decision</th>
                    <th className="px-4 py-2 font-medium">Away</th>
                    <th className="px-4 py-2 font-medium">Phone said</th>
                    <th className="px-4 py-2 font-medium">Phone timezone</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => {
                    const bad = clockChanged(d.clientNow, d.clientTz, d.createdAt)
                    return (
                      <tr key={d.id} className={`border-t border-gray-100 dark:border-gray-800/70 ${bad ? "bg-red-50 dark:bg-red-950/30" : ""}`}>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap tabular-nums">{d.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{d.userName}</td>
                        <td className={`px-4 py-2 whitespace-nowrap ${d.blocked ? "text-red-600 dark:text-red-400 font-medium" : "text-gray-600 dark:text-gray-400"}`}>{REASON_LABEL[d.reason] ?? d.reason}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400 tabular-nums whitespace-nowrap">{d.idleMs > 0 ? fmtWorkingGap(d.idleMs) : "—"}</td>
                        <td className={`px-4 py-2 whitespace-nowrap tabular-nums ${bad ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-500 dark:text-gray-400"}`}>{phoneClock(d.clientNow, d.clientTz)}{bad ? " ⚠" : ""}</td>
                        <td className={`px-4 py-2 whitespace-nowrap ${bad ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-500 dark:text-gray-400"}`}>{d.clientTz ?? "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
