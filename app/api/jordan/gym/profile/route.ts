import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { EXPERIENCE } from "@/lib/jordan-gym"
import { allLifts, getProfile, missingTable, personOf } from "@/lib/jordan-gym-db"

// /api/jordan/gym/profile — the one training profile, the exercise catalogue, and enough of the
// current state for the screen to open on the right thing (an unfinished session, the block
// that is running). Locked to jordan.orange; everyone else gets a 404, as if it didn't exist.
export async function GET() {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: "Couldn't open the profile" }, { status: 500 })

    const [lifts, mealProfiles, programme, open, recent] = await Promise.all([
      allLifts(),
      prisma.jordanMealProfile.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, goal: true } }),
      prisma.jordanProgramme.findFirst({ where: { profileId: profile.id, endedAt: null }, orderBy: { createdAt: "desc" } }),
      // ⚠ An unfinished session is the first thing the screen must offer — a locked phone or a
      // closed tab must never lose a workout that is half done.
      prisma.jordanWorkout.findFirst({
        where: { profileId: profile.id, status: "IN_PROGRESS" },
        orderBy: { startedAt: "desc" },
        select: { id: true, dayKey: true, startedAt: true, programmeId: true, weekNo: true },
      }),
      prisma.jordanWorkout.findMany({
        where: { profileId: profile.id, status: { not: "ABANDONED" } },
        orderBy: { startedAt: "desc" },
        take: 12,
        select: {
          id: true, dayKey: true, status: true, startedAt: true, finishedAt: true,
          bodyweightKg: true, feeling: true, _count: { select: { sets: true } },
        },
      }),
    ])

    return NextResponse.json({
      profile: {
        id: profile.id, mealProfileId: profile.mealProfileId,
        daysPerWeek: profile.daysPerWeek, sessionMinutes: profile.sessionMinutes,
        experience: profile.experience, equipment: profile.equipment,
        injuries: profile.injuries, preferences: profile.preferences,
        barKg: profile.barKg, plates: profile.plates,
      },
      person: personOf(profile),
      mealProfiles,
      lifts,
      programme: programme ? { id: programme.id, title: programme.title, startedAt: programme.startedAt } : null,
      openWorkout: open,
      recent: recent.map(w => ({ ...w, sets: w._count.sets, _count: undefined })),
    })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ profile: null, needsMigration: true, lifts: [], mealProfiles: [], recent: [] })
    console.error("jordan/gym/profile GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

const int = (v: any, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}
const str = (v: any, max = 4000) => (v === undefined ? undefined : String(v ?? "").trim().slice(0, max))

export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const b = await req.json()
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: "Couldn't open the profile" }, { status: 500 })

    const data: Record<string, unknown> = {}
    const put = (k: string, v: unknown) => { if (v !== undefined) data[k] = v }
    // "" clears the link deliberately — then the goal falls back to maintain and the screen says so.
    if (b.mealProfileId !== undefined) data.mealProfileId = b.mealProfileId ? String(b.mealProfileId) : null
    if (b.daysPerWeek !== undefined) data.daysPerWeek = int(b.daysPerWeek, 1, 7, 4)
    if (b.sessionMinutes !== undefined) data.sessionMinutes = int(b.sessionMinutes, 15, 180, 60)
    if (b.experience !== undefined) data.experience = EXPERIENCE.some(e => e.key === b.experience) ? b.experience : "intermediate"
    put("equipment", str(b.equipment)); put("injuries", str(b.injuries)); put("preferences", str(b.preferences))
    if (b.barKg !== undefined) { const n = Number(b.barKg); data.barKg = Number.isFinite(n) && n >= 0 && n <= 50 ? n : 20 }
    if (b.plates !== undefined) data.plates = String(b.plates ?? "").replace(/[^0-9.,\s]/g, "").slice(0, 120)

    await prisma.jordanGymProfile.update({ where: { id: profile.id }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the gym tables aren't there yet." }, { status: 503 })
    console.error("jordan/gym/profile PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
