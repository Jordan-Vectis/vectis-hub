import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"

// GET /api/jordan/mcoc/profiles/status — Champion DB counts for the build UI.
export async function GET() {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const [total, profiled] = await Promise.all([
      prisma.mcocChampionProfile.count(),
      prisma.mcocChampionProfile.count({ where: { profileAt: { not: null } } }),
    ])
    return NextResponse.json({ total, profiled, unbuilt: total - profiled })
  } catch (e: any) {
    console.error("jordan/mcoc/profiles/status error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
