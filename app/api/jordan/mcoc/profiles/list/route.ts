import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"

// GET /api/jordan/mcoc/profiles/list — champion profiles.
// Default is SLIM (no abilities json — used by the instant-counter lookup);
// ?full=1 includes the abilities breakdown (used by the Champion DB browse).
export async function GET(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const full = req.nextUrl.searchParams.get("full") === "1"
    const rows = await prisma.mcocChampionProfile.findMany({
      orderBy: { name: "asc" },
      select: {
        name: true, class: true, immunities: true, tags: true, summary: true,
        counters: true, myCounters: true, defenderNotes: true, profileAt: true,
        ...(full ? { abilities: true } : {}),
      },
    })
    return NextResponse.json({ champions: rows })
  } catch (e: any) {
    console.error("jordan/mcoc/profiles/list error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
