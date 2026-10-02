import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVans, missingTable, int, str } from "@/lib/vans"

// /api/vans/trips — who has a van out.
// POST { vanId, driverName, purpose?, outMileage? }      → sign it out (refused if already out)
// PUT  { id, inMileage?, notes? }                         → sign it back in
// PUT  { id, driverName?, purpose?, outMileage?, notes? } → correct a trip
// DELETE { id }                                           → remove a trip (a mistaken sign-out)
const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })

export async function POST(req: NextRequest) {
  try {
    const who = await requireVans()
    const b = await req.json()
    if (!b.vanId) return NextResponse.json({ error: "Missing vanId" }, { status: 400 })
    const driverName = str(b.driverName, 80) || who.name
    const vanId = String(b.vanId)

    // One driver at a time — a second sign-out while it's out is a mistake, not a handover.
    const out = await prisma.vanTrip.findFirst({ where: { vanId, inAt: null }, select: { driverName: true, outAt: true } })
    if (out) return NextResponse.json({ error: `It's already out with ${out.driverName} — sign it back in first.` }, { status: 409 })

    const outMileage = int(b.outMileage) ?? null
    const trip = await prisma.vanTrip.create({
      data: { vanId, driverName, purpose: str(b.purpose) ?? "", outAt: new Date(), outMileage, createdByName: who.name },
    })
    if (outMileage != null) {
      await prisma.van.updateMany({ where: { id: vanId, OR: [{ mileage: null }, { mileage: { lt: outMileage } }] }, data: { mileage: outMileage } })
    }
    return NextResponse.json({ id: trip.id })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "A database update is waiting — the vans tables aren't there yet." }, { status: 503 })
    if (!e?.http) console.error("vans/trips POST:", e)
    return err(e)
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireVans()
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const trip = await prisma.vanTrip.findUnique({ where: { id: String(b.id) } })
    if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 })

    const data: any = {}
    if (b.driverName !== undefined) data.driverName = str(b.driverName, 80) || trip.driverName
    if (b.purpose    !== undefined) data.purpose    = str(b.purpose) ?? ""
    if (b.notes      !== undefined) data.notes      = str(b.notes, 2000) ?? ""
    if (b.outMileage !== undefined) data.outMileage = int(b.outMileage)
    if (b.inMileage  !== undefined) data.inMileage  = int(b.inMileage)
    if (b.signIn) {
      if (trip.inAt) return NextResponse.json({ error: "Already signed in" }, { status: 409 })
      data.inAt = new Date()
      const inM = data.inMileage ?? null
      if (inM != null && trip.outMileage != null && inM < trip.outMileage) {
        return NextResponse.json({ error: `Mileage in (${inM.toLocaleString("en-GB")}) is below mileage out (${trip.outMileage.toLocaleString("en-GB")}) — check the reading.` }, { status: 400 })
      }
      if (inM != null) {
        await prisma.van.updateMany({ where: { id: trip.vanId, OR: [{ mileage: null }, { mileage: { lt: inM } }] }, data: { mileage: inM } })
      }
    }
    await prisma.vanTrip.update({ where: { id: trip.id }, data, select: { id: true } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("vans/trips PUT:", e)
    return err(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireVans()
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.vanTrip.delete({ where: { id: String(id) } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("vans/trips DELETE:", e)
    return err(e)
  }
}
