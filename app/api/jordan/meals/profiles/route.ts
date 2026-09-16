import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { GOAL_KEYS, deltaFor, goalDef } from "@/lib/jordan-meals"

// /api/jordan/meals/profiles — one profile per person: their numbers, targets and likes.
// Locked to jordan.orange; everyone else gets a 404, as if it didn't exist.
//
// ⚠ The tables arrive with Run Migrations while the code deploys instantly, so
// every read tolerates them being absent rather than 500ing the page.
function missingTable(e: any): boolean {
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(String(e?.message ?? e))
}

const SEXES = ["male", "female"]
const ACTIVITIES = ["sedentary", "light", "moderate", "active", "very"]

/** undefined = not sent (leave alone); "" or a bad number = null (cleared). */
const optNum = (v: any, lo: number, hi: number): number | null | undefined => {
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null
}
const int = (v: any, lo: number, hi: number, fallback: number): number | undefined => {
  if (v === undefined) return undefined
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback
}
const str = (v: any, max = 4000) => (v === undefined ? undefined : String(v ?? "").trim().slice(0, max))

export async function GET() {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const rows = await prisma.jordanMealProfile.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { plans: true } } },
    })
    return NextResponse.json({
      profiles: rows.map(({ _count, ...r }) => ({ ...r, plans: _count.plans })),
    })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ profiles: [], needsMigration: true })
    console.error("jordan/meals/profiles GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { name } = await req.json()
    if (!String(name ?? "").trim()) return NextResponse.json({ error: "Give the profile a name" }, { status: 400 })
    const row = await prisma.jordanMealProfile.create({ data: { name: String(name).trim().slice(0, 80) } })
    return NextResponse.json({ id: row.id })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the meal planner tables aren't there yet." }, { status: 503 })
    console.error("jordan/meals/profiles POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    // Only fields actually sent are touched — undefined means "not in the payload".
    const data: Record<string, unknown> = {}
    const put = (k: string, v: unknown) => { if (v !== undefined) data[k] = v }
    put("name", str(b.name, 80))
    if (b.sex !== undefined) data.sex = SEXES.includes(b.sex) ? b.sex : "male"
    if (b.activity !== undefined) data.activity = ACTIVITIES.includes(b.activity) ? b.activity : "light"
    put("age", optNum(b.age, 10, 120))
    put("heightCm", optNum(b.heightCm, 100, 250))
    put("weightKg", optNum(b.weightKg, 30, 350))
    // ⚠ The goal and the calorie gap are saved as a PAIR. A delta the goal doesn't offer is
    // corrected to that goal's own default — "Build muscle" must never carry a deficit over
    // from "Lose weight", whatever reaches the route.
    if (b.goal !== undefined) {
      const goal = GOAL_KEYS.includes(b.goal) ? b.goal : "lose"
      data.goal = goal
      data.goalDelta = deltaFor(goal, int(b.goalDelta, -1000, 1000, goalDef(goal).defaultDelta) ?? goalDef(goal).defaultDelta)
    } else {
      put("goalDelta", int(b.goalDelta, -1000, 1000, -500))
    }
    put("kcalOverride", optNum(b.kcalOverride, 800, 6000))
    put("proteinPct", int(b.proteinPct, 0, 100, 30))
    put("carbsPct", int(b.carbsPct, 0, 100, 40))
    put("fatPct", int(b.fatPct, 0, 100, 30))
    put("mealsPerDay", int(b.mealsPerDay, 1, 6, 3))
    put("likes", str(b.likes)); put("dislikes", str(b.dislikes)); put("notes", str(b.notes))

    await prisma.jordanMealProfile.update({ where: { id: String(b.id) }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/meals/profiles PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    // Plans cascade with the profile (schema onDelete: Cascade).
    await prisma.jordanMealProfile.delete({ where: { id: String(id) } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/meals/profiles DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
