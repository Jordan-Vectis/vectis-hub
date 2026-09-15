import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { normaliseShopping, planOut } from "@/lib/jordan-meals"

// /api/jordan/meals/plans — the saved plans of one profile. Making a plan is
// /api/jordan/meals/plan; this lists, renames, keeps the shopping ticks, and deletes.
function missingTable(e: any): boolean {
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(String(e?.message ?? e))
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const profileId = req.nextUrl.searchParams.get("profileId") ?? ""
    if (!profileId) return NextResponse.json({ plans: [] })
    const rows = await prisma.jordanMealPlan.findMany({ where: { profileId }, orderBy: { createdAt: "desc" } })
    return NextResponse.json({ plans: rows.map(planOut) })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ plans: [] })
    console.error("jordan/meals/plans GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id, title, shopping } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.jordanMealPlan.update({
      where: { id: String(id) },
      data: {
        ...(title !== undefined ? { title: String(title ?? "").trim().slice(0, 120) } : {}),
        // The ticks come back as the whole list — simplest, and a tick on a phone in the shop
        // must never race an earlier one into overwriting it, so the client sends the latest.
        ...(shopping !== undefined ? { shopping: (shopping ? normaliseShopping(shopping) : null) as any } : {}),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/meals/plans PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.jordanMealPlan.delete({ where: { id: String(id) } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/meals/plans DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
