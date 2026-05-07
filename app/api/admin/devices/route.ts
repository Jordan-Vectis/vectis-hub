import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const devices = await prisma.device.findMany({
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
      orderBy: { name: "asc" },
    })

    return NextResponse.json({ devices })
  } catch (e: any) {
    console.error("devices GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { serialNumber, name, deviceType, notes, assignedToId } = await req.json()
    if (!serialNumber?.trim() || !name?.trim()) {
      return NextResponse.json({ error: "Serial number and name are required" }, { status: 400 })
    }

    const device = await prisma.device.create({
      data: {
        serialNumber: serialNumber.trim(),
        name: name.trim(),
        deviceType: deviceType?.trim() || "iPad",
        notes: notes?.trim() || null,
        assignedToId: assignedToId || null,
      },
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
    })

    return NextResponse.json({ device })
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A device with that serial number already exists" }, { status: 409 })
    }
    console.error("devices POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
