import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { createRmOrders, getRmLabel, RM_SERVICE_FORMATS, type RmOrderPayload } from "@/lib/royal-mail"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params

    const parcel = await prisma.parcel.findUnique({
      where: { id },
      include: { lots: { include: { lot: { select: { barcode: true, receiptUniqueId: true, title: true, hammerPrice: true } } } } },
    })
    if (!parcel) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (parcel.status === "DISPATCHED") return NextResponse.json({ error: "Already dispatched" }, { status: 400 })

    const shortRef = parcel.reference.slice(0, 8).toUpperCase()
    const todayDate = new Date().toISOString().split("T")[0] // "YYYY-MM-DD"

    const payload: RmOrderPayload = {
      orderReference:      `VEC-${shortRef}`,
      orderDate:           todayDate,
      subtotal:            0,
      shippingCostCharged: 0,
      total:               0,
      recipient: {
        address: {
          fullName:     parcel.recipientName,
          addressLine1: parcel.recipientLine1,
          city:         parcel.recipientCity,
          postcode:     parcel.recipientPostcode,
          countryCode:  parcel.recipientCountry,
          ...(parcel.recipientCompany ? { companyName: parcel.recipientCompany } : {}),
          ...(parcel.recipientLine2   ? { addressLine2: parcel.recipientLine2 }  : {}),
          ...(parcel.recipientCounty  ? { county: parcel.recipientCounty }       : {}),
        },
        ...(parcel.recipientEmail ? { emailAddress:  parcel.recipientEmail } : {}),
        ...(parcel.recipientPhone ? { phoneNumber:   parcel.recipientPhone } : {}),
      },
      packages: [{
        weightInGrams: parcel.weightInGrams,
        // Parcelforce courier services use "Parcel"; Royal Mail tracked/SD use "SmallParcel"
        packageFormatIdentifier: ["FEO", "FEM", "NDA"].includes(parcel.serviceCode)
          ? "Parcel"
          : "SmallParcel",
      }],
      billing: {
        address: {
          fullName:     parcel.recipientName,
          addressLine1: parcel.recipientLine1,
          city:         parcel.recipientCity,
          postcode:     parcel.recipientPostcode,
          countryCode:  parcel.recipientCountry,
          ...(parcel.recipientCompany ? { companyName: parcel.recipientCompany } : {}),
          ...(parcel.recipientLine2   ? { addressLine2: parcel.recipientLine2 }  : {}),
          ...(parcel.recipientCounty  ? { county: parcel.recipientCounty }       : {}),
        },
      },
      postageDetails: {
        serviceCode: parcel.serviceCode,
      },
      ...(parcel.specialInstructions ? { specialInstructions: parcel.specialInstructions } : {}),
    }

    // Create order in Click & Drop
    let rmResponse: any
    try {
      rmResponse = await createRmOrders([payload])
    } catch (rmErr: any) {
      console.error("[label] RM error:", rmErr.message)
      return NextResponse.json({
        error:   rmErr.message,
        payload, // show exactly what was sent
      }, { status: 502 })
    }

    const createdOrder = rmResponse?.createdOrders?.[0]
    if (!createdOrder?.orderIdentifier) {
      return NextResponse.json({ error: "Royal Mail did not return an order identifier", detail: rmResponse, payload }, { status: 502 })
    }

    // Fetch label PDF
    const pdfBuffer = await getRmLabel(createdOrder.orderIdentifier)
    const base64Pdf = Buffer.from(pdfBuffer).toString("base64")

    // Save to DB
    const updated = await prisma.parcel.update({
      where: { id },
      data: {
        rmOrderIdentifier: String(createdOrder.orderIdentifier),
        trackingNumber:    createdOrder.trackingNumber ?? null,
        labelPdf:          base64Pdf,
        status:            "LABEL_CREATED",
      },
    })

    return NextResponse.json({
      ok:                true,
      rmOrderIdentifier: updated.rmOrderIdentifier,
      trackingNumber:    updated.trackingNumber,
      labelPdf:          updated.labelPdf,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/** GET — return stored label PDF */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    const parcel = await prisma.parcel.findUnique({ where: { id }, select: { labelPdf: true } })
    if (!parcel?.labelPdf) return NextResponse.json({ error: "No label" }, { status: 404 })

    const buf = Buffer.from(parcel.labelPdf, "base64")
    return new NextResponse(buf, {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": "inline; filename=label.pdf",
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
