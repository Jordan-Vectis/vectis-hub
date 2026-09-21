import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { friendlyGeminiError } from "@/lib/gemini-retry"
import { chosenMeals, normalisePlan, parsePlanReply, planOut, planSystemPrompt, planUserPrompt, targets, type Plan } from "@/lib/jordan-meals"

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

    const { profileId, partnerId = null, days: rawDays = 1, brief = "", model: modelId = "", planId = null, fromDay: rawFrom = 1, toDay: rawTo = 0 } = await req.json()
    if (!profileId) return NextResponse.json({ error: "Pick a profile first" }, { status: 400 })
    const days    = Math.max(1, Math.min(7, Math.round(Number(rawDays)) || 1))
    const fromDay = Math.max(1, Math.min(days, Math.round(Number(rawFrom)) || 1))
    const toDay   = Math.max(fromDay, Math.min(days, Math.round(Number(rawTo)) || days))

    const p = await prisma.jordanMealProfile.findUnique({ where: { id: String(profileId) } })
    if (!p) return NextResponse.json({ error: "That profile no longer exists" }, { status: 404 })

    const t = targets(p)
    if (!t) return NextResponse.json({ error: "Fill in sex, age, height and weight first — the targets come from those." }, { status: 400 })

    // A couple's plan: one recipe per meal, split so BOTH land on their own targets.
    const partner = partnerId && partnerId !== p.id
      ? await prisma.jordanMealProfile.findUnique({ where: { id: String(partnerId) } })
      : null
    const partnerT = partner ? targets(partner) : null
    if (partner && !partnerT) {
      return NextResponse.json({ error: `${partner.name} is missing sex, age, height or weight — both people need those before a plan for two.` }, { status: 400 })
    }
    const people = partner && partnerT
      ? [
          { name: p.name, kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat },
          { name: partner.name, kcal: partnerT.kcal, protein: partnerT.protein, carbs: partnerT.carbs, fat: partnerT.fat },
        ]
      : []
    // ⚠ Both people's dislikes and allergies apply to every meal — they are eating the same dish,
    // so anything either of them can't have is off the menu entirely.
    const dislikes = [p.dislikes, partner?.dislikes].filter(s => s?.trim()).join("; ")
    const likes    = [p.likes, partner?.likes].filter(s => s?.trim()).join("; ")
    const notes    = [p.notes, partner?.notes].filter(s => s?.trim()).join("; ")

    // Carrying on an existing plan: what's written already, so the model doesn't repeat itself.
    const existingRow = planId ? await prisma.jordanMealPlan.findUnique({ where: { id: String(planId) } }) : null
    const existing: Plan | null = existingRow ? normalisePlan(existingRow.plan) : null
    const alreadyMade = existing ? existing.days.flatMap(d => d.meals.map(m => m.name)).slice(-24) : []

    const model = await getToolModel("jordan_meals", modelId)
    const slots = chosenMeals((p as any).meals, p.mealsPerDay)
    // ⚠⚠ ROOM TO THINK. The default model thinks before it writes, and its thoughts come out of the
    // SAME allowance as the answer — so two days of full recipes (more with a dessert slot, more
    // again when every meal carries two people's servings) could arrive empty or chopped, and that
    // was reported as "couldn't read the AI's answer" (Jordan, 2026-09-21: "still getting a lot").
    // Gemini is given twice the room; Claude streams and keeps its own figure.
    let meta: { finishReason?: string; outputTokens?: number; thinkingTokens?: number } = {}
    const raw = await generateAiText({
      model,
      system: planSystemPrompt(),
      prompt: planUserPrompt({
        name: p.name, sex: p.sex, age: p.age, weightKg: p.weightKg, t, days,
        goal: (p as any).goal, goalDelta: p.goalDelta,
        slots,
        likes, dislikes, notes,
        brief: String(brief ?? "").slice(0, 2000),
        fromDay, toDay, alreadyMade, people,
      }),
      json: true,
      maxOutputTokens: /^claude/i.test(model) ? 16384 : 32768,
      onMeta: m => { meta = m },
    })

    // ⚠ Never all-or-nothing: a reply that won't parse whole still gives up its COMPLETE days
    // (lib/jordan-meals.ts → parsePlanReply). Each call is saved as it lands and the page asks for
    // the next day after whatever is saved, so a salvaged day is progress, not a fudge.
    const reply = parsePlanReply(raw, slots.length)
    const parsed = reply.plan
    const spent = `model ${model}, finish ${meta.finishReason ?? "?"}, output ${meta.outputTokens ?? "?"} tokens (thinking ${meta.thinkingTokens ?? "?"}), ${raw.length} chars, days ${fromDay}-${toDay}`
    if (!parsed.days.length) {
      // ⚠ LOGGED WITH BOTH ENDS OF THE REPLY. Without this the only evidence was the sentence on
      // his screen; the head shows prose or a fence, the tail shows where it stopped.
      console.error(`jordan/meals/plan: nothing readable — ${spent}, ${reply.dropped} incomplete day(s). HEAD ${JSON.stringify(raw.slice(0, 200))} TAIL ${JSON.stringify(raw.slice(-200))}`)
      const ranOut = meta.finishReason === "MAX_TOKENS"
      const why = !raw.trim()
        ? (ranOut ? "The AI used its whole allowance thinking and wrote nothing" : "The AI sent back an empty reply")
        : ranOut ? "The reply ran out of room before one day was finished" : "The AI's reply wasn't readable"
      const got = existing?.days.length ?? 0
      return NextResponse.json({
        error: `${why} (day ${fromDay}${toDay > fromDay ? ` to ${toDay}` : ""}). ${got ? `Days 1 to ${got} are saved — try again to carry on from there.` : "Try again."}`,
        // The page asks again for ONE day before it gives up — see makePlan().
        retryable: true,
        planId: existingRow?.id ?? null,
      }, { status: 502 })
    }
    if (reply.how === "salvaged") console.warn(`jordan/meals/plan: reply not valid JSON — kept ${parsed.days.length} complete day(s), dropped ${reply.dropped}. ${spent}`)

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
        partnerId: partner?.id ?? null,
        title: parsed.title || `${days}-day plan${partner ? ` for ${p.name} and ${partner.name}` : ""}`,
        days: written.length,
        // ⚠ `people` is FROZEN here with the rest of the targets: the plan must still be able to
        // explain whose numbers it was split against, even if a profile changes afterwards.
        targets: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, bmr: t.bmr, tdee: t.tdee, people } as any,
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
