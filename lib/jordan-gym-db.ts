import { prisma } from "@/lib/prisma"
import {
  LIFT_SEED, liftFromSeed, matchLift, slugify, suggest, buildDigest,
  type LiftInfo, type LiftSession, type Programme, type ProgrammeDay, type Suggestion, type GoalKey,
} from "@/lib/jordan-gym"

// Server-side helpers for the /jordan gym tool. They live here rather than in a route file
// because a Next route file may only export its HTTP handlers, and five routes need these.
//
// ⚠ The tables arrive with Run Migrations while the code deploys instantly, so every read
// tolerates them being absent rather than 500ing the page — same as the meal planner.
export function missingTable(e: any): boolean {
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(String(e?.message ?? e))
}

/** The one profile. Created on first visit so nothing has to be set up before use. */
export async function getProfile() {
  const found = await prisma.jordanGymProfile.findFirst({ include: { mealProfile: true } })
  if (found) return found
  const made = await prisma.jordanGymProfile.create({ data: {} })
  return prisma.jordanGymProfile.findUnique({ where: { id: made.id }, include: { mealProfile: true } })
}

/** Everything the plan and the maths need about the person, read THROUGH the meal profile so the
 *  goal can never drift from the one he set in the meal planner. */
export function personOf(p: { mealProfile: any | null }) {
  const m = p.mealProfile
  return {
    name: m?.name ?? "Jordan",
    sex: m?.sex ?? "male",
    age: m?.age ?? null,
    weightKg: m?.weightKg ?? null,
    goal: ((m?.goal ?? "maintain") as GoalKey),
    goalDelta: m?.goalDelta ?? 0,
  }
}

export const liftInfo = (r: {
  id: string; slug: string; name: string; aliases: string[]; pattern: string; muscles: string[]
  equipment: string; incrementKg: number; perHand: boolean; bodyweight: boolean; restSec: number; main: boolean
}): LiftInfo => ({
  id: r.id, slug: r.slug, name: r.name, aliases: r.aliases, pattern: r.pattern, muscles: r.muscles,
  equipment: r.equipment, incrementKg: r.incrementKg, perHand: r.perHand, bodyweight: r.bodyweight,
  restSec: r.restSec, main: r.main,
})

/** The catalogue, seeded from LIFT_SEED the first time it is needed (the AiPreset pattern:
 *  seed only when the table is completely empty, so a deleted lift never comes back). */
export async function allLifts(): Promise<LiftInfo[]> {
  const rows = await prisma.jordanLift.findMany({ orderBy: { name: "asc" } })
  if (rows.length) return rows.map(liftInfo)
  await prisma.jordanLift.createMany({
    data: LIFT_SEED.map(s => ({
      slug: s.slug, name: s.name, aliases: s.aliases, pattern: s.pattern, muscles: s.muscles,
      equipment: s.equipment, incrementKg: s.incrementKg, perHand: !!s.perHand,
      bodyweight: !!s.bodyweight, restSec: s.restSec, main: !!s.main,
    })),
    skipDuplicates: true,
  })
  return (await prisma.jordanLift.findMany({ orderBy: { name: "asc" } })).map(liftInfo)
}

/** The lift a programme exercise means, creating it only when nothing in the catalogue matches.
 *  ⚠ Alias matching happens FIRST (matchLift) — creating a twin for "DB incline press" is how a
 *  gym log quietly loses its history. A lift that IS created is reported back so the screen can
 *  say so: new, but never silent. */
export async function resolveLift(
  ex: { slug: string; name: string; pattern: string; equipment: string; restSeconds: number },
  lifts: LiftInfo[],
): Promise<{ lift: LiftInfo; created: boolean }> {
  const hit = matchLift(ex.slug, lifts) ?? matchLift(ex.name, lifts)
  if (hit) return { lift: hit, created: false }
  const equipment = ex.equipment || "barbell"
  // The increment comes from the KIT, not a percentage: a bar moves in pairs of the smallest
  // plate, a dumbbell jumps to the next pair, a pin stack moves a pin.
  const increment = equipment === "machine" || equipment === "cable" ? 5
    : equipment === "dumbbell" ? 2.5
    : /squat|hinge|lunge/.test(ex.pattern) ? 5 : 2.5
  const row = await prisma.jordanLift.create({
    data: {
      slug: slugify(ex.slug || ex.name), name: ex.name || ex.slug, aliases: [],
      pattern: ex.pattern, muscles: [], equipment,
      incrementKg: increment, perHand: equipment === "dumbbell",
      bodyweight: equipment === "bodyweight", restSec: ex.restSeconds || 120, main: false,
    },
  })
  return { lift: liftInfo(row), created: true }
}

/** Every set of the given lifts, newest first, grouped into sessions (one per gym visit).
 *  ⚠ Grouped by WORKOUT, not by day — two sessions in one day are two sessions. */
