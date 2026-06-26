import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken } from "@/lib/bc"
import { computeShippingAnalytics } from "@/lib/shipping-analytics"

export const maxDuration = 300

// GET /api/bc/shipping?from=YYYY-MM-DD&to=YYYY-MM-DD
// Shipping analytics for the BC Reports → Shipping tab: parcels by country /
// region, parcel-size breakdown, and estimated shipping revenue (country × size
// joined via the collection number, priced from the Vectis rate sheet).
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const from = searchParams.get("from") ?? ""
    const to   = searchParams.get("to")   ?? ""
    if (!from || !to) return NextResponse.json({ error: "Missing from/to" }, { status: 400 })

    const data = await computeShippingAnalytics(token, from, to)
    return NextResponse.json(data)
  } catch (e: any) {
    console.error("bc/shipping error:", e)
    return NextResponse.json({ error: e?.message ?? "Shipping report failed" }, { status: 500 })
  }
}
