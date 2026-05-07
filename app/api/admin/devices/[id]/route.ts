import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { id } = await params
    const { serialNumber, name, deviceType, notes, assignedToId } = await req.json()

    const device = await prisma.device.update({
      where: { id },
      data: {
        ...(serialNumber !== undefined && { serialNumber: serialNumber.trim() }),
        ...(name !== undefined && { name: name.trim() }),
        ...(deviceType !== undefined && { deviceType: deviceType.trim() }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(assignedToId !== undefined && { assignedToId: assignedToId || null }),
      },
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
    })

    return NextResponse.json({ device })
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A device with that serial number already exists" }, { status: 409 })
    }
    console.error("devices PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { id } = await params
    await prisma.device.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("devices DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
