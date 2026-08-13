import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { asSnapshot, snapshotToText, PLAN_CHANNELS } from "@/lib/marketing-plan"

export const maxDuration = 120

// POST /api/marketing/plan-suggest
// Body: { planId: string, modelId?: string, focus?: string }
// Returns: { objectives: [...], actions: [...], audience: string, summary: string, model: string }
//
// Reads the figures FROZEN on the plan (never live GA) so the suggestions
// discuss the same numbers the plan and its PDF show.

const CHANNEL_KEYS = PLAN_CHANNELS.map((c) => c.key).join(" | ")

// The stable half of the prompt — identical on every call, so it goes in
// `system`, which generateAiText already sends as a cache-marked block on
// Claude. The figures stay in `prompt`: putting anything per-plan up here would
// invalidate that cache on every request.
const SYSTEM = `You are a marketing analyst writing a marketing business plan for Vectis Auctions, a specialist toy and collectables auction house in Thornaby, Teesside. Vectis sells at live online auctions to collectors worldwide — diecast, model railway, Star Wars, teddy bears, dolls, TV & film, action figures, trading cards and similar. Buyers bid online, by telephone and by post; sellers consign collections.

You are given the website's Google Analytics figures for one period. Suggest what Vectis should DO next.

RULES
- British English throughout ("realised", "colour", "catalogue", "specialise").
- Ground EVERY suggestion in a figure you were given, and quote that figure in the wording. If the data does not support a suggestion, do not make it.
- Never invent facts about Vectis — no staff names, no claims about spend, budgets, ad accounts, tools or platforms you were not told about. If a suggestion depends on something unknown, phrase it as a check ("confirm whether…").
- Do not use the word "CRM". Do not mention internal auction codes (a letter followed by digits, e.g. F025).
- The only website address you may use is vectis.co.uk.
- Practical and specific. "Write two blog posts on Dinky Toys, the top site-search term (218 searches)" — not "improve content".
- Targets must be realistic movements on the baseline shown, not round-number wishes.

OUTPUT
Raw JSON only, matching exactly:
{
  "summary": "2-4 sentences on where the website stands this period — what the figures actually say. Plain prose.",
  "audience": "2-4 sentences on who is visiting, drawn from the country, region, device and new-vs-returning figures, and what that implies for targeting.",
  "objectives": [
    { "title": "...", "metric": "the figure it is measured on, e.g. Sessions", "baseline": "the current value from the figures", "target": "a realistic value for the end of the period", "notes": "one sentence on why this target" }
  ],
  "actions": [
    { "channel": "one of: ${CHANNEL_KEYS}", "title": "short imperative, e.g. Rewrite the Star Wars landing page", "detail": "1-2 sentences naming the figure that justifies it", "effort": "Low|Medium|High", "impact": "Low|Medium|High" }
  ]
}
Give 4-6 objectives and 8-14 actions, spread across the channels the figures actually support.`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const planId = String(body?.planId ?? "").trim()
    if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

    const plan = await prisma.marketingPlan.findUnique({
      where: { id: planId },
      select: { name: true, periodLabel: true, snapshot: true, snapshotAt: true },
    })
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

    const snap = asSnapshot(plan.snapshot)
    if (!snap) {
      return NextResponse.json(
        { error: "This plan has no analytics figures yet — click “Refresh figures” first." },
        { status: 400 },
      )
    }

    const focus = String(body?.focus ?? "").trim().slice(0, 500)
    const model = await getToolModel("marketing_plan", body?.modelId)

    const prompt = `PLAN: ${plan.name}${plan.periodLabel ? ` — ${plan.periodLabel}` : ""}

${snapshotToText(snap)}
${focus ? `\nThe user has asked you to focus on: ${focus}` : ""}

Write the JSON now.`

    let raw: string
    try {
      // Roomy on purpose: this asks for the app's largest JSON answer (up to 6
      // objectives and 14 actions, each with prose), and on both providers
      // thinking tokens come out of the same budget. A tight cap doesn't
      // shorten the reply — it truncates it mid-object, which then fails
      // JSON.parse and surfaces as an unrecoverable error.
      raw = await generateAiText({ model, system: SYSTEM, prompt, json: true, maxOutputTokens: 16384 })
    } catch (e: any) {
      if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
      // A content block will never succeed on retry — 422, not 500 (RULES).
      if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
      throw e
    }

    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: "The AI didn't return usable JSON — try again." }, { status: 502 })
    }

    // Numbers are coerced, not dropped: models routinely answer "target": 15000
    // rather than "15,000", and discarding those left the target column blank.
    const str = (v: any, max: number) =>
      typeof v === "string" ? v.trim().slice(0, max)
      : typeof v === "number" && isFinite(v) ? String(v)
      : ""
    const level = (v: any) => (["Low", "Medium", "High"].includes(str(v, 10)) ? str(v, 10) : "")
    const channel = (v: any) => (PLAN_CHANNELS.some((c) => c.key === v) ? String(v) : "other")

    const objectives = (Array.isArray(parsed?.objectives) ? parsed.objectives : [])
      .map((o: any) => ({
        title:    str(o?.title, 200),
        metric:   str(o?.metric, 80),
        baseline: str(o?.baseline, 80),
        target:   str(o?.target, 80),
        notes:    str(o?.notes, 2000),
      }))
      .filter((o: any) => o.title)
      .slice(0, 12)

    const actions = (Array.isArray(parsed?.actions) ? parsed.actions : [])
      .map((a: any) => ({
        channel: channel(a?.channel),
        title:   str(a?.title, 200),
        detail:  str(a?.detail, 2000),
        effort:  level(a?.effort),
        impact:  level(a?.impact),
      }))
      .filter((a: any) => a.title)
      .slice(0, 24)

    if (objectives.length === 0 && actions.length === 0) {
      return NextResponse.json({ error: "The AI came back with nothing usable — try again." }, { status: 502 })
    }

    return NextResponse.json({
      model,
      summary:  str(parsed?.summary, 8000),
      audience: str(parsed?.audience, 8000),
      objectives,
      actions,
    })
  } catch (e: any) {
    console.error("plan-suggest error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
