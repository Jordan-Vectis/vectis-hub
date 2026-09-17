// JORDAN.SYS → GYM (personal, /jordan). The exercise catalogue, the progression maths, the
// normalisers and the prompts.
// ⚠ A plain module with NO server-only imports — the phone does the same maths the server does,
// so the weight on screen is the weight the next programme is written against.
//
// ⚠⚠ THE ONE RULE THIS TOOL IS BUILT ON: the AI writes STRUCTURE (days, exercises, sets, a rep
// range, reps-in-reserve, rest) and NEVER a weight. It has no idea what he can lift; the log does.
// Today's weight is worked out from his own history by double progression. That is what makes
// "the next programme comes from what you actually did" true rather than a slogan.

import { goalDef, type GoalKey } from "@/lib/jordan-meals"

export type { GoalKey }

// ── What the goal does to the TRAINING ───────────────────────────────────────
// Same GoalKey as the meal planner, on purpose: the gym tool reads the goal through the linked
// meal profile rather than keeping its own copy, so the two can never disagree about what he is
// doing. The brief differs because training in a deficit is a different job from training in a
// surplus — see GYM_GOALS below.

export const GYM_GOALS: Record<GoalKey, string> = {
  // ⚠ "Cut the volume" used to be the whole brief and it produced a programme of two-set
  // accessories — 6 hard sets a week for chest, under the 10 the same screen calls the minimum.
  // Cutting means one less EXERCISE, never three-set exercises shaved to two.
  lose: "GOAL: LOSE WEIGHT — training in a calorie deficit. The job is KEEPING muscle and strength, not adding it. The heavy compound work stays exactly as it would be otherwise — that is what preserves strength. Trim the volume by dropping an accessory exercise or two, NOT by cutting every exercise down to two sets, and every muscle group still gets its 10 hard sets a week. Do not add sets or an extra day to burn more — recovery is the limit in a deficit.",
  maintain: "GOAL: MAINTAIN — steady training at maintenance calories. Normal volume, normal progression.",
  muscle: "GOAL: BUILD MUSCLE — eating in a small surplus. 10–20 hard sets per muscle group per week, every group trained TWICE a week, most work in the 6–12 rep range at 1–3 reps in reserve.",
  gain: "GOAL: GAIN WEIGHT — a bigger surplus. As for building muscle, but lean harder on the heavy compounds; recovery is not the limiting factor here.",
}

// ⚠ Equipment is OPTIONAL and this is why (Jordan, 2026-09-16: "I'd rather it just try to use
// common gym equipment"). Listing the kit was a form to fill in before the tool did anything, for
// a thing that is the same in almost every commercial gym. Left blank, the AI is told to assume
// this — and anything it picks that isn't there gets swapped in two taps instead.
export const DEFAULT_GYM = "a normal commercial gym: a barbell and full plates (smallest pair 1.25 kg), dumbbells up to about 45 kg, an adjustable bench, a squat rack, a cable stack, and the usual machines — lat pulldown, seated row, leg press, leg curl, leg extension, chest press, pec deck. Do NOT use specialist kit (safety squat bar, trap bar, GHD, reverse hyper, sled, bands, chains) — if a movement needs one of those, choose another."

export const EXPERIENCE = [
  { key: "beginner",     label: "Beginner — under 6 months" },
  { key: "novice",       label: "Novice — 6 months to 2 years" },
  { key: "intermediate", label: "Intermediate — 2 to 5 years" },
  { key: "advanced",     label: "Advanced — 5 years or more" },
]

export const PATTERNS = [
  "squat", "hinge", "lunge", "horizontal-push", "vertical-push",
  "horizontal-pull", "vertical-pull", "isolation", "carry", "core",
]

// ── The exercise catalogue ───────────────────────────────────────────────────
// ⚠⚠ The single most important table here. Every logged set points at a LIFT, so "DB incline
// press", "Incline DB press" and "Incline dumbbell bench" are ONE movement with one history
// instead of three with one data point each. Exercise-name drift is what kills a gym log: "last
// time" is empty forever and progression has nothing to read.
//
// incrementKg is what the gym PHYSICALLY allows, never a percentage: a barbell moves in pairs of
// the smallest plate (2×1.25 = 2.5 kg), dumbbells jump to the next pair, a pin stack moves a pin.
// perHand: dumbbell weight is logged PER HAND, always. 2×30 logged as 60 once and every PB,
// chart and suggestion for that lift is wrong for good.

export type LiftSeed = {
  slug: string; name: string; aliases: string[]; pattern: string; muscles: string[]
  equipment: string; incrementKg: number; perHand?: boolean; bodyweight?: boolean
  restSec: number; main?: boolean
}

