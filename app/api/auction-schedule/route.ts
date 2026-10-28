import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isMissingTable } from "@/lib/prisma-errors"
import { canSeeAuction, getDepartmentAccess } from "@/lib/departments"
import { cleanDay, mondayOf, ukYmd } from "@/lib/auction-schedule"
import { readDefaults, readSchedules, requireSchedule, salesForWeek } from "@/lib/auction-schedule-server"

// /api/auction-schedule — AUCTION_SCHEDULE app permission, checked fresh.
// GET ?week=YYYY-MM-DD → the week's sales, their saved schedules, the pinned defaults, the staff list.
// PUT { auctionId, data } → save one sale's schedule.
// PUT { defaults } → save the pinned weekly defaults (all weekdays at once).

const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })
const NOT_READY = "A database update is waiting — press Run Migrations on the Admin page."

export async function GET(req: NextRequest) {
  try {
    const who = await requireSchedule()
    const raw = req.nextUrl.searchParams.get("week") ?? ""
    const monday = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ukYmd(new Date()))
    const sales = await salesForWeek(monday, who)
    try {
      const [schedules, defaults, staff] = await Promise.all([
        readSchedules(sales.map(s => s.id)),
        readDefaults(),
        prisma.auctionScheduleStaff.findMany({ orderBy: { name: "asc" } }),
      ])
      return NextResponse.json({ monday, sales, schedules, defaults, staff })
    } catch (e: any) {
      if (isMissingTable(e)) return NextResponse.json({ monday, sales, schedules: {}, defaults: {}, staff: [], needsMigration: true })
      throw e
    }
  } catch (e: any) {
    if (!e?.http) console.error("auction-schedule GET:", e)
    return err(e)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const who = await requireSchedule()
    const b = await req.json()

    if (b.defaults !== undefined) {
      const data: Record<string, unknown> = {}
      for (const k of Object.keys(b.defaults ?? {})) if (/^[1-7]$/.test(k)) data[k] = cleanDay(b.defaults[k])
      await prisma.auctionScheduleDefault.upsert({ where: { id: "global" }, create: { id: "global", data: data as any }, update: { data: data as any } })
      return NextResponse.json({ ok: true })
    }

    const auctionId = String(b.auctionId ?? "")
    const sale = await prisma.catalogueAuction.findUnique({ where: { id: auctionId }, select: { id: true, auctionType: true } })
    if (!sale) return NextResponse.json({ error: "That sale no longer exists" }, { status: 404 })
    // Same department rule as the list — saving must not be a way round it.
    if (!canSeeAuction(await getDepartmentAccess(who.userId, who.role), sale)) return NextResponse.json({ error: "No access to that sale" }, { status: 403 })
    const data = cleanDay(b.data) as any
    await prisma.auctionSchedule.upsert({
      where: { auctionId },
      create: { auctionId, data, updatedBy: who.name },
      update: { data, updatedBy: who.name },
      select: { auctionId: true },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (isMissingTable(e)) return NextResponse.json({ error: NOT_READY }, { status: 503 })
    if (!e?.http) console.error("auction-schedule PUT:", e)
    return err(e)
  }
}
