import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { friendlyGeminiError } from "@/lib/gemini-retry"
import { parseModelJson } from "@/lib/model-json"
import { normalisePlan, planOut, planSystemPrompt, planUserPrompt, targets } from "@/lib/jordan-meals"

export const maxDuration = 180

// POST /api/jordan/meals/plan — write a plan for a profile and save it.
// Body: { profileId, days (1–7), brief?, model? }
//
// ⚠ The targets are worked out HERE from the saved profile, with the same maths the screen
// shows (lib/jordan-meals.ts), and frozen onto the plan. The shopping list is a SEPARATE call
// (/shopping) so neither answer is huge — a seven-day plan with full recipes is already the
// largest thing this menu asks a model for.
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { profileId, days: rawDays = 1, brief = "", model: modelId = "" } = await req.json()
    if (!profileId) return NextResponse.json({ error: "Pick a profile first" }, { status: 400 })
    const days = Math.max(1, Math.min(7, Math.round(Number(rawDays)) || 1))

    const p = await prisma.jordanMealProfile.findUnique({ where: { id: String(profileId) } })
    if (!p) return NextResponse.json({ error: "That profile no longer exists" }, { status: 404 })

    const t = targets(p)
    if (!t) return NextResponse.json({ error: "Fill in sex, age, height and weight first — the targets come from those." }, { status: 400 })

    const model = await getToolModel("jordan_meals", modelId)
    const raw = await generateAiText({
      model,
      system: planSystemPrompt(),
      prompt: planUserPrompt({
        name: p.name, sex: p.sex, age: p.age, weightKg: p.weightKg, t, days,
        mealsPerDay: p.mealsPerDay, likes: p.likes, dislikes: p.dislikes, notes: p.notes,
        brief: String(brief ?? "").slice(0, 2000),
      }),
      json: true,
      maxOutputTokens: 16384,
    })

    const parsed = parseModelJson(raw)
    const plan = normalisePlan(parsed)
    if (!plan.days.length) {
      const cut = raw.trim() && !raw.trim().endsWith("}")
      return NextResponse.json({
        error: cut ? "The reply was cut off — try fewer days at a time." : "Couldn't read the AI's answer — try again.",
      }, { status: 502 })
    }

    const row = await prisma.jordanMealPlan.create({
      data: {
        profileId: p.id,
        title: plan.title || `${days}-day plan`,
        days: plan.days.length,
        targets: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, bmr: t.bmr, tdee: t.tdee } as any,
        plan: plan as any,
        brief: String(brief ?? "").slice(0, 2000),
        model,
      },
    })
    return NextResponse.json({ plan: planOut(row) })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    console.error("jordan/meals/plan:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