export const LIFT_SEED: LiftSeed[] = [
  // Squat
  { slug: "barbell-back-squat", name: "Barbell back squat", aliases: ["back squat", "squat", "bb squat"], pattern: "squat", muscles: ["quads", "glutes"], equipment: "barbell", incrementKg: 5, restSec: 180, main: true },
  { slug: "barbell-front-squat", name: "Barbell front squat", aliases: ["front squat"], pattern: "squat", muscles: ["quads"], equipment: "barbell", incrementKg: 5, restSec: 180, main: true },
  { slug: "leg-press", name: "Leg press", aliases: ["45 degree leg press", "plate leg press"], pattern: "squat", muscles: ["quads", "glutes"], equipment: "machine", incrementKg: 5, restSec: 150 },
  { slug: "hack-squat", name: "Hack squat", aliases: [], pattern: "squat", muscles: ["quads"], equipment: "machine", incrementKg: 5, restSec: 150 },
  { slug: "goblet-squat", name: "Goblet squat", aliases: ["db goblet squat"], pattern: "squat", muscles: ["quads", "glutes"], equipment: "dumbbell", incrementKg: 2.5, restSec: 120 },
  // Hinge
  { slug: "barbell-deadlift", name: "Barbell deadlift", aliases: ["deadlift", "conventional deadlift"], pattern: "hinge", muscles: ["hamstrings", "glutes", "back"], equipment: "barbell", incrementKg: 5, restSec: 210, main: true },
  { slug: "romanian-deadlift", name: "Romanian deadlift", aliases: ["rdl", "barbell rdl", "stiff leg deadlift"], pattern: "hinge", muscles: ["hamstrings", "glutes"], equipment: "barbell", incrementKg: 5, restSec: 150, main: true },
  { slug: "trap-bar-deadlift", name: "Trap bar deadlift", aliases: ["hex bar deadlift"], pattern: "hinge", muscles: ["quads", "glutes", "back"], equipment: "barbell", incrementKg: 5, restSec: 180, main: true },
  { slug: "hip-thrust", name: "Barbell hip thrust", aliases: ["hip thrust", "glute bridge"], pattern: "hinge", muscles: ["glutes"], equipment: "barbell", incrementKg: 5, restSec: 150 },
  { slug: "back-extension", name: "Back extension", aliases: ["hyperextension", "45 degree back extension"], pattern: "hinge", muscles: ["hamstrings", "lower back"], equipment: "bodyweight", incrementKg: 2.5, bodyweight: true, restSec: 90 },
  { slug: "seated-leg-curl", name: "Seated leg curl", aliases: ["leg curl", "hamstring curl", "lying leg curl"], pattern: "isolation", muscles: ["hamstrings"], equipment: "machine", incrementKg: 5, restSec: 90 },
  { slug: "leg-extension", name: "Leg extension", aliases: ["quad extension"], pattern: "isolation", muscles: ["quads"], equipment: "machine", incrementKg: 5, restSec: 90 },
  // Lunge
  { slug: "walking-lunge", name: "Walking lunge", aliases: ["db lunge", "dumbbell lunge"], pattern: "lunge", muscles: ["quads", "glutes"], equipment: "dumbbell", incrementKg: 2.5, perHand: true, restSec: 120 },
  { slug: "bulgarian-split-squat", name: "Bulgarian split squat", aliases: ["rear foot elevated split squat", "rfess", "split squat"], pattern: "lunge", muscles: ["quads", "glutes"], equipment: "dumbbell", incrementKg: 2.5, perHand: true, restSec: 120 },
  { slug: "step-up", name: "Step-up", aliases: ["db step up"], pattern: "lunge", muscles: ["quads", "glutes"], equipment: "dumbbell", incrementKg: 2.5, perHand: true, restSec: 90 },
  // Horizontal push
  { slug: "barbell-bench-press", name: "Barbell bench press", aliases: ["bench press", "bench", "flat bench"], pattern: "horizontal-push", muscles: ["chest", "triceps", "shoulders"], equipment: "barbell", incrementKg: 2.5, restSec: 180, main: true },
  { slug: "incline-barbell-bench", name: "Incline barbell bench press", aliases: ["incline bench", "incline barbell press"], pattern: "horizontal-push", muscles: ["chest", "shoulders"], equipment: "barbell", incrementKg: 2.5, restSec: 180, main: true },
  { slug: "dumbbell-bench-press", name: "Dumbbell bench press", aliases: ["db bench", "db bench press", "flat db press"], pattern: "horizontal-push", muscles: ["chest", "triceps"], equipment: "dumbbell", incrementKg: 2.5, perHand: true, restSec: 150 },
  { slug: "incline-dumbbell-press", name: "Incline dumbbell press", aliases: ["incline db press", "db incline press", "incline dumbbell bench"], pattern: "horizontal-push", muscles: ["chest", "shoulders"], equipment: "dumbbell", incrementKg: 2.5, perHand: true, restSec: 150 },
  { slug: "machine-chest-press", name: "Machine chest press", aliases: ["chest press machine", "hammer strength press"], pattern: "horizontal-push", muscles: ["chest"], equipment: "machine", incrementKg: 5, restSec: 120 },
  { slug: "cable-fly", name: "Cable fly", aliases: ["cable crossover", "pec fly", "pec deck"], pattern: "isolation", muscles: ["chest"], equipment: "cable", incrementKg: 5, restSec: 90 },
  { slug: "press-up", name: "Press-up", aliases: ["push up", "pushup"], pattern: "horizontal-push", muscles: ["chest", "triceps"], equipment: "bodyweight", incrementKg: 2.5, bodyweight: true, restSec: 90 },
  { slug: "dip", name: "Dip", aliases: ["dips", "chest dip", "parallel bar dip"], pattern: "horizontal-push", muscles: ["chest", "triceps"], equipment: "bodyweight", incrementKg: 2.5, bodyweight: true, restSec: 150, main: true },
  // Vertical push
  { slug: "overhead-press", name: "Barbell overhead press", aliases: ["ohp", "military press", "standing press", "shoulder press"], pattern: "vertical-push", muscles: ["shoulders", "triceps"], equipment: "barbell", incrementKg: 2.5, restSec: 180, main: true },
  { slug: "dumbbell-shoulder-press", name: "Dumbbell shoulder press", aliases: ["db shoulder press", "seated db press", "db ohp"], pattern: "vertical-push", muscles: ["shoulders", "triceps"], equipment: "dumbbell", incrementKg: 2.5, perHand: true, restSec: 150 },
  { slug: "machine-shoulder-press", name: "Machine shoulder press", aliases: ["shoulder press machine"], pattern: "vertical-push", muscles: ["shoulders"], equipment: "machine", incrementKg: 5, restSec: 120 },
  { slug: "lateral-raise", name: "Lateral raise", aliases: ["side raise", "db lateral raise", "cable lateral raise"], pattern: "isolation", muscles: ["shoulders"], equipment: "dumbbell", incrementKg: 2, perHand: true, restSec: 60 },
  { slug: "rear-delt-fly", name: "Rear delt fly", aliases: ["reverse fly", "reverse pec deck", "rear delt raise"], pattern: "isolation", muscles: ["shoulders", "upper back"], equipment: "dumbbell", incrementKg: 2, perHand: true, restSec: 60 },
  // Horizontal pull
  { slug: "barbell-row", name: "Barbell row", aliases: ["bent over row", "bb row", "pendlay row"], pattern: "horizontal-pull", muscles: ["back", "biceps"], equipment: "barbell", incrementKg: 2.5, restSec: 150, main: true },
  { slug: "dumbbell-row", name: "Dumbbell row", aliases: ["db row", "single arm row", "one arm row"], pattern: "horizontal-pull", muscles: ["back", "biceps"], equipment: "dumbbell", incrementKg: 2.5, perHand: true, restSec: 120 },
  { slug: "seated-cable-row", name: "Seated cable row", aliases: ["cable row", "low row"], pattern: "horizontal-pull", muscles: ["back", "biceps"], equipment: "cable", incrementKg: 5, restSec: 120 },
  { slug: "chest-supported-row", name: "Chest-supported row", aliases: ["t bar row", "machine row", "seal row"], pattern: "horizontal-pull", muscles: ["back"], equipment: "machine", incrementKg: 5, restSec: 120 },
  { slug: "face-pull", name: "Face pull", aliases: ["cable face pull"], pattern: "isolation", muscles: ["upper back", "shoulders"], equipment: "cable", incrementKg: 5, restSec: 60 },
  // Vertical pull
  { slug: "pull-up", name: "Pull-up", aliases: ["pullup", "chin up", "chinup"], pattern: "vertical-pull", muscles: ["back", "biceps"], equipment: "bodyweight", incrementKg: 2.5, bodyweight: true, restSec: 150, main: true },
  { slug: "lat-pulldown", name: "Lat pulldown", aliases: ["pulldown", "wide grip pulldown"], pattern: "vertical-pull", muscles: ["back", "biceps"], equipment: "cable", incrementKg: 5, restSec: 120 },
  { slug: "assisted-pull-up", name: "Assisted pull-up", aliases: ["assisted chin up", "pull up machine"], pattern: "vertical-pull", muscles: ["back", "biceps"], equipment: "machine", incrementKg: 5, restSec: 120 },
  // Arms
  { slug: "barbell-curl", name: "Barbell curl", aliases: ["bb curl", "ez bar curl"], pattern: "isolation", muscles: ["biceps"], equipment: "barbell", incrementKg: 2.5, restSec: 75 },
  { slug: "dumbbell-curl", name: "Dumbbell curl", aliases: ["db curl", "bicep curl", "hammer curl", "incline curl"], pattern: "isolation", muscles: ["biceps"], equipment: "dumbbell", incrementKg: 2, perHand: true, restSec: 75 },
  { slug: "cable-curl", name: "Cable curl", aliases: ["rope curl"], pattern: "isolation", muscles: ["biceps"], equipment: "cable", incrementKg: 5, restSec: 75 },
  { slug: "tricep-pushdown", name: "Tricep pushdown", aliases: ["rope pushdown", "cable pushdown", "tricep extension"], pattern: "isolation", muscles: ["triceps"], equipment: "cable", incrementKg: 5, restSec: 75 },
  { slug: "skullcrusher", name: "Skullcrusher", aliases: ["lying tricep extension", "ez bar skullcrusher"], pattern: "isolation", muscles: ["triceps"], equipment: "barbell", incrementKg: 2.5, restSec: 90 },
  { slug: "overhead-tricep-extension", name: "Overhead tricep extension", aliases: ["db overhead extension", "cable overhead extension"], pattern: "isolation", muscles: ["triceps"], equipment: "dumbbell", incrementKg: 2.5, restSec: 75 },
  // Core / carry / calves
  { slug: "plank", name: "Plank", aliases: ["front plank"], pattern: "core", muscles: ["core"], equipment: "bodyweight", incrementKg: 2.5, bodyweight: true, restSec: 60 },
  { slug: "hanging-leg-raise", name: "Hanging leg raise", aliases: ["leg raise", "knee raise"], pattern: "core", muscles: ["core"], equipment: "bodyweight", incrementKg: 2.5, bodyweight: true, restSec: 60 },
  { slug: "cable-crunch", name: "Cable crunch", aliases: ["kneeling cable crunch"], pattern: "core", muscles: ["core"], equipment: "cable", incrementKg: 5, restSec: 60 },
  { slug: "ab-rollout", name: "Ab rollout", aliases: ["wheel rollout"], pattern: "core", muscles: ["core"], equipment: "bodyweight", incrementKg: 2.5, bodyweight: true, restSec: 60 },
  { slug: "farmers-carry", name: "Farmer's carry", aliases: ["farmers walk", "loaded carry"], pattern: "carry", muscles: ["core", "forearms"], equipment: "dumbbell", incrementKg: 2.5, perHand: true, restSec: 90 },
  { slug: "calf-raise", name: "Calf raise", aliases: ["standing calf raise", "seated calf raise"], pattern: "isolation", muscles: ["calves"], equipment: "machine", incrementKg: 5, restSec: 60 },
]

