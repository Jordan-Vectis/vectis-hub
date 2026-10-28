import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"
import { auctionWhere, getDepartmentAccess } from "@/lib/departments"
import { isMissingTable } from "@/lib/prisma-errors"
import { addDays, cleanDay, fromDefaults, ukYmd, weekdayOf, type DaySchedule, type Defaults, type ScheduleSale } from "@/lib/auction-schedule"

// Server half of Auction → Auctioneering Schedule (lib/auction-schedule.ts holds the shapes).

/** Who is asking, checked fresh from the database, and whether they hold the app. */
export async function requireSchedule(): Promise<{ userId: string; name: string; role: string }> {
  const session = await getEffectiveSession()
  if (!session) throw Object.assign(new Error("Not signed in"), { http: 401 })
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true, name: true, email: true } })
  if (!hasAppAccess(u?.role ?? "", u?.allowedApps ?? [], "AUCTION_SCHEDULE")) throw Object.assign(new Error("No access to the Auctioneering Schedule"), { http: 403 })
  return { userId: session.user.id, name: u?.name || u?.email || "Unknown", role: u?.role ?? "" }
}

/** The sales dated in the week starting `monday`, from the WEBSITE data the office collector
 *  gathers (Databases → BC Database / Sales): ArchiveSale gives each sale's code, date and title,
 *  and its lots are the site's own lot count or the lots collected for it (BcLotWeb), whichever is
 *  higher. Jordan, 2026-10-28: the first version read the Hub's Auction Manager sales and Hub lot
 *  counts — wrong, because sales are still catalogued straight in BC. A sale shows here once it has
 *  been collected (upcoming catalogues included); a schedule is keyed on the sale CODE. */
export async function salesForWeek(monday: string, who: { userId: string; role: string }): Promise<ScheduleSale[]> {
  const sunday = addDays(monday, 6)
  // A day's margin each side, then trimmed to London days below (Railway runs UTC).
  const rows = await prisma.$queryRaw<{ code: string; title: string; saleDate: Date; lots: number; collected: number }[]>`
    SELECT s."code", s."title", s."saleDate", s."lots",
           (SELECT count(*) FROM "BcLotWeb" w WHERE w."siteSaleId" = s."siteId")::int AS "collected"
    FROM "ArchiveSale" s
    WHERE s."code" IS NOT NULL
      AND s."saleDate" >= ${new Date(addDays(monday, -1) + "T00:00:00Z")}
      AND s."saleDate" <  ${new Date(addDays(sunday, 2) + "T00:00:00Z")}`
  const byCode = new Map<string, ScheduleSale>()
  for (const r of rows) {
    const date = ukYmd(r.saleDate)
    if (date < monday || date > sunday) continue
    const code = r.code.trim().toUpperCase()
    const lots = Math.max(Number(r.lots) || 0, Number(r.collected) || 0)
    const had = byCode.get(code)
    if (!had || lots > had.lots) byCode.set(code, { id: code, code, name: r.title, date, lots })
  }
  let sales = [...byCode.values()].sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code))

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
