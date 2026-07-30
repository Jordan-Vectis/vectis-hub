import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCToken } from "@/lib/bc"
import { computeBcToteDates } from "@/lib/bc-tote-dates"

export const maxDuration = 120

// GET /api/manager-portal/bc-tote-dates
//
// Powers the Manager Portal → Departments "Using totes from — Business Central
// categories" table. ⚠ All the BC work lives in lib/bc-tote-dates.ts, shared with
// the PDF export (…/pdf) so the two can never disagree — read the header there
// before changing anything about which endpoints are used or how dates are found.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const isAdmin = session.user.role === "ADMIN"

    // Categories an admin has hidden (display-only, restorable). ⚠ The table
    // arrives with Run Migrations while code deploys instantly, so a missing
    // table must read as "nothing hidden" — never a 500.
    let hidden: { category: string; hiddenByName: string }[] = []
    try {
      hidden = await prisma.managerPortalHiddenCategory.findMany({
        select:  { category: true, hiddenByName: true },
        orderBy: { category: "asc" },
      })
    } catch { hidden = [] }

    const token = await getBCToken()
    if (!token) return NextResponse.json({ connected: false, categories: [], hidden, isAdmin })

    const { categories, diagnostics } = await computeBcToteDates(
      token,
      new Set(hidden.map(h => h.category)),
    )

    return NextResponse.json({ connected: true, categories, hidden, isAdmin, diagnostics })
  } catch (e: unknown) {
    console.error("manager-portal/bc-tote-dates error:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "BC query failed" }, { status: 500 })
  }
}