/** Lower case, hyphens, nothing else — the identity of a lift. */
export function slugify(s: string): string {
  return String(s ?? "").toLowerCase().trim()
    .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
}

export type LiftInfo = {
  id?: string; slug: string; name: string; aliases?: string[]; pattern: string; muscles?: string[]
  equipment: string; incrementKg: number; perHand: boolean; bodyweight: boolean
  restSec: number; main: boolean
}

export function liftFromSeed(s: LiftSeed): LiftInfo {
  return {
    slug: s.slug, name: s.name, aliases: s.aliases, pattern: s.pattern, muscles: s.muscles,
    equipment: s.equipment, incrementKg: s.incrementKg, perHand: !!s.perHand,
    bodyweight: !!s.bodyweight, restSec: s.restSec, main: !!s.main,
  }
}

/** Find the lift a name or slug means. ⚠ Aliases first, ALWAYS — matching on the exact string
 *  alone is how one movement becomes three exercises with one data point each. */
export function matchLift(raw: string, lifts: LiftInfo[]): LiftInfo | null {
  const want = slugify(raw)
  if (!want) return null
  for (const l of lifts) if (l.slug === want) return l
  for (const l of lifts) if (slugify(l.name) === want) return l
  for (const l of lifts) if ((l.aliases ?? []).some(a => slugify(a) === want)) return l
  return null
}