export async function historyFor(liftIds: string[], take = 600): Promise<Map<string, LiftSession[]>> {
  const out = new Map<string, LiftSession[]>()
  if (!liftIds.length) return out
  const rows = await prisma.jordanSet.findMany({
    where: { liftId: { in: liftIds } },
    orderBy: { loggedAt: "desc" },
    take,
    select: {
      liftId: true, workoutId: true, weightKg: true, reps: true, rir: true, warmup: true, loggedAt: true,
    },
  })
  const keyed = new Map<string, { at: string; sets: any[] }>()
  for (const r of rows) {
    const key = `${r.liftId}::${r.workoutId}`
    let s = keyed.get(key)
    if (!s) {
      s = { at: r.loggedAt.toISOString(), sets: [] }
      keyed.set(key, s)
      const list = out.get(r.liftId) ?? []
      list.push(s)
      out.set(r.liftId, list)
    }
    // Rows arrive newest-first; a session's sets read better oldest-first.
    s.sets.unshift({ weightKg: r.weightKg, reps: r.reps, rir: r.rir, warmup: r.warmup })
  }
  return out
}

export type DayPlan = {
  slug: string; liftId: string; name: string; pattern: string; equipment: string
  sets: number; repLow: number; repHigh: number; rir: number; restSeconds: number
  note: string; substitute: string
  perHand: boolean; bodyweight: boolean; incrementKg: number; main: boolean
  suggestion: Suggestion
  newLift: boolean
}

/** Today's session, exercise by exercise, with the weight worked out from his own log.
 *  ⚠ `nowMs` is passed in so the server and the phone can never disagree by a day. */
export async function planDay(day: ProgrammeDay, goal: GoalKey, nowMs: number): Promise<DayPlan[]> {
  const lifts = await allLifts()
  const resolved: { ex: any; lift: LiftInfo; created: boolean }[] = []
  for (const ex of day.exercises) {
    const { lift, created } = await resolveLift(ex, lifts)
    if (created) lifts.push(lift)
    resolved.push({ ex, lift, created })
  }
  const hist = await historyFor(resolved.map(r => r.lift.id!).filter(Boolean))
  return resolved.map(({ ex, lift, created }) => ({
    slug: lift.slug, liftId: lift.id!, name: lift.name, pattern: lift.pattern, equipment: lift.equipment,
    sets: ex.sets, repLow: ex.repLow, repHigh: ex.repHigh, rir: ex.rir, restSeconds: ex.restSeconds || lift.restSec,
    note: ex.note, substitute: ex.substitute,
    perHand: lift.perHand, bodyweight: lift.bodyweight, incrementKg: lift.incrementKg, main: lift.main,
    suggestion: suggest(ex, lift, hist.get(lift.id!) ?? [], goal, nowMs),
    newLift: created,
  }))
}

/** What actually happened last block, in plain English, for the next programme to be written
 *  from. ⚠ This is SAVED on the programme it produces — a bad rewrite must be traceable to what
 *  the AI was told. */
export async function digestFor(profileId: string, programmeId: string | null, nowMs: number): Promise<string> {
  if (!programmeId) return ""
  const prog = await prisma.jordanProgramme.findUnique({ where: { id: programmeId } })
  if (!prog) return ""
  const plan = (prog.plan && typeof prog.plan === "object" ? prog.plan : {}) as unknown as Programme
  const workouts = await prisma.jordanWorkout.findMany({
    where: { profileId, programmeId },
    select: { id: true, status: true, startedAt: true, finishedAt: true, feeling: true },
  })
  const done = workouts.filter(w => w.status === "DONE")
  const weeksRun = Math.max(1, Math.ceil((nowMs - prog.startedAt.getTime()) / (7 * 86_400_000)))
  const weeks = Math.min(prog.weeks, weeksRun)

  const lifts = await allLifts()
  const planned = new Map<string, { name: string; liftId: string }>()
  for (const d of plan.days ?? []) for (const e of d.exercises ?? []) {
    const hit = matchLift(e.slug, lifts) ?? matchLift(e.name, lifts)
    if (hit?.id) planned.set(hit.id, { name: hit.name, liftId: hit.id })
  }
  const hist = await historyFor([...planned.keys()])

  const rows = [...planned.values()].map(p => {
    const sessions = hist.get(p.liftId) ?? []
    const real = sessions.filter(s => s.sets.some(x => !x.warmup))
    if (!real.length) {
      return { name: p.name, first: "", last: "", state: "skipped", lastDone: "never", skipped: done.length }
    }
    const fmt = (s: LiftSession) => {
      const w = s.sets.filter(x => !x.warmup)
      const top = Math.max(...w.map(x => x.weightKg))
      return `${top} kg ${w.length}×${w.filter(x => x.weightKg === top).map(x => x.reps).join("/")}`
    }
    const newest = real[0], oldest = real[real.length - 1]
    const topNew = Math.max(...newest.sets.map(s => s.weightKg))
    const topOld = Math.max(...oldest.sets.map(s => s.weightKg))
    const daysSince = Math.round((nowMs - new Date(newest.at).getTime()) / 86_400_000)
    const state = daysSince > 14 ? "not performed recently"
      : topNew > topOld ? "progressing"
      : real.length >= 3 && topNew <= topOld ? "stalled"
      : "holding"
    return {
      name: p.name, first: fmt(oldest), last: fmt(newest), state,
      lastDone: new Date(newest.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      skipped: Math.max(0, done.length - real.length),
    }
  })

  const mins = done.filter(w => w.finishedAt).map(w => Math.round((w.finishedAt!.getTime() - w.startedAt.getTime()) / 60000))
  return buildDigest({
    weeks,
    sessionsDone: done.length,
    sessionsPlanned: weeks * prog.daysPerWeek,
    lifts: rows,
    avgMinutes: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
    feelings: done.map(w => w.feeling).filter((f): f is number => typeof f === "number"),
  })
}
