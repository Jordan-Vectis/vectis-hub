import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 15

// GET /api/ai-tool-model?slot=<slot>
// Returns the admin-configured default model for one tool slot, so an on-screen
// model picker can start on it (the user can still override per session).
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const slot = req.nextUrl.searchParams.get("slot")?.trim() ?? ""
    if (!slot) return NextResponse.json({ error: "slot required" }, { status: 400 })

    return NextResponse.json({ model: await getToolModel(slot) })
  } catch (e: any) {
    console.error("ai-tool-model GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