// ── Plate maths ──────────────────────────────────────────────────────────────

/** "20 + 20 + 5 a side" — what to actually put on the bar. Null when it can't be made from the
 *  plates the gym has, which is the honest answer, not a rounded lie. */
export function platesFor(totalKg: number, barKg: number, plates: number[]): string | null {
  let each = (totalKg - barKg) / 2
  if (each < 0) return null
  if (each === 0) return "just the bar"
  const set = [...plates].filter(p => p > 0).sort((a, b) => b - a)
  const out: number[] = []
  for (const p of set) {
    while (each >= p - 0.001) { out.push(p); each = Math.round((each - p) * 100) / 100 }
  }
  if (each > 0.001) return null
  return out.join(" + ") + " a side"
}

/** Snap a weight to something the gym can actually make. */
export function loadable(kg: number, lift: LiftInfo): number {
  const step = lift.incrementKg > 0 ? lift.incrementKg : 2.5
  return Math.round((Math.round(kg / step) * step) * 100) / 100
}

// ── Estimated 1RM ────────────────────────────────────────────────────────────

/** Epley. ⚠ Only for a working set of 10 reps or fewer — past that it inflates badly and a "PB"
 *  off a 20-rep lateral raise buries the PBs that matter. Bodyweight lifts add the bodyweight,
 *  or pull-ups "improve" whenever he puts weight on. */
export function est1rm(weightKg: number, reps: number, lift: LiftInfo, bodyweightKg?: number | null): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps) || reps < 1 || reps > 10) return null
  const load = weightKg + (lift.bodyweight && bodyweightKg ? bodyweightKg : 0)
  if (load <= 0) return null
  return Math.round(load * (1 + reps / 30) * 10) / 10
}

// ── The progression rule ─────────────────────────────────────────────────────
// DOUBLE PROGRESSION: work up the rep range at one weight, then add the smallest jump the gym
// allows and start at the bottom of the range again.
//
// ⚠ THE UNIT IS THE LIFT, NOT THE WEEK — everything is read from the last time THAT LIFT was
// performed, never from a calendar week. He will miss Fridays.

export type SetRecord = { weightKg: number; reps: number; rir: number | null; warmup?: boolean }
export type LiftSession = { at: string; sets: SetRecord[] }

export type Suggestion = {
  /** null = never done, so no suggestion is possible. Anything else is a real, loadable weight. */
  weightKg: number | null
  reps: number
  why: string
  state: "first" | "add" | "reps" | "repeat" | "deload" | "hold" | "layoff" | "stalled"
  /** The last session's working sets, for the "Last: 80 kg × 8, 8, 7" line. */
  last: { at: string; weightKg: number; reps: number[] } | null
}

const DAY = 86_400_000

/** The weight a session was worked at: the one most of its working sets were done at, and the
 *  heaviest when that ties (a drop set must not read as the working weight). */
function sessionWeight(sets: SetRecord[]): number {
  const counts = new Map<number, number>()
  for (const s of sets) counts.set(s.weightKg, (counts.get(s.weightKg) ?? 0) + 1)
  let best = 0, bestN = 0
  for (const [w, n] of counts) if (n > bestN || (n === bestN && w > best)) { best = w; bestN = n }
  return best
}

const working = (s: LiftSession): SetRecord[] => s.sets.filter(x => !x.warmup && x.reps > 0)

