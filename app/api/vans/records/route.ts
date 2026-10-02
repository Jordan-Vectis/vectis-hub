import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { deleteObjectsFromR2 } from "@/lib/r2"
import { requireVans, missingTable, int, str, pence, VAN_RECORD_KINDS } from "@/lib/vans"

// /api/vans/records — one MOT / service / repair / tax / insurance entry on a van.
const err = (e: any) => NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })
const KINDS: readonly string[] = VAN_RECORD_KINDS

export async function POST(req: NextRequest) {
  try {
    const who = await requireVans()
    const b = await req.json()
    if (!b.vanId) return NextResponse.json({ error: "Missing vanId" }, { status: 400 })
    const date = new Date(String(b.date ?? ""))
    if (isNaN(date.getTime())) return NextResponse.json({ error: "Give the record a date" }, { status: 400 })

    const mileage = int(b.mileage) ?? null
    const rec = await prisma.vanRecord.create({
      data: {
        vanId: String(b.vanId),
        kind:  KINDS.includes(String(b.kind)) ? String(b.kind) : "SERVICE",
        date, mileage,
        costPence: pence(b.cost) ?? null,
        garage:    str(b.garage) ?? "",
        result:    ["PASS", "FAIL"].includes(String(b.result)) ? String(b.result) : "",
        notes:     str(b.notes, 4000) ?? "",
        fileKeys:  Array.isArray(b.fileKeys) ? b.fileKeys.filter((k: any) => typeof k === "string") : [],
        createdByName: who.name,
      },
    })
    // A mileage on a record is the van's newest reading if it is higher than what we hold.
    if (mileage != null) {
      await prisma.van.updateMany({ where: { id: String(b.vanId), OR: [{ mileage: null }, { mileage: { lt: mileage } }] }, data: { mileage } })
    }
    return NextResponse.json({ id: rec.id })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "A database update is waiting — the vans tables aren't there yet." }, { status: 503 })
    if (!e?.http) console.error("vans/records POST:", e)
    return err(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireVans()
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const rec = await prisma.vanRecord.findUnique({ where: { id: String(id) }, select: { fileKeys: true } })
    await prisma.vanRecord.delete({ where: { id: String(id) } })
    if (rec?.fileKeys?.length) await deleteObjectsFromR2(rec.fileKeys).catch(e => console.warn("vans/records DELETE: files not removed", e?.message))
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (!e?.http) console.error("vans/records DELETE:", e)
    return err(e)
  }
}
