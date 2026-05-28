import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    const parcel = await prisma.parcel.findUnique({
      where: { id },
      include: {
        lots: { include: { lot: { select: { id: true, barcode: true, receiptUniqueId: true, title: true, hammerPrice: true, auction: { select: { code: true, name: true } } } } } },
        customerAccount: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    })
    if (!parcel) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(parcel)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    const body = await req.json()

    const data: Record<string, unknown> = {}
    const fields = [
      "recipientName", "recipientCompany", "recipientLine1", "recipientLine2",
      "recipientCity", "recipientCounty", "recipientPostcode", "recipientEmail", "recipientPhone",
      "weightInGrams", "packageFormat", "serviceCode", "specialInstructions", "notes", "status",
      "rmOrderIdentifier", "trackingNumber", "labelPdf", "manifestId", "despatchedAt",
    ]
    for (const f of fields) {
      if (body[f] !== undefined) data[f] = body[f]
    }

    const parcel = await prisma.parcel.update({ where: { id }, data })
    return NextResponse.json(parcel)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    await prisma.parcel.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
