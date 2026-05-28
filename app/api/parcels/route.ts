import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const status = req.nextUrl.searchParams.get("status")
    const search = req.nextUrl.searchParams.get("search") ?? ""

    const parcels = await prisma.parcel.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search ? {
          OR: [
            { recipientName:     { contains: search, mode: "insensitive" } },
            { recipientPostcode: { contains: search, mode: "insensitive" } },
            { reference:        { contains: search, mode: "insensitive" } },
            { trackingNumber:   { contains: search, mode: "insensitive" } },
          ],
        } : {}),
      },
      include: {
        lots: {
          include: { lot: { select: { id: true, barcode: true, receiptUniqueId: true, title: true, auction: { select: { code: true } } } } },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(parcels)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const {
      recipientName, recipientCompany, recipientLine1, recipientLine2,
      recipientCity, recipientCounty, recipientPostcode, recipientEmail, recipientPhone,
      weightInGrams, packageFormat, serviceCode, specialInstructions, notes,
      customerAccountId, lotIds,
    } = body

    if (!recipientName || !recipientLine1 || !recipientCity || !recipientPostcode) {
      return NextResponse.json({ error: "Recipient name, address line 1, city and postcode are required" }, { status: 400 })
    }

    const parcel = await prisma.parcel.create({
      data: {
        recipientName,
        recipientCompany:  recipientCompany  || null,
        recipientLine1,
        recipientLine2:    recipientLine2    || null,
        recipientCity,
        recipientCounty:   recipientCounty   || null,
        recipientPostcode,
        recipientEmail:    recipientEmail    || null,
        recipientPhone:    recipientPhone    || null,
        weightInGrams:     parseInt(weightInGrams) || 500,
        packageFormat:     packageFormat     || "Parcel",
        serviceCode:       serviceCode       || "TPP48",
        specialInstructions: specialInstructions || null,
        notes:             notes             || null,
        customerAccountId: customerAccountId || null,
        createdByName:     session.user.name ?? null,
        lots: lotIds?.length
          ? { create: (lotIds as string[]).map(lotId => ({ lotId })) }
          : undefined,
      },
      include: {
        lots: { include: { lot: { select: { id: true, barcode: true, receiptUniqueId: true, title: true, auction: { select: { code: true } } } } } },
      },
    })

    return NextResponse.json(parcel)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