/**
 * What to put on the bar today, and WHY — an unexplained number gets overridden and then ignored.
 *
 * `history` is that lift's sessions, MOST RECENT FIRST. `nowMs` is passed in rather than read
 * from the clock so the server and the phone can never disagree by a day.
 */
export function suggest(
  ex: { sets: number; repLow: number; repHigh: number; rir: number },
  lift: LiftInfo,
  history: LiftSession[],
  goal: GoalKey,
  nowMs: number,
): Suggestion {
  const done = history.map(h => ({ ...h, sets: working(h) })).filter(h => h.sets.length > 0)
  if (!done.length) {
    return {
      weightKg: null, reps: ex.repLow, state: "first", last: null,
      why: "First time on this — pick a weight you could do 2 or 3 more reps with, and it has its anchor from next time on.",
    }
  }

  const lastS = done[0]
  const lastW = sessionWeight(lastS.sets)
  const atW = lastS.sets.filter(s => s.weightKg === lastW)
  const reps = atW.map(s => s.reps)
  const last = { at: lastS.at, weightKg: lastW, reps }
  const days = Math.max(0, Math.round((nowMs - new Date(lastS.at).getTime()) / DAY))
  const ago = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`

  // ⚠ A LAYOFF IS NOT A STALL. Suggesting a weight he has not touched in five weeks is the
  // first-session-back injury. Gaps are data — treat them before anything else.
  if (days > 42) {
    return { weightKg: loadable(lastW * 0.7, lift), reps: ex.repHigh, state: "layoff", last,
      why: `${Math.round(days / 7)} weeks since you last did this. Start at 70% and build back — you'll beat the old number within a month.` }
  }
  if (days > 21) {
    return { weightKg: loadable(lastW * 0.8, lift), reps: ex.repHigh, state: "layoff", last,
      why: `${Math.round(days / 7)} weeks off this lift. 80% today; muscle memory is fast, so expect to be back inside 2 or 3 sessions.` }
  }
  if (days > 10) {
    return { weightKg: loadable(lastW * 0.9, lift), reps: ex.repHigh, state: "layoff", last,
      why: `${days} days since you last did this — 90% today, then straight back to it.` }
  }

  const cutting = goal === "lose"
  // ⚠ ALL the prescribed sets, not just the ones he got round to. Two sets of 8 out of three
  // prescribed is not a top-of-range session, and adding weight off it is how a stall starts.
  const allTop = reps.length >= ex.sets && reps.every(r => r >= ex.repHigh)
  const missed = reps.some(r => r < ex.repLow)

  // ── Everything hit the top of the range → add the smallest jump the gym allows ──
  if (allTop && !missed) {
    const next = loadable(lastW + lift.incrementKg, lift)
    const jump = lastW > 0 ? (next - lastW) / lastW : 0
    const easy = atW.every(s => s.rir != null && s.rir >= 3)
    // ⚠ A dumbbell's next pair can be an 8% jump on a press — far too big. When the only jump
    // available is that large, earn reps ABOVE the range first instead of guaranteeing a failure.
    if (jump > 0.05 && !reps.every(r => r >= ex.repHigh + 2)) {
      return { weightKg: lastW, reps: ex.repHigh + 2, state: "reps", last,
        why: `${reps.join(", ")} ${ago} — top of the range. The next weight up is a ${Math.round(jump * 100)}% jump, so earn a couple of reps past the range first.` }
    }
    return { weightKg: next, reps: ex.repLow, state: "add", last,
      why: `You hit ${reps.join(", ")} ${ago} — that's the top of the range, so up ${next - lastW} kg and back to ${ex.repLow}s.${easy ? " It read easy (3+ in reserve) — take a bigger jump if it felt it." : ""}` }
  }

  // ── A miss: under the bottom of the range ──
  if (missed) {
    // How many sessions IN A ROW at this same weight have missed. One is a bad night's sleep.
    let fails = 0
    for (const s of done) {
      if (sessionWeight(s.sets) !== lastW) break
      if (s.sets.filter(x => x.weightKg === lastW).some(x => x.reps < ex.repLow)) fails++
      else break
    }
    if (fails <= 1) {
      return { weightKg: lastW, reps: ex.repLow, state: "repeat", last,
        why: `${reps.join(", ")} ${ago} — short of ${ex.repLow}. One rough session is sleep or food, not a plateau: same weight again.` }
    }
    if (fails === 2) {
      if (cutting) {
        return { weightKg: lastW, reps: ex.repLow, state: "hold", last,
          why: `Second miss at ${lastW} kg — but you're in a deficit, so hold here rather than drop. Keeping this weight while losing is the win.` }
      }
      return { weightKg: loadable(lastW * 0.9, lift), reps: ex.repHigh, state: "deload", last,
        why: `Missed at ${lastW} kg twice running. Drop 10% today and climb back — you'll normally beat it within 2 or 3 sessions.` }
    }
    return { weightKg: loadable(lastW * 0.9, lift), reps: ex.repHigh, state: "stalled", last,
      why: `${fails} misses in a row at ${lastW} kg. This one's stalled — it'll be swapped for a different ${lift.pattern.replace("-", " ")} movement in the next programme.` }
  }

  // ── Inside the range → same weight, one more rep. That IS progress; say so. ──
  const target = Math.min(ex.repHigh, Math.max(...reps) + 1)
  return { weightKg: lastW, reps: target, state: "reps", last,
    why: `${reps.join(", ")} ${ago}. Same weight — go for ${target}${cutting ? ". Holding your numbers through a deficit is the job." : `, then ${loadable(lastW + lift.incrementKg, lift)} kg once every set hits ${ex.repHigh}.`}` }
}

