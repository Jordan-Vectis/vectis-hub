import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { type Programme } from "@/lib/jordan-gym"
import { getProfile, missingTable, personOf, planDay } from "@/lib/jordan-gym-db"

// /api/jordan/gym/workout — start, resume and finish a session.
//
// ⚠ Sets are NOT pre-created. A JordanSet row means "this was actually lifted"; what was asked
// for lives on the programme and is carried onto each row as targetReps/targetWeightKg when it
// is logged. A table of planned-but-unperformed rows is how a log starts lying.

/** Which week of the block this is — from the programme's own start, not the calendar. */
const weekOf = (startedAt: Date, nowMs: number) => Math.max(1, Math.floor((nowMs - startedAt.getTime()) / (7 * 86_400_000)) + 1)

async function dayFor(programmeId: string | null, dayKey: string, goal: any, nowMs: number) {
  if (!programmeId) return { plan: [], programme: null as any }
  const programme = await prisma.jordanProgramme.findUnique({ where: { id: programmeId } })
  if (!programme) return { plan: [], programme: null as any }
  const plan = (programme.plan && typeof programme.plan === "object" ? programme.plan : {}) as unknown as Programme
  // ⚠ A named day that doesn't match anything gets an EMPTY session, never day one's exercises —
  // silently loading the wrong workout is worse than an empty one he can fill himself.
  const day = dayKey ? (plan.days ?? []).find(d => d.name === dayKey) : (plan.days ?? [])[0]
  if (!day) return { plan: [], programme }
  return { plan: await planDay(day, goal, nowMs), programme }
}

/** POST — start a session. Body: { dayKey?, programmeId?, bodyweightKg? }. No programme = an
 *  off-plan session, which is allowed and common (the gym is busy, he fancies something else). */
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { dayKey = "", programmeId = null, bodyweightKg = null, offPlan = false } = await req.json()

    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: "Couldn't open the profile" }, { status: 500 })
    const person = personOf(profile)
    const now = Date.now()

    // ⚠ One unfinished session at a time. Anything older than 12 hours was a session he walked
    // away from, not one he is still doing — abandon it rather than carrying it forever.
    const open = await prisma.jordanWorkout.findFirst({
      where: { profileId: profile.id, status: "IN_PROGRESS" }, orderBy: { startedAt: "desc" },
    })
    if (open) {
      if (now - open.startedAt.getTime() < 12 * 3_600_000) {
        const { plan } = await dayFor(open.programmeId, open.dayKey, person.goal, now)
        const sets = await prisma.jordanSet.findMany({ where: { workoutId: open.id }, orderBy: { loggedAt: "asc" } })
        return NextResponse.json({ workout: open, plan, sets, resumed: true })
      }
      await prisma.jordanWorkout.update({ where: { id: open.id }, data: { status: "ABANDONED", finishedAt: new Date() } })
    }

    // ⚠ An off-plan session belongs to NO programme — attaching it to the open block would put
    // work he improvised into the record of how that block went.
    const prog = offPlan ? null
      : programmeId ? await prisma.jordanProgramme.findUnique({ where: { id: String(programmeId) } })
      : await prisma.jordanProgramme.findFirst({ where: { profileId: profile.id, endedAt: null }, orderBy: { createdAt: "desc" } })

    const bw = Number(bodyweightKg)
    const workout = await prisma.jordanWorkout.create({
      data: {
        profileId: profile.id,
        programmeId: prog?.id ?? null,
        dayKey: String(dayKey ?? "").slice(0, 60),
        weekNo: prog ? weekOf(prog.startedAt, now) : 1,
        bodyweightKg: Number.isFinite(bw) && bw > 20 && bw < 350 ? bw : (person.weightKg ?? null),
      },
    })
    const { plan } = await dayFor(prog?.id ?? null, String(dayKey ?? ""), person.goal, now)
    return NextResponse.json({ workout, plan, sets: [], resumed: false })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the gym tables aren't there yet." }, { status: 503 })
    console.error("jordan/gym/workout POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

/** GET ?id= — resume a session exactly where it was, suggestions and all. */
export async function GET(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const id = req.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: "Couldn't open the profile" }, { status: 500 })
    const workout = await prisma.jordanWorkout.findUnique({ where: { id } })
    if (!workout) return NextResponse.json({ error: "That session no longer exists" }, { status: 404 })

    const person = personOf(profile)
    const { plan } = await dayFor(workout.programmeId, workout.dayKey, person.goal, Date.now())
    const sets = await prisma.jordanSet.findMany({
      where: { workoutId: workout.id },
      orderBy: { loggedAt: "asc" },
      include: { lift: { select: { slug: true, name: true, perHand: true } } },
    })
    return NextResponse.json({ workout, plan, sets })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the gym tables aren't there yet." }, { status: 503 })
    console.error("jordan/gym/workout GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

/** PUT — finish it, abandon it, or add the one-tap how-did-it-feel. */
export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const data: Record<string, unknown> = {}
    if (b.status === "DONE" || b.status === "ABANDONED") { data.status = b.status; data.finishedAt = new Date() }
    if (b.feeling !== undefined) {
      const n = Math.round(Number(b.feeling))
      data.feeling = Number.isFinite(n) && n >= 1 && n <= 5 ? n : null
    }
    if (b.notes !== undefined) data.notes = String(b.notes ?? "").trim().slice(0, 2000)
    if (b.enteredLate !== undefined) data.enteredLate = b.enteredLate === true
    if (b.bodyweightKg !== undefined) {
      const n = Number(b.bodyweightKg)
      data.bodyweightKg = Number.isFinite(n) && n > 20 && n < 350 ? n : null
    }
    await prisma.jordanWorkout.update({ where: { id: String(b.id) }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/gym/workout PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.jordanWorkout.delete({ where: { id: String(id) } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/gym/workout DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
