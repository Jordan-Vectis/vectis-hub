import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCustomersUser } from "@/lib/customers/access"
import { notesFor } from "@/lib/customers/queries"

export const dynamic = "force-dynamic"

// What the list's preview drawer needs beyond the row itself: the latest notes and the ID / approval
// status off BC's contact card. CUSTOMERS access, read fresh — the proxy skips every /api address.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await getCustomersUser()
    if (!me) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    const c = await prisma.customer.findUnique({ where: { id }, select: { id: true, address: true, address2: true, city: true, county: true, postCode: true, bcCreatedAt: true } })
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const [notes, card] = await Promise.all([
      notesFor(id, 3),
      prisma.customerBcCard.findUnique({ where: { customerId: id }, select: { contactCard: true } }).catch(() => null),
    ])
    const cc = (card?.contactCard ?? null) as Record<string, unknown> | null
    const str = (k: string) => { const v = cc?.[k]; return v == null || v === "" || (typeof v === "string" && /^0001-01-01/.test(v)) ? null : String(v) }
    return NextResponse.json({
      address: [c.address, c.address2, c.city, c.county, c.postCode].filter(Boolean).join(", ") || null,
      since: c.bcCreatedAt,
      notesReady: notes !== null,
      notes: (notes ?? []).map(n => ({ id: n.id, kind: n.kind, text: n.text, byName: n.byName, createdAt: n.createdAt, followUpAt: n.followUpAt, followUpDone: n.followUpDone })),
      idStatus: str("EVA_IDCheckedStatus"),
      idChecked: str("EVA_DateChecked"),
      approvedBuy: cc?.EVA_Approved === true,
      approvedSell: cc?.EVA_VendorApproved === true,
      highRisk: cc?.EVA_HighRisk === true,
      cardReady: !!cc,
    })
  } catch (e: any) {
    console.error("customer summary error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
