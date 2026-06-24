import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { readCategoryMap } from "@/lib/lot-categories-db"

export const dynamic = "force-dynamic"

// Read-only category → subcategory map for the cataloguing dropdowns. Any signed-in
// user can read; editing is admin-only via /admin/categories server actions.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const map = await readCategoryMap()
    return NextResponse.json({ map })
  } catch (e: any) {
    console.error("catalogue/categories error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
