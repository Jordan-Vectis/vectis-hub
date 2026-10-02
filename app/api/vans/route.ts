import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { deleteObjectsFromR2 } from "@/lib/r2"
import { requireVans, missingTable, day, int, str } from "@/lib/vans"

// /api/vans — the vans themselves. VANS app permission, checked fresh.
// GET → every van with its records (newest first) and trips (newest first, last 30).
// POST { name } → a new van. PUT { id, ...fields } → only the fields sent are touched.
// DELETE { id } → the van, its records, its trips and its files.

const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })

export async function GET() {
  try {
    await requireVans()
    const vans = await prisma.van.findMany({
      orderBy: [{ active: "desc" }, { position: "asc" }, { createdAt: "asc" }],
      include: {
        records: { orderBy: { date: "desc" } },
        trips:   { orderBy: { outAt: "desc" }, take: 30 },
      },
    })
    return NextResponse.json({ vans })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ vans: [], needsMigration: true })
    if (!e?.http) console.error("vans GET:", e)
    return err(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireVans()
    const b = await req.json()
    const name = str(b.name, 80) ?? ""
    if (!name) return NextResponse.json({ error: "Give the van a name" }, { status: 400 })
    const last = await prisma.van.findFirst({ orderBy: { position: "desc" }, select: { position: true } })
    const van = await prisma.van.create({ data: { name, reg: (str(b.reg, 16) ?? "").toUpperCase(), position: (last?.position ?? 0) + 1 } })
    return NextResponse.json({ id: van.id })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "A database update is waiting — the vans tables aren't there yet." }, { status: 503 })
    if (!e?.http) console.error("vans POST:", e)
    return err(e)
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireVans()
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const data: any = {}
    const put = (k: string, v: any) => { if (v !== undefined) data[k] = v }
    put("name", str(b.name, 80)); put("make", str(b.make)); put("model", str(b.model))
    put("colour", str(b.colour)); put("year", str(b.year, 8)); put("fuel", str(b.fuel, 40))
    put("notes", str(b.notes, 4000))
    if (b.reg !== undefined) data.reg = String(b.reg ?? "").trim().toUpperCase().slice(0, 16)
    put("mileage", int(b.mileage))
    put("motDue", day(b.motDue)); put("taxDue", day(b.taxDue))
    put("serviceDue", day(b.serviceDue)); put("insuranceDue", day(b.insuranceDue))
    if (b.active !== undefined) data.active = !!b.active
    if (b.position !== undefined) data.position = Number(b.position) || 0
    if (b.photoKey !== undefined) data.photoKey = String(b.photoKey ?? "")
    if (data.name === "") return NextResponse.json({ error: "The van needs a name" }, { status: 400 })

    await prisma.van.update({ where: { id: String(b.id) }, data, select: { id: true } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("vans PUT:", e)
    return err(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireVans()
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    // Files go with it, or they sit in the bucket for ever with nothing pointing at them.
    const van = await prisma.van.findUnique({
      where: { id: String(id) }, select: { photoKey: true, records: { select: { fileKeys: true } } },
    })
    const keys = [van?.photoKey ?? "", ...(van?.records ?? []).flatMap(r => r.fileKeys)].filter(Boolean)
    await prisma.van.delete({ where: { id: String(id) } })
    if (keys.length) await deleteObjectsFromR2(keys).catch(e => console.warn("vans DELETE: files not removed", e?.message))
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("vans DELETE:", e)
    return err(e)
  }
}
