import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { matchLift, suggest } from "@/lib/jordan-gym"
import { allLifts, getProfile, historyFor, missingTable, personOf } from "@/lib/jordan-gym-db"

// /api/jordan/gym/history — what he has actually lifted.
//
// ⚠ PBs are DERIVED here, every time, never cached in a table. Correct one mistyped set and a
// cached PB is a lie that outlives the correction.
//
// ?slug=  → one lift: its sessions, its bests, and today's suggestion (used when a machine is
//           taken and he swaps mid-session, so a substitute still gets a proper suggested weight).
// no slug → the main lifts' bests and the recent sessions, for the History panel.
export async function GET(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: "Couldn't open the profile" }, { status: 500 })
    const person = personOf(profile)
    const lifts = await allLifts()
    const q = req.nextUrl.searchParams
    const slug = q.get("slug")

    if (slug) {
      const lift = matchLift(slug, lifts)
      if (!lift?.id) return NextResponse.json({ error: "Unknown exercise" }, { status: 404 })
      const int = (k: string, dflt: number) => {
        const n = Math.round(Number(q.get(k)))
        return Number.isFinite(n) && n > 0 ? n : dflt
      }
      const ex = { sets: int("sets", 3), repLow: int("repLow", 8), repHigh: int("repHigh", 12), rir: int("rir", 2) }
      const hist = (await historyFor([lift.id])).get(lift.id) ?? []
      const [heaviest, bestE1] = await Promise.all([
        prisma.jordanSet.findFirst({ where: { liftId: lift.id, warmup: false }, orderBy: { weightKg: "desc" }, select: { weightKg: true, reps: true, loggedAt: true } }),
        prisma.jordanSet.findFirst({ where: { liftId: lift.id, warmup: false, est1rm: { not: null } }, orderBy: { est1rm: "desc" }, select: { est1rm: true, loggedAt: true } }),
      ])
      return NextResponse.json({
        lift,
        sessions: hist.slice(0, 12),
        pbs: { heaviest, bestE1 },
        suggestion: suggest(ex, lift, hist, person.goal, Date.now()),
      })
    }

    const mains = lifts.filter(l => l.main && l.id).map(l => l.id!)
    const [bests, recent, lastSets] = await Promise.all([
      // One query per main lift would be a round trip each; this is one, ordered, then reduced.
      // ⚠ Ordered on WEIGHT, not est1rm: est1rm is null on anything over 10 reps and Postgres
      // sorts NULLs FIRST on a DESC — the "best" would have been a set with no estimate at all.
      prisma.jordanSet.findMany({
        where: { liftId: { in: mains }, warmup: false },
        orderBy: [{ liftId: "asc" }, { weightKg: "desc" }, { reps: "desc" }],
        select: { liftId: true, weightKg: true, reps: true, est1rm: true, loggedAt: true },
        take: 400,
      }),
      prisma.jordanWorkout.findMany({
        where: { profileId: profile.id, status: "DONE" },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
          id: true, dayKey: true, startedAt: true, finishedAt: true, feeling: true, bodyweightKg: true,
          sets: { where: { warmup: false }, select: { weightKg: true, reps: true, liftId: true } },
        },
      }),
      prisma.jordanSet.findMany({
        where: { warmup: false },
        orderBy: { loggedAt: "desc" },
        take: 1,
        select: { loggedAt: true },
      }),
    ])

    const byLift = new Map<string, { weightKg: number; reps: number; est1rm: number | null; loggedAt: Date }>()
    for (const s of bests) if (!byLift.has(s.liftId)) byLift.set(s.liftId, s)

    return NextResponse.json({
      pbs: lifts.filter(l => l.id && byLift.has(l.id)).map(l => ({ lift: l, best: byLift.get(l.id!) })),
      sessions: recent.map(w => ({
        id: w.id, dayKey: w.dayKey, startedAt: w.startedAt, finishedAt: w.finishedAt,
        feeling: w.feeling, bodyweightKg: w.bodyweightKg,
        sets: w.sets.length,
        // Tonnage — a blunt number, but it is the one that answers "was that a big session?".
        volumeKg: Math.round(w.sets.reduce((a, s) => a + s.weightKg * s.reps, 0)),
      })),
      lastLoggedAt: lastSets[0]?.loggedAt ?? null,
    })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ pbs: [], sessions: [], needsMigration: true })
    console.error("jordan/gym/history GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
