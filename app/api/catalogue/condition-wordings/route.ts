import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { readWordingLabels } from "@/lib/condition-wordings-db"

export const dynamic = "force-dynamic"

// Read-only list of box/packaging wording presets for the lot editors. Any signed-in user
// can read; editing is admin-only via /admin/condition-wording server actions.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const wordings = await readWordingLabels()
    return NextResponse.json({ wordings })
  } catch (e: any) {
    console.error("catalogue/condition-wordings error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
