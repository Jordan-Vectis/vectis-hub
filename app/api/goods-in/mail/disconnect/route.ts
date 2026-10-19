import { NextResponse } from "next/server"
import { disconnect } from "@/lib/goods-in/mail"
import { failure, gate } from "../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/goods-in/mail/disconnect → { ok: true } — Warehouse admins only. Forgets the stored
// mailbox sign-in; receipts can't be emailed from the Hub until someone connects again (they can
// still be printed, or downloaded and emailed by hand).
export async function POST() {
  try {
    const g = await gate("admin")
    if (g.res) return g.res
    await disconnect()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return failure("mail disconnect", e)
  }
}
