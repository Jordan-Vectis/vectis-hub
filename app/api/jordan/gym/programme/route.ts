import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { friendlyGeminiError } from "@/lib/gemini-retry"
import { parseModelJson } from "@/lib/model-json"
import { normaliseProgramme, programmeOut, gymSystemPrompt, gymUserPrompt } from "@/lib/jordan-gym"
import { allLifts, digestFor, getProfile, missingTable, personOf } from "@/lib/jordan-gym-db"
import { targets as mealTargets } from "@/lib/jordan-meals"

export const maxDuration = 180

// POST /api/jordan/gym/programme — write a training block and save it. Body: { brief?, weeks?, model? }
//
// ⚠⚠ The AI writes STRUCTURE ONLY — sets, a rep range, reps-in-reserve, rest. It never writes a
// weight (normaliseProgramme throws away any it writes anyway): it has no idea what he can lift,
// and a guess either wastes a month under-loading or fails him in session one. The weight comes
// from his own log, at session start.
//
// ⚠ What it IS told is what actually happened last block — what progressed, what stalled, what he
// skipped, how many sessions he really did — and that digest is SAVED beside the programme it
// produced, so a bad rewrite can be traced to what it was given.
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { brief = "", weeks: rawWeeks = 4, model: modelId = "" } = await req.json()

    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: "Couldn't open the profile" }, { status: 500 })
    // ⚠ Equipment is OPTIONAL (Jordan, 2026-09-16). Blank means "a normal commercial gym"
    // (DEFAULT_GYM in lib/jordan-gym.ts), and anything it picks that isn't there gets swapped in
    // two taps. Making him list the kit first was a form standing between him and the tool.
    const weeks = Math.max(1, Math.min(12, Math.round(Number(rawWeeks)) || 4))
    const person = personOf(profile)
    const t = profile.mealProfile ? mealTargets(profile.mealProfile) : null

    const current = await prisma.jordanProgramme.findFirst({
      where: { profileId: profile.id, endedAt: null }, orderBy: { createdAt: "desc" },
    })
    const digest = await digestFor(profile.id, current?.id ?? null, Date.now())
    const lifts = await allLifts()

    const model = await getToolModel("jordan_gym", modelId)
    const raw = await generateAiText({
      model,
      system: gymSystemPrompt(),
      prompt: gymUserPrompt({
        name: person.name, sex: person.sex, age: person.age, weightKg: person.weightKg,
        goal: person.goal, kcal: t?.kcal ?? null, goalDelta: person.goalDelta,
        daysPerWeek: profile.daysPerWeek, sessionMinutes: profile.sessionMinutes,
        experience: profile.experience, equipment: profile.equipment,
        injuries: profile.injuries, preferences: profile.preferences,
        slugs: lifts.map(l => l.slug),
        digest,
        brief: String(brief ?? "").slice(0, 2000),
      }),
      json: true,
      maxOutputTokens: 16384,
    })

    const plan = normaliseProgramme(parseModelJson(raw))
    if (!plan.days.length) {
      const cut = raw.trim() && !raw.trim().endsWith("}")
      return NextResponse.json({
        error: cut ? "The reply was cut off — try again, or ask for fewer days." : "Couldn't read the AI's answer — try again.",
      }, { status: 502 })
    }

    // Only one block runs at a time: starting a new one ends the old one, which is also what
    // makes the digest above mean "last block" next time.
    if (current) await prisma.jordanProgramme.update({ where: { id: current.id }, data: { endedAt: new Date() } })

    const row = await prisma.jordanProgramme.create({
      data: {
        profileId: profile.id,
        title: plan.title || `${plan.days.length}-day programme`,
        goal: person.goal,
        daysPerWeek: plan.days.length,
        weeks: plan.weeks || weeks,
        plan: plan as any,
        inputs: {
          equipment: profile.equipment, injuries: profile.injuries,
          sessionMinutes: profile.sessionMinutes, experience: profile.experience,
          kcal: t?.kcal ?? null, goal: person.goal,
          // ⚠ What was ASKED for, beside what came back — daysPerWeek above records what the AI
          // actually wrote, so without this a four-day week quietly answered with three full-body
          // sessions leaves no trace that anything was ignored.
          daysAsked: profile.daysPerWeek,
        } as any,
        digest,
        brief: String(brief ?? "").slice(0, 2000),
        model,
      },
    })
    return NextResponse.json({ programme: programmeOut(row) })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the gym tables aren't there yet." }, { status: 503 })
    console.error("jordan/gym/programme POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

/** Every block, newest first — the one with no endedAt is the one running. */
export async function GET() {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ programmes: [] })
    const rows = await prisma.jordanProgramme.findMany({
      where: { profileId: profile.id }, orderBy: { createdAt: "desc" }, take: 20,
    })
    return NextResponse.json({ programmes: rows.map(programmeOut) })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ programmes: [], needsMigration: true })
    console.error("jordan/gym/programme GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id, title, end } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = String(title ?? "").trim().slice(0, 120)
    if (end === true) data.endedAt = new Date()
    if (end === false) data.endedAt = null
    await prisma.jordanProgramme.update({ where: { id: String(id) }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/gym/programme PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    // ⚠ The workouts survive — JordanWorkout.programmeId is SetNull. Deleting an old programme
    // must never take the log of what was lifted with it.
    await prisma.jordanProgramme.delete({ where: { id: String(id) } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/gym/programme DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
