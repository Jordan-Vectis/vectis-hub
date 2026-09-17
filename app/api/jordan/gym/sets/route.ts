import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { est1rm } from "@/lib/jordan-gym"
import { liftInfo, missingTable } from "@/lib/jordan-gym-db"

// /api/jordan/gym/sets — one set, one row. Everything else in this tool is derived from here.
//
// ⚠⚠ UPSERT ON THE PHONE'S OWN clientId. Gym basements have no signal: a request times out, the
// phone retries, and without this there are suddenly six sets of 8 at 100 kg and an estimated-1RM
// PB he never earned. The client mints the id before it sends; the server upserts on it.
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const b = await req.json()
    if (!b.clientId || !b.workoutId || !b.liftId) return NextResponse.json({ error: "Missing set details" }, { status: 400 })

    const workout = await prisma.jordanWorkout.findUnique({ where: { id: String(b.workoutId) } })
    if (!workout) return NextResponse.json({ error: "That session no longer exists" }, { status: 404 })
    const liftRow = await prisma.jordanLift.findUnique({ where: { id: String(b.liftId) } })
    if (!liftRow) return NextResponse.json({ error: "Unknown exercise" }, { status: 404 })
    const lift = liftInfo(liftRow)

    const num = (v: any, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0 }
    const weightKg = Math.round(num(b.weightKg, 0, 600) * 100) / 100
    const reps = Math.round(num(b.reps, 0, 500))
    if (reps < 1) return NextResponse.json({ error: "A set needs at least one rep" }, { status: 400 })
    const warmup = b.warmup === true
    const rirRaw = b.rir === null || b.rir === undefined || b.rir === "" ? null : Math.round(num(b.rir, 0, 10))

    // ⚠ Warm-ups are excluded from PBs and from every progression decision, so they get no e1RM.
    const e1 = warmup ? null : est1rm(weightKg, reps, lift, workout.bodyweightKg)

    const fields = {
      workoutId: workout.id,
      liftId: lift.id!,
      position: Math.round(num(b.position, 0, 99)),
      setNo: Math.max(1, Math.round(num(b.setNo, 1, 99))),
      warmup,
      targetReps: String(b.targetReps ?? "").slice(0, 20),
      targetWeightKg: b.targetWeightKg == null ? null : Math.round(num(b.targetWeightKg, 0, 600) * 100) / 100,
      weightKg, reps, rir: rirRaw, est1rm: e1,
      note: String(b.note ?? "").trim().slice(0, 200),
      // ⚠ The tap time from the PHONE, not the moment the request landed. A set logged in a
      // basement and sent twenty minutes later must keep its real time, or the gaps between rows
      // (which are the rests actually taken) become fiction. Anything absurd falls back to now.
      loggedAt: (() => {
        const t = b.loggedAt ? new Date(b.loggedAt).getTime() : NaN
        const now = Date.now()
        return Number.isFinite(t) && t <= now + 60_000 && t > now - 86_400_000 ? new Date(t) : new Date()
      })(),
    }

    const saved = await prisma.jordanSet.upsert({
      where: { clientId: String(b.clientId) },
      create: { clientId: String(b.clientId), ...fields },
      // An edit (he tapped the wrong number) must recompute the e1RM, never leave the old one —
      // that is exactly how a cached PB becomes a lie that outlives the correction.
      update: fields,
    })

    // Is it a best? Derived every time, never cached.
    let pb: string | null = null
    if (!warmup) {
      const [heaviest, bestAtWeight, bestE1] = await Promise.all([
        prisma.jordanSet.findFirst({
          where: { liftId: lift.id!, warmup: false, id: { not: saved.id } },
          orderBy: { weightKg: "desc" }, select: { weightKg: true },
        }),
        prisma.jordanSet.findFirst({
          where: { liftId: lift.id!, warmup: false, weightKg, id: { not: saved.id } },
          orderBy: { reps: "desc" }, select: { reps: true },
        }),
        lift.main ? prisma.jordanSet.findFirst({
          where: { liftId: lift.id!, warmup: false, id: { not: saved.id }, est1rm: { not: null } },
          orderBy: { est1rm: "desc" }, select: { est1rm: true },
        }) : Promise.resolve(null),
      ])
      if (!heaviest || weightKg > heaviest.weightKg) pb = `Heaviest ever on this — ${weightKg} kg${lift.perHand ? " each" : ""}.`
      else if (!bestAtWeight || reps > bestAtWeight.reps) pb = `Most reps you've done at ${weightKg} kg${lift.perHand ? " each" : ""} — ${reps}.`
      else if (e1 && bestE1?.est1rm != null && e1 > bestE1.est1rm) pb = `Best estimated 1RM on this — about ${Math.round(e1)} kg.`
      else if (e1 && lift.main && !bestE1) pb = `First estimated 1RM on this — about ${Math.round(e1)} kg.`
    }

    return NextResponse.json({ set: saved, pb })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the gym tables aren't there yet." }, { status: 503 })
    console.error("jordan/gym/sets POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

/** Undo. By clientId, so the phone can undo a set it isn't sure ever reached the server. */
export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { clientId } = await req.json()
    if (!clientId) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.jordanSet.deleteMany({ where: { clientId: String(clientId) } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/gym/sets DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
