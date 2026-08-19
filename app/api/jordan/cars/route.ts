import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { deleteObjectsFromR2 } from "@/lib/r2"

// /api/jordan/cars — the garage. Locked to jordan.orange (404 otherwise).
// ⚠ Tables arrive with Run Migrations while code deploys instantly, so the read
// tolerates them being absent and the page shows a banner instead of a 500.
function missingTable(e: any): boolean {
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(String(e?.message ?? e))
}

/** "" / undefined → null, so a cleared date really clears. ⚠ Never coerce a blank
 *  to `new Date()` — "no MOT recorded" and "MOT due today" must not look alike. */
const day = (v: any): Date | null => {
  if (v === undefined) return undefined as any      // field not sent — leave alone
  const s = String(v ?? "").trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
const int = (v: any): number | null => {
  if (v === undefined) return undefined as any
  const s = String(v ?? "").replace(/[^\d-]/g, "")
  return s ? parseInt(s, 10) : null
}
const str = (v: any, max = 200) => (v === undefined ? undefined : String(v ?? "").trim().slice(0, max))

export async function GET() {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const cars = await prisma.jordanCar.findMany({
      orderBy: [{ isPast: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      include: { records: { orderBy: { date: "desc" } } },
    })
    return NextResponse.json({ cars })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ cars: [], needsMigration: true })
    console.error("jordan/cars GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const b = await req.json()
    const car = await prisma.jordanCar.create({
      data: {
        nickname: str(b.nickname) ?? "", reg: (str(b.reg, 16) ?? "").toUpperCase(),
        make: str(b.make) ?? "", model: str(b.model) ?? "", colour: str(b.colour) ?? "",
        year: str(b.year, 8) ?? "", fuel: str(b.fuel, 40) ?? "", notes: str(b.notes, 4000) ?? "",
        isPast: !!b.isPast,
      },
    })
    return NextResponse.json({ id: car.id })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the garage tables aren't there yet." }, { status: 503 })
    console.error("jordan/cars POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    // Only fields actually sent are touched — `undefined` from the helpers above
    // means "not in the payload", which is how a partial save leaves the rest be.
    const data: any = {}
    const put = (k: string, v: any) => { if (v !== undefined) data[k] = v }
    put("nickname", str(b.nickname)); put("make", str(b.make)); put("model", str(b.model))
    put("colour", str(b.colour));     put("year", str(b.year, 8)); put("fuel", str(b.fuel, 40))
    put("notes", str(b.notes, 4000))
    if (b.reg !== undefined) data.reg = String(b.reg ?? "").trim().toUpperCase().slice(0, 16)
    put("mileage", int(b.mileage))
    put("motDue", day(b.motDue)); put("taxDue", day(b.taxDue))
    put("serviceDue", day(b.serviceDue)); put("insuranceDue", day(b.insuranceDue))
    put("boughtOn", day(b.boughtOn)); put("soldOn", day(b.soldOn))
    put("boughtPrice", int(b.boughtPrice)); put("soldPrice", int(b.soldPrice))
    if (b.isPast !== undefined) data.isPast = !!b.isPast
    if (b.position !== undefined) data.position = Number(b.position) || 0
    if (b.photoKey !== undefined) data.photoKey = String(b.photoKey ?? "")

    await prisma.jordanCar.update({ where: { id: b.id }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cars PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    // Take the R2 keys with it — records cascade in the DB, but the files would
    // otherwise sit in the bucket for ever with nothing pointing at them.
    const car = await prisma.jordanCar.findUnique({
      where: { id }, select: { photoKey: true, records: { select: { fileKeys: true } } },
    })
    const keys = [car?.photoKey ?? "", ...(car?.records ?? []).flatMap(r => r.fileKeys)].filter(Boolean)
    await prisma.jordanCar.delete({ where: { id } })
    if (keys.length) await deleteObjectsFromR2(keys).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cars DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
