import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { deleteObjectsFromR2 } from "@/lib/r2"

// /api/jordan/cars/records — one MOT / service / repair entry on a car.
const KINDS = ["MOT", "SERVICE", "REPAIR", "TAX", "INSURANCE", "OTHER"]

/** "£1,234.56" → 123456 pence. Whole pounds typed in work too. Stored in pence so
 *  an invoice adds up exactly rather than drifting through floats. */
function toPence(v: any): number | null {
  if (v === undefined) return undefined as any
  const s = String(v ?? "").replace(/[^\d.]/g, "")
  if (!s) return null
  const n = Math.round(parseFloat(s) * 100)
  return isNaN(n) ? null : n
}
function toInt(v: any): number | null {
  if (v === undefined) return undefined as any
  const s = String(v ?? "").replace(/[^\d]/g, "")
  return s ? parseInt(s, 10) : null
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const b = await req.json()
    if (!b.carId) return NextResponse.json({ error: "Missing carId" }, { status: 400 })

    const date = new Date(String(b.date ?? ""))
    if (isNaN(date.getTime())) return NextResponse.json({ error: "Give the record a date" }, { status: 400 })

    const rec = await prisma.jordanCarRecord.create({
      data: {
        carId: String(b.carId),
        kind:  KINDS.includes(String(b.kind)) ? String(b.kind) : "SERVICE",
        date,
        mileage:   toInt(b.mileage) ?? null,
        costPence: toPence(b.cost) ?? null,
        garage:    String(b.garage ?? "").trim().slice(0, 200),
        result:    ["PASS", "FAIL"].includes(String(b.result)) ? String(b.result) : "",
        notes:     String(b.notes ?? "").trim().slice(0, 4000),
        fileKeys:  Array.isArray(b.fileKeys) ? b.fileKeys.filter((k: any) => typeof k === "string") : [],
      },
    })
    return NextResponse.json({ id: rec.id })
  } catch (e: any) {
    if (/does not exist|P2021|P2022/i.test(String(e?.message ?? e))) {
      return NextResponse.json({ error: "Run Migrations first — the garage tables aren't there yet." }, { status: 503 })
    }
    console.error("jordan/cars/records POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const data: any = {}
    if (b.kind    !== undefined && KINDS.includes(String(b.kind))) data.kind = String(b.kind)
    if (b.date    !== undefined) {
      const d = new Date(String(b.date))
      if (!isNaN(d.getTime())) data.date = d
    }
    if (b.mileage !== undefined) data.mileage   = toInt(b.mileage)
    if (b.cost    !== undefined) data.costPence = toPence(b.cost)
    if (b.garage  !== undefined) data.garage    = String(b.garage ?? "").trim().slice(0, 200)
    if (b.result  !== undefined) data.result    = ["PASS", "FAIL"].includes(String(b.result)) ? String(b.result) : ""
    if (b.notes   !== undefined) data.notes     = String(b.notes ?? "").trim().slice(0, 4000)
    if (b.fileKeys !== undefined && Array.isArray(b.fileKeys)) {
      data.fileKeys = b.fileKeys.filter((k: any) => typeof k === "string")
    }

    await prisma.jordanCarRecord.update({ where: { id: b.id }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cars/records PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    // Its attachments go with it, or they linger in the bucket unreferenced.
    const rec = await prisma.jordanCarRecord.findUnique({ where: { id }, select: { fileKeys: true } })
    await prisma.jordanCarRecord.delete({ where: { id } })
    if (rec?.fileKeys?.length) await deleteObjectsFromR2(rec.fileKeys).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cars/records DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
