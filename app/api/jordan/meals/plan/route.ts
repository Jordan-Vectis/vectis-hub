import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { friendlyGeminiError } from "@/lib/gemini-retry"
import { parseModelJson } from "@/lib/model-json"
import { chosenMeals, normalisePlan, planOut, planSystemPrompt, planUserPrompt, targets, type Plan } from "@/lib/jordan-meals"

export const maxDuration = 180

// POST /api/jordan/meals/plan — write part of a plan and save it.
// Body: { profileId, days (1–7), brief?, model?, planId?, fromDay?, toDay? }
//
// ⚠⚠ WRITTEN A FEW DAYS AT A TIME (2026-09-17). Jordan: "I keep getting an AI couldn't read
// answer if I try to do too many days". A week of full recipes does not fit in one reply — the
// model ran out of output tokens mid-JSON, so nothing could be parsed and a two-minute wait ended
// with an error and no plan at all. The client now asks for two days per call and passes the
// planId back, so each answer is small enough to finish and every chunk is SAVED as it arrives:
// stopping (or a failure on day 5) keeps days 1–4 rather than losing the lot.
//
// ⚠ The targets are worked out HERE from the saved profile, with the same maths the screen shows
// (lib/jordan-meals.ts), and frozen onto the plan. The shopping list is a SEPARATE call.
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { profileId, days: rawDays = 1, brief = "", model: modelId = "", planId = null, fromDay: rawFrom = 1, toDay: rawTo = 0 } = await req.json()
    if (!profileId) return NextResponse.json({ error: "Pick a profile first" }, { status: 400 })
    const days    = Math.max(1, Math.min(7, Math.round(Number(rawDays)) || 1))
    const fromDay = Math.max(1, Math.min(days, Math.round(Number(rawFrom)) || 1))
    const toDay   = Math.max(fromDay, Math.min(days, Math.round(Number(rawTo)) || days))

    const p = await prisma.jordanMealProfile.findUnique({ where: { id: String(profileId) } })
    if (!p) return NextResponse.json({ error: "That profile no longer exists" }, { status: 404 })

    const t = targets(p)
    if (!t) return NextResponse.json({ error: "Fill in sex, age, height and weight first — the targets come from those." }, { status: 400 })

    // Carrying on an existing plan: what's written already, so the model doesn't repeat itself.
    const existingRow = planId ? await prisma.jordanMealPlan.findUnique({ where: { id: String(planId) } }) : null
    const existing: Plan | null = existingRow ? normalisePlan(existingRow.plan) : null
    const alreadyMade = existing ? existing.days.flatMap(d => d.meals.map(m => m.name)).slice(-24) : []

    const model = await getToolModel("jordan_meals", modelId)
    const raw = await generateAiText({
      model,
      system: planSystemPrompt(),
      prompt: planUserPrompt({
        name: p.name, sex: p.sex, age: p.age, weightKg: p.weightKg, t, days,
        goal: (p as any).goal, goalDelta: p.goalDelta,
        slots: chosenMeals((p as any).meals, p.mealsPerDay),
        likes: p.likes, dislikes: p.dislikes, notes: p.notes,
        brief: String(brief ?? "").slice(0, 2000),
        fromDay, toDay, alreadyMade,
      }),
      json: true,
      maxOutputTokens: 16384,
    })

    const parsed = normalisePlan(parseModelJson(raw))
    if (!parsed.days.length) {
      const cut = raw.trim() && !raw.trim().endsWith("}")
      const got = existing?.days.length ?? 0
      return NextResponse.json({
        error: `${cut ? "The reply was cut off" : "Couldn't read the AI's answer"} on day ${fromDay}. ${got ? `Days 1 to ${got} are saved — try again to carry on from there.` : "Try again."}`,
        planId: existingRow?.id ?? null,
      }, { status: 502 })
    }

    // ⚠ The day numbers are OURS, not the model's. Asked for days 3–4 it will sometimes answer
    // "day 1, day 2", and a plan with two day ones is nonsense the client cannot show.
    const written = parsed.days.slice(0, toDay - fromDay + 1).map((d, i) => ({ ...d, day: fromDay + i }))

    if (existingRow && existing) {
      const merged: Plan = {
        title: existing.title || parsed.title,
        tips:  existing.tips  || parsed.tips,
        // Anything already written for these day numbers is replaced, not doubled — a retry of
        // the same chunk must not leave two day 3s.
        days: [...existing.days.filter(d => d.day < fromDay), ...written],
      }
      const saved = await prisma.jordanMealPlan.update({
        where: { id: existingRow.id },
        data: { plan: merged as any, days: merged.days.length },
      })
      return NextResponse.json({ plan: planOut(saved), done: merged.days.length >= days })
    }

    const row = await prisma.jordanMealPlan.create({
      data: {
        profileId: p.id,
        title: parsed.title || `${days}-day plan`,
        days: written.length,
        targets: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, bmr: t.bmr, tdee: t.tdee } as any,
        plan: { ...parsed, days: written } as any,
        brief: String(brief ?? "").slice(0, 2000),
        model,
      },
    })
    return NextResponse.json({ plan: planOut(row), done: written.length >= days })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    console.error("jordan/meals/plan:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
