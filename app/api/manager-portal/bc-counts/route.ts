import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBcSaleCounts } from "@/lib/bc-sale-counts"

export const maxDuration = 120

// GET /api/manager-portal/bc-counts
//
// Per-sale BC lot counts for the Manager Portal. The work itself lives in
// lib/bc-sale-counts.ts because the Dashboard's sale-progress widget needs the
// same figures — one implementation, so the two can't disagree about a sale.
//
// Returns { connected:false } (HTTP 200) when there is no BC token, so the page
// still renders its Hub-side stats. A per-sale failure yields null → shown as "—".

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    return NextResponse.json(await getBcSaleCounts())
  } catch (e: any) {
    console.error("manager-portal/bc-counts error:", e)
    return NextResponse.json({ error: e?.message ?? "BC query failed" }, { status: 500 })
  }
}
