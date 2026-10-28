import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isMissingTable } from "@/lib/prisma-errors"
import { requireSchedule } from "@/lib/auction-schedule-server"

// /api/auction-schedule/staff — the people who can be dragged onto the schedule.
// POST { name, auctioneer, vectis, saleroom } · PUT { id, ...same } · DELETE { id }.
// Removing someone never touches a saved week: schedules hold names as text.

const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })
const NOT_READY = "A database update is waiting — press Run Migrations on the Admin page."

function fields(b: any) {
  const data: Record<string, unknown> = {}
  if (b.name !== undefined) data.name = String(b.name ?? "").trim().slice(0, 60)
  for (const k of ["auctioneer", "vectis", "saleroom"]) if (b[k] !== undefined) data[k] = !!b[k]
  return data
}

export async function POST(req: NextRequest) {
  try {
    await requireSchedule()
    const data = fields(await req.json())
    if (!data.name) return NextResponse.json({ error: "Type a name" }, { status: 400 })
    const row = await prisma.auctionScheduleStaff.create({ data: data as any })
    return NextResponse.json({ staff: row })
  } catch (e: any) {
    if (isMissingTable(e)) return NextResponse.json({ error: NOT_READY }, { status: 503 })
    if (!e?.http) console.error("auction-schedule staff POST:", e)
    return err(e)
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireSchedule()
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const data = fields(b)
    if (data.name === "") return NextResponse.json({ error: "Type a name" }, { status: 400 })
    const row = await prisma.auctionScheduleStaff.update({ where: { id: String(b.id) }, data })
    return NextResponse.json({ staff: row })
  } catch (e: any) {
    if (isMissingTable(e)) return NextResponse.json({ error: NOT_READY }, { status: 503 })
    if (!e?.http) console.error("auction-schedule staff PUT:", e)
    return err(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireSchedule()
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.auctionScheduleStaff.delete({ where: { id: String(id) } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (isMissingTable(e)) return NextResponse.json({ error: NOT_READY }, { status: 503 })
    if (!e?.http) console.error("auction-schedule staff DELETE:", e)
    return err(e)
  }
}
