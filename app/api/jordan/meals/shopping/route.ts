import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { friendlyGeminiError } from "@/lib/gemini-retry"
import { parseModelJson } from "@/lib/model-json"
import { normalisePlan, normaliseShopping, shoppingSystemPrompt, shoppingUserPrompt } from "@/lib/jordan-meals"

export const maxDuration = 120

// POST /api/jordan/meals/shopping — the shopping list for a saved plan, combined across every
// recipe and grouped by aisle, saved on the plan. Body: { planId, model? }
// Re-making the list keeps the ticks on items that come back with the same name.
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { planId, model: modelId = "" } = await req.json()
    if (!planId) return NextResponse.json({ error: "Missing plan" }, { status: 400 })
    const row = await prisma.jordanMealPlan.findUnique({ where: { id: String(planId) } })
    if (!row) return NextResponse.json({ error: "That plan no longer exists" }, { status: 404 })

    const plan = normalisePlan(row.plan)
    if (!plan.days.length) return NextResponse.json({ error: "That plan has no meals in it" }, { status: 400 })

    const model = await getToolModel("jordan_meals", modelId)
    const raw = await generateAiText({
      model,
      system: shoppingSystemPrompt(),
      prompt: shoppingUserPrompt(plan),
      json: true,
      maxOutputTokens: 8192,
    })

    const previous = row.shopping ? normaliseShopping(row.shopping) : null
    const shopping = normaliseShopping(parseModelJson(raw), previous)
    if (!shopping.groups.length) {
      return NextResponse.json({ error: "Couldn't read the AI's list — try again." }, { status: 502 })
    }

    await prisma.jordanMealPlan.update({ where: { id: row.id }, data: { shopping: shopping as any } })
    return NextResponse.json({ shopping })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    console.error("jordan/meals/shopping:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
