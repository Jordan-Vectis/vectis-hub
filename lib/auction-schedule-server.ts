import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"
import { auctionWhere, getDepartmentAccess } from "@/lib/departments"
import { isMissingTable } from "@/lib/prisma-errors"
import { addDays, cleanDay, fromDefaults, weekdayOf, type DaySchedule, type Defaults, type ScheduleSale } from "@/lib/auction-schedule"

// Server half of Auction → Auctioneering Schedule (lib/auction-schedule.ts holds the shapes).

/** Who is asking, checked fresh from the database, and whether they hold the app. */
export async function requireSchedule(): Promise<{ userId: string; name: string; role: string }> {
  const session = await getEffectiveSession()
  if (!session) throw Object.assign(new Error("Not signed in"), { http: 401 })
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true, name: true, email: true } })
  if (!hasAppAccess(u?.role ?? "", u?.allowedApps ?? [], "AUCTION_SCHEDULE")) throw Object.assign(new Error("No access to the Auctioneering Schedule"), { http: 403 })
  return { userId: session.user.id, name: u?.name || u?.email || "Unknown", role: u?.role ?? "" }
}

/** The sales dated in the week starting `monday` — EXACTLY the sales and lots Databases → BC Database
 *  lists (its rows: WarehouseItem with a sale code, a sale date and a lot number), grouped per sale.
 *  Jordan, 2026-10-28: the first version read the Hub's Auction Manager sales and Hub lot counts
 *  (wrong — sales are still done straight in BC); the second read ArchiveSale, which only holds a
 *  sale once the collector has read that sale's own page, so next week's sales were missing while
 *  the BC Database page plainly showed their lots. Upcoming sales included; a schedule is keyed on
 *  the sale CODE. ⚠ auctionDate is a 'YYYY-MM-DD' TEXT column, compared as text like that page does. */
export async function salesForWeek(monday: string, who: { userId: string; role: string }): Promise<ScheduleSale[]> {
  const sunday = addDays(monday, 6)
  const rows = await prisma.$queryRaw<{ code: string; name: string | null; date: string; lots: number }[]>`
    SELECT w."auctionCode" AS "code", max(w."auctionName") AS "name", min(w."auctionDate") AS "date", count(*)::int AS "lots"
    FROM "WarehouseItem" w
    WHERE w."auctionCode" IS NOT NULL AND w."auctionDate" >= ${monday} AND w."auctionDate" <= ${sunday}
      AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL
    GROUP BY w."auctionCode"`
  let sales: ScheduleSale[] = rows
    .map(r => ({ id: r.code.trim().toUpperCase(), code: r.code.trim().toUpperCase(), name: (r.name ?? "").trim(), date: String(r.date).slice(0, 10), lots: Number(r.lots) || 0 }))
    .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code))

  // Departments (RULES.md): a restricted person sees only the sales their departments' Hub sales cover.
  const access = await getDepartmentAccess(who.userId, who.role)
  if (!access.unrestricted) {
    const seen = await prisma.catalogueAuction.findMany({ where: { ...auctionWhere(access), code: { in: sales.map(s => s.code) } }, select: { code: true } })
    const ok = new Set(seen.map(s => s.code))
    sales = sales.filter(s => ok.has(s.code))
  }
  return sales
}

/** Saving must not be a way round the department rule: unrestricted, or a Hub sale they can see. */
export async function canEditSale(code: string, who: { userId: string; role: string }): Promise<boolean> {
  const access = await getDepartmentAccess(who.userId, who.role)
  if (access.unrestricted) return true
  return !!(await prisma.catalogueAuction.findFirst({ where: { ...auctionWhere(access), code }, select: { id: true } }))
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

/** The week ready to print: its sales and each one's schedule (saved, else the weekday's pins). */
export async function weekForPrint(monday: string, who: { userId: string; role: string }) {
  const sales = await salesForWeek(monday, who)
  let saved: Record<string, DaySchedule> = {}
  let defaults: Defaults = {}
  try {
    ;[saved, defaults] = await Promise.all([readSchedules(sales.map(s => s.id)), readDefaults()])
  } catch (e: any) {
    if (!isMissingTable(e)) throw e
  }
  const days = sales.map(s => saved[s.id] ?? fromDefaults(defaults[String(weekdayOf(s.date))]))
  return { sales, days }
}
