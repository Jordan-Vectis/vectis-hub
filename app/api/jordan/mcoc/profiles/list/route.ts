import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"

// GET /api/jordan/mcoc/profiles/list — all champion profiles for the browse view.
export async function GET() {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const rows = await prisma.mcocChampionProfile.findMany({
      orderBy: { name: "asc" },
      select: { name: true, class: true, immunities: true, tags: true, summary: true, profileAt: true },
    })
    return NextResponse.json({ champions: rows })
  } catch (e: any) {
    console.error("jordan/mcoc/profiles/list error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