// ── The programme, as written by the AI ──────────────────────────────────────

export type ProgrammeExercise = {
  slug: string; name: string; pattern: string; equipment: string
  sets: number; repLow: number; repHigh: number; rir: number; restSeconds: number
  note: string; substitute: string
}
export type ProgrammeDay = { day: number; name: string; estimatedMinutes: number; exercises: ProgrammeExercise[] }
export type Programme = { title: string; notes: string; weeks: number; days: ProgrammeDay[] }

const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max)
const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Coerce whatever the model returned into a complete Programme.
 *  ⚠⚠ Any weight the model wrote anyway is STRIPPED here. It does not know what he can lift, and
 *  a guessed 60 kg on a 90 kg bench wastes a month — or guesses high and he fails session one. */
export function normaliseProgramme(raw: unknown): Programme {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const days = arr(r.days).map((d, i) => {
    const dd = (d && typeof d === "object" ? d : {}) as Record<string, unknown>
    const exercises = arr(dd.exercises).map(x => {
      const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
      const repLow  = clamp(e.repLow, 1, 50, 8)
      const repHigh = Math.max(repLow, clamp(e.repHigh, 1, 50, repLow + 2))
      const name = str(e.name, 80) || str(e.slug, 80)
      return {
        slug: slugify(str(e.slug, 60) || name), name: name || "Exercise",
        pattern: PATTERNS.includes(str(e.pattern, 30)) ? str(e.pattern, 30) : "isolation",
        equipment: str(e.equipment, 30) || "barbell",
        sets: clamp(e.sets, 1, 10, 3), repLow, repHigh,
        rir: clamp(e.rir, 0, 5, 2),
        restSeconds: clamp(e.restSeconds, 30, 300, 120),
        note: str(e.note, 200), substitute: str(e.substitute, 80),
      }
    }).filter(e => e.slug)
    return {
      day: clamp(dd.day, 1, 7, i + 1),
      name: str(dd.name, 60) || `Day ${i + 1}`,
      estimatedMinutes: clamp(dd.estimatedMinutes, 0, 240, 0),
      exercises,
    }
  }).filter(d => d.exercises.length)
  return {
    title: str(r.title, 120),
    notes: str(r.notes, 1000),
    weeks: clamp(r.weeks, 1, 16, 4),
    days,
  }
}

/** A saved programme row in the shape the client works with. Lives here, not in a route file —
 *  Next route files may only export HTTP handlers, and two routes need it. */
export function programmeOut(r: {
  id: string; title: string; goal: string; daysPerWeek: number; weeks: number
  plan: unknown; inputs: unknown; digest: string; brief: string; model: string
  startedAt: Date | null; endedAt: Date | null; createdAt: Date
}) {
  return {
    id: r.id, title: r.title, goal: r.goal, daysPerWeek: r.daysPerWeek, weeks: r.weeks,
    digest: r.digest, brief: r.brief, model: r.model,
    startedAt: r.startedAt, endedAt: r.endedAt, createdAt: r.createdAt,
    inputs: (r.inputs && typeof r.inputs === "object" ? r.inputs : {}) as Record<string, unknown>,
    plan: normaliseProgramme(r.plan),
  }
}

/** The groups a programme is judged on. Calves, core, forearms and the lower back get whatever
 *  they get — nobody writes a block around them, and flagging them would cry wolf every time. */
export const MAIN_MUSCLES = ["chest", "back", "shoulders", "quads", "hamstrings", "glutes", "biceps", "triceps"]

/**
 * Hard sets per muscle across a week. 10 to 20 is the working range for growth.
 *
 * ⚠ A set counts ONCE, for the muscle the exercise is actually training — the first in the
 * lift's list — and a half for the ones it only helps. Counting every muscle a lift touches as a
 * full hard set had a bench press putting 3 sets towards shoulders, so a programme with 6 real
 * chest sets displayed 13 for shoulders and read as though it were well covered.
 */
export function weeklySets(plan: Programme, lifts: LiftInfo[]): { muscle: string; sets: number; low: boolean }[] {
  const byMuscle = new Map<string, number>()
  for (const d of plan.days) for (const e of d.exercises) {
    const muscles = matchLift(e.slug, lifts)?.muscles ?? []
    muscles.forEach((m, i) => byMuscle.set(m, (byMuscle.get(m) ?? 0) + (i === 0 ? e.sets : e.sets / 2)))
  }
  return [...byMuscle.entries()]
    .map(([muscle, raw]) => {
      const sets = Math.round(raw * 2) / 2
      return { muscle, sets, low: MAIN_MUSCLES.includes(muscle) && sets < 10 }
    })
    .sort((a, b) => b.sets - a.sets)
}

/** The main groups a programme misses altogether — a muscle with no work at all never appears in
 *  the count above, so "chest 6" is visible but "no chest at all" would not be. */
export function missingMuscles(counted: { muscle: string }[]): string[] {
  const have = new Set(counted.map(c => c.muscle))
  return MAIN_MUSCLES.filter(m => !have.has(m))
}

// ── Prompts ──────────────────────────────────────────────────────────────────

