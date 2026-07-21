import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { findUserGaps, fmtWorkingGap, type GapSave, type GapIdle, type IdleGap } from "@/lib/idle-gaps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Unexplained Gaps" }

// Admin-only report: working-hours gaps between a cataloguer's consecutive lot
// saves that were never accounted for with an idle reason. Tamper-proof — it
// reads the save history the client can't rewrite, so it catches the outcome
// however the in-app popup was avoided.

function localDayStart(dateStr: string): Date { const d = new Date(dateStr + "T00:00:00"); return isNaN(d.getTime()) ? new Date() : d }
function localDayEnd(dateStr: string): Date { const d = new Date(dateStr + "T23:59:59.999"); return isNaN(d.getTime()) ? new Date() : d }
function ymd(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
function hm(d: Date): string { return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) }

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

  return (
    <div className="p-8">
      <div className="mb-6 max-w-3xl">
        <Link href="/admin/idle-timer" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Idle Timer</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Unexplained Idle Gaps</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Working-hours gaps (Mon–Fri, 9–5) between a cataloguer&apos;s consecutive lot saves that were never accounted for with an idle
          reason, and are longer than that person&apos;s own idle threshold. Read straight from the save history, so it catches the gap
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
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{g.start.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</td>
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
    </div>
  )
}
