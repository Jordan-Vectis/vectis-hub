import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { friendlyGeminiError } from "@/lib/gemini-retry"
import { parseModelJson } from "@/lib/model-json"
import {
  applyMealSwap, normaliseMeal, normalisePlan, normaliseMealOptions, normaliseShopping,
  planOut, planPeople, swapMealSystemPrompt, swapMealUserPrompt,
} from "@/lib/jordan-meals"

export const maxDuration = 120

// /api/jordan/meals/swap — "I don't fancy that one".
//
// POST gives three complete replacement meals to pick from; PUT puts the chosen one into the
// saved plan. ⚠ Three FULL recipes come back in one call, so picking one applies instantly
// rather than making him wait for the AI twice.
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { planId, dayNo, index, why = "", model: modelId = "" } = await req.json()
    if (!planId || dayNo == null || index == null) return NextResponse.json({ error: "Which meal?" }, { status: 400 })

    const row = await prisma.jordanMealPlan.findUnique({ where: { id: String(planId) }, include: { profile: true } })
    if (!row) return NextResponse.json({ error: "That plan no longer exists" }, { status: 404 })

    const plan = normalisePlan(row.plan)
    const day  = plan.days.find(d => d.day === Number(dayNo))
    const meal = day?.meals[Number(index)]
    if (!meal) return NextResponse.json({ error: "That meal isn't in the plan any more" }, { status: 404 })

    const p = row.profile
    // ⚠ On a couple's plan the replacement has to be SPLIT the same way, or one swapped dinner
    // leaves that day with no portions for either of them and the per-person totals go wrong.
    const people = planPeople((row.targets && typeof row.targets === "object" ? row.targets : {}) as Record<string, unknown>)
    const partner = row.partnerId ? await prisma.jordanMealProfile.findUnique({ where: { id: row.partnerId } }) : null

    const model = await getToolModel("jordan_meals", modelId)
    const raw = await generateAiText({
      model,
      system: swapMealSystemPrompt(),
      prompt: swapMealUserPrompt({
        meal, dayNo: Number(dayNo), goal: (p as any).goal, people,
        likes: [p.likes, partner?.likes].filter(s => s?.trim()).join("; "),
        dislikes: [p.dislikes, partner?.dislikes].filter(s => s?.trim()).join("; "),
        notes: [p.notes, partner?.notes].filter(s => s?.trim()).join("; "),
        why: String(why ?? "").slice(0, 500),
        // Everything else on the plan, so it doesn't suggest Tuesday's dinner again.
        otherMeals: plan.days.flatMap(d => d.meals.map(m => m.name)).filter(n => n !== meal.name).slice(0, 30),
      }),
      json: true,
      maxOutputTokens: 6144,
    })

    const options = normaliseMealOptions(parseModelJson(raw))
    if (!options.length) return NextResponse.json({ error: "Couldn't read the AI's answer — try again." }, { status: 502 })
    return NextResponse.json({ options })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    console.error("jordan/meals/swap POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

/** PUT — make the swap stick. Body: { planId, dayNo, index, meal } */
export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { planId, dayNo, index, meal } = await req.json()
    if (!planId || dayNo == null || index == null || !meal) return NextResponse.json({ error: "Missing details" }, { status: 400 })

    const row = await prisma.jordanMealPlan.findUnique({ where: { id: String(planId) } })
    if (!row) return NextResponse.json({ error: "That plan no longer exists" }, { status: 404 })

    const next = applyMealSwap(normalisePlan(row.plan), Number(dayNo), Number(index), normaliseMeal(meal))
    if (!next) return NextResponse.json({ error: "That meal isn't in the plan any more" }, { status: 404 })

    // ⚠ The shopping list was written for the meal that has just gone. It is NOT thrown away —
    // the ticks in it are worth keeping — but it is marked so the screen can say it is out of
    // date. A list that quietly buys for a meal he is no longer cooking is worse than no list.
    const shopping = row.shopping ? { ...normaliseShopping(row.shopping), stale: true } : null

    const saved = await prisma.jordanMealPlan.update({
      where: { id: row.id },
      data: { plan: next as any, ...(shopping ? { shopping: shopping as any } : {}) },
    })
    return NextResponse.json({ plan: planOut(saved) })
  } catch (e: any) {
    console.error("jordan/meals/swap PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