export function gymSystemPrompt(): string {
  return `You write strength-training programmes for one adult training in a commercial gym in the UK. British spelling, metric, plain names for exercises.

RULES — every one of them matters:
1. ⚠ NEVER PRESCRIBE A WEIGHT. You do not know what he can lift. You prescribe sets, a REP RANGE, a reps-in-reserve target and a rest. The weight is worked out from his own logged history and is not your job. Any kg figure in your answer is wrong and will be thrown away.
2. Use ONLY the equipment listed. If a movement needs something that is not there, choose another. Give every exercise a "substitute" for when the machine is taken — a real gym is busy.
3. Use the exercise slugs from the list you are given. If a movement genuinely is not on the list, write a slug in the same style (lower case, hyphens) and give its full name — never reuse a listed slug for a different movement.
4. NEVER include any movement named under injuries, in any variation. Put a pain-free alternative for that pattern instead and say why in its "note".
5. ⚠ WRITE EXACTLY THE NUMBER OF DAYS ASKED FOR — not fewer, not more — and use the split that goes with it: 2 days = full body twice; 3 days = full body three times OR push / pull / legs; 4 days = upper, lower, upper, lower; 5 days = push, pull, legs, upper, lower; 6 days = push, pull, legs twice. Do NOT answer a four-day week with three full-body sessions.
6. ⚠⚠ VOLUME IS THE POINT AND IT IS CHECKED. Every muscle group — chest, back, shoulders, quads, hamstrings, glutes, biceps, triceps — must get AT LEAST 10 HARD SETS A WEEK, counting a set only towards the muscle the exercise actually trains (a bench press is chest, not shoulders). Twelve to sixteen is the target. COUNT THEM BEFORE YOU ANSWER, muscle by muscle, and add work until every one clears 10. Train each group twice a week whenever three or more days are trained.
7. THREE SETS MINIMUM on any exercise that is there to build something. Two sets is for a finisher at the very end of a session, never for a main compound or the only exercise for a muscle. A programme of two-set exercises looks tidy and does nothing.
8. It must FIT the session length. A compound working set with its rest is about 3–4 minutes, an accessory about 2. Put "estimatedMinutes" on every day and do not go over the limit given — but do not come in far UNDER it either: if the volume above does not fill the time, add work rather than handing back a short session. Five to eight exercises a session, compounds first while he is fresh.
9. Rep ranges: main compounds 5–8, secondary compounds 8–12, isolation 12–20. Reps in reserve 1–3 — never to failure on a compound, and never on the first exercise of a session.
10. Rest: 150–180 s on compounds, 60–90 s on isolation.
11. WHAT HE ACTUALLY DID OVERRULES WHAT LOOKS TIDY. Keep any exercise that is progressing — do not swap it for variety. Replace an exercise marked STALLED with a different movement in the SAME pattern. Drop an exercise he keeps skipping: a skipped exercise is a vote. If he missed sessions last block, do NOT add volume — hold it, and cut a day only if he has never once managed the days prescribed.
12. "notes" is one or two plain lines on how to run the block. No motivational padding.
13. Answer with JSON only, exactly this shape and nothing else:
{"title":"Upper/Lower — 4 days","notes":"one or two lines on how to run it","weeks":4,"days":[{"day":1,"name":"Upper A","estimatedMinutes":62,"exercises":[{"slug":"barbell-bench-press","name":"Barbell bench press","pattern":"horizontal-push","equipment":"barbell","sets":3,"repLow":6,"repHigh":8,"rir":2,"restSeconds":180,"note":"top set first, stop 2 short","substitute":"Dumbbell bench press"}]}]}`
}

export function gymUserPrompt(input: {
  name: string; sex: string; age: number | null; weightKg: number | null
  goal: GoalKey; kcal: number | null; goalDelta: number
  daysPerWeek: number; sessionMinutes: number; experience: string
  equipment: string; injuries: string; preferences: string
  slugs: string[]; digest: string; brief: string
}): string {
  const exp = EXPERIENCE.find(e => e.key === input.experience)?.label ?? input.experience
  const cals = input.kcal
    ? `Eating about ${input.kcal} kcal a day${input.goalDelta ? ` — ${Math.abs(input.goalDelta)} ${input.goalDelta < 0 ? "under" : "above"} maintenance` : " — at maintenance"}.`
    : ""
  const lines = [
    `PERSON: ${input.name} — ${input.sex}, ${input.age ?? "?"} years old, ${input.weightKg ? `${Math.round(input.weightKg)} kg` : "weight unknown"}, ${exp.toLowerCase()}.`,
    `${GYM_GOALS[input.goal]} ${cals}`.trim(),
    `TRAINING: EXACTLY ${input.daysPerWeek} day${input.daysPerWeek === 1 ? "" : "s"} a week — write ${input.daysPerWeek} days, no fewer — and up to ${input.sessionMinutes} minutes a session (use most of that time).`,
    input.equipment.trim()
      ? `EQUIPMENT AVAILABLE — use nothing else: ${input.equipment.trim()}`
      : `EQUIPMENT: assume ${DEFAULT_GYM}`,
    input.injuries.trim()     ? `INJURIES — NEVER PRESCRIBE THESE: ${input.injuries.trim()}` : "",
    input.preferences.trim()  ? `LIKES AND DISLIKES: ${input.preferences.trim()}` : "",
    input.slugs.length        ? `EXERCISE SLUGS TO USE: ${input.slugs.join(", ")}` : "",
    input.digest.trim()       ? `LAST BLOCK — WHAT ACTUALLY HAPPENED:\n${input.digest.trim()}` : "NO TRAINING HISTORY YET — this is the first block, so keep the volume modest and the movements simple.",
    input.brief.trim()        ? `THIS BLOCK SPECIFICALLY: ${input.brief.trim()}` : "",
  ]
  return lines.filter(Boolean).join("\n")
}

