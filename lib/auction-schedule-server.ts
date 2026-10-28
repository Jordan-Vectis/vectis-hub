import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"
import { auctionWhere, getDepartmentAccess } from "@/lib/departments"
import { addDays, cleanDay, ukYmd, type DaySchedule, type Defaults, type ScheduleSale } from "@/lib/auction-schedule"

// Server half of Auction → Auctioneering Schedule (lib/auction-schedule.ts holds the shapes).

/** Who is asking, checked fresh from the database, and whether they hold the app. */
export async function requireSchedule(): Promise<{ userId: string; name: string; role: string }> {
  const session = await getEffectiveSession()
  if (!session) throw Object.assign(new Error("Not signed in"), { http: 401 })
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true, name: true, email: true } })
  if (!hasAppAccess(u?.role ?? "", u?.allowedApps ?? [], "AUCTION_SCHEDULE")) throw Object.assign(new Error("No access to the Auctioneering Schedule"), { http: 403 })
  return { userId: session.user.id, name: u?.name || u?.email || "Unknown", role: u?.role ?? "" }
}

/** The sales dated in the week starting `monday` (London days), filtered by department like every
 *  other page that lists sales (RULES.md → Departments). */
export async function salesForWeek(monday: string, who: { userId: string; role: string }): Promise<ScheduleSale[]> {
  const access = await getDepartmentAccess(who.userId, who.role)
  const sunday = addDays(monday, 6)
  const rows = await prisma.catalogueAuction.findMany({
    // A day's margin each side, then trimmed to London days below (Railway runs UTC).
    where: { ...auctionWhere(access), auctionDate: { gte: new Date(addDays(monday, -1) + "T00:00:00Z"), lt: new Date(addDays(sunday, 2) + "T00:00:00Z") } },
    select: { id: true, code: true, name: true, auctionDate: true, _count: { select: { lots: true } } },
    orderBy: [{ auctionDate: "asc" }, { code: "asc" }],
  })
  return rows
    .map(r => ({ id: r.id, code: r.code, name: r.name, date: ukYmd(r.auctionDate!), lots: r._count.lots }))
    .filter(s => s.date >= monday && s.date <= sunday)
}

export async function readDefaults(): Promise<Defaults> {
  const row = await prisma.auctionScheduleDefault.findUnique({ where: { id: "global" } })
  const out: Defaults = {}
  const data = (row?.data ?? {}) as Record<string, unknown>
  for (const k of Object.keys(data)) if (/^[1-7]$/.test(k)) out[k] = cleanDay(data[k])
  return out
}

export async function readSchedules(auctionIds: string[]): Promise<Record<string, DaySchedule>> {
  if (!auctionIds.length) return {}
  const rows = await prisma.auctionSchedule.findMany({ where: { auctionId: { in: auctionIds } } })
  return Object.fromEntries(rows.map(r => [r.auctionId, cleanDay(r.data)]))
}