// ── Swapping an exercise ─────────────────────────────────────────────────────
// The machine is taken, it aggravates something, or he just doesn't get on with it. Two ways:
// the catalogue's own same-pattern movements (instant, no waiting, no AI), or ask the AI for
// tailored ones with a reason. A swap must stay in the SAME movement pattern, or the day quietly
// stops training what it was built to train.

export type SwapOption = { slug: string; name: string; equipment: string; why: string }

export function swapSystemPrompt(): string {
  return `You suggest replacement exercises for one adult training in a commercial gym in the UK. British spelling, plain exercise names.

RULES:
1. Every suggestion must train the SAME movement pattern and the same muscles as the exercise being replaced. A swap that changes what the session trains is wrong.
2. Never suggest anything that clashes with the injuries given, in any variation.
3. Use only equipment that is available.
4. Prefer the slugs listed. If a movement genuinely is not listed, write a slug in the same style (lower case, hyphens).
5. "why" is ONE short line saying when you would pick it over the original — the kit it needs, what it is easier or harder on, what it demands less of. No sales talk.
6. Give 4 to 6 options, best first.
7. Answer with JSON only, exactly this shape: {"options":[{"slug":"dumbbell-bench-press","name":"Dumbbell bench press","equipment":"dumbbell","why":"Same pattern with a longer range; easier on the shoulder than a bar."}]}`
}

export function swapUserPrompt(input: {
  name: string; pattern: string; equipment: string; injuries: string; preferences: string
  slugs: string[]; history: string
}): string {
  return [
    `REPLACING: ${input.name} — a ${input.pattern.replace("-", " ")} movement.`,
    `EQUIPMENT AVAILABLE: ${input.equipment.trim() || DEFAULT_GYM}`,
    input.injuries.trim()    ? `INJURIES — NEVER SUGGEST THESE: ${input.injuries.trim()}` : "",
    input.preferences.trim() ? `LIKES AND DISLIKES: ${input.preferences.trim()}` : "",
    input.history.trim()     ? `WHY IT IS BEING REPLACED: ${input.history.trim()}` : "",
    input.slugs.length       ? `SLUGS TO PREFER: ${input.slugs.join(", ")}` : "",
  ].filter(Boolean).join("\n")
}

export function normaliseSwap(raw: unknown): SwapOption[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return arr(r.options).map(x => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
    const name = str(o.name, 80)
    return {
      slug: slugify(str(o.slug, 60) || name), name: name || str(o.slug, 60),
      equipment: str(o.equipment, 30) || "barbell", why: str(o.why, 200),
    }
  }).filter(o => o.slug && o.name).slice(0, 8)
}

/** Swap one exercise for another inside a saved programme, in place. Returns null when the day
 *  or the exercise isn't there any more, so the caller can say so rather than saving nothing. */
export function applySwap(plan: Programme, dayName: string, slug: string, next: ProgrammeExercise): Programme | null {
  let hit = false
  const days = plan.days.map(d => {
    if (d.name !== dayName) return d
    return {
      ...d,
      exercises: d.exercises.map(e => {
        if (e.slug !== slug || hit) return e
        hit = true
        // ⚠ Sets, reps, RIR and rest are KEPT from the original — a swap changes the movement,
        // not the job it is doing in that session.
        return { ...e, slug: next.slug, name: next.name, equipment: next.equipment, pattern: e.pattern, substitute: e.name, note: next.note || e.note }
      }),
    }
  })
  return hit ? { ...plan, days } : null
}

/** The plain-English performance summary the next programme is written from — and it is SAVED
 *  beside the programme it produced, so a bad rewrite can be traced to what the AI was told. */
export function buildDigest(input: {
  weeks: number; sessionsDone: number; sessionsPlanned: number
  lifts: { name: string; first: string; last: string; state: string; lastDone: string; skipped: number }[]
  avgMinutes: number | null; feelings: number[]
}): string {
  const out: string[] = []
  out.push(`${input.sessionsDone} of ${input.sessionsPlanned} planned sessions done over ${input.weeks} week${input.weeks === 1 ? "" : "s"}.`)
  for (const l of input.lifts) {
    if (l.state === "skipped") { out.push(`${l.name} — not performed since ${l.lastDone}, skipped ${l.skipped} times.`); continue }
    out.push(`${l.name}: ${l.first} → ${l.last} — ${l.state.toUpperCase()}.`)
  }
  if (input.avgMinutes) out.push(`Average session ${input.avgMinutes} minutes.`)
  if (input.feelings.length) {
    const avg = input.feelings.reduce((a, b) => a + b, 0) / input.feelings.length
    out.push(`Sessions rated ${avg.toFixed(1)} out of 5 for how they felt${avg <= 2.5 ? " — that is low; recovery is the problem, not the exercises." : ""}.`)
  }
  return out.join("\n")
}

/** "Build muscle — 250 kcal a day above maintenance", borrowed from the meal planner so the two
 *  tools say the same thing about the same goal. */
export function goalLabel(goal: GoalKey): string {
  return goalDef(goal).label
}
