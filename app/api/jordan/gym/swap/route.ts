import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { friendlyGeminiError } from "@/lib/gemini-retry"
import { parseModelJson } from "@/lib/model-json"
import {
  applySwap, matchLift, normaliseProgramme, normaliseSwap, programmeOut, suggest,
  swapSystemPrompt, swapUserPrompt, type Programme,
} from "@/lib/jordan-gym"
import { allLifts, getProfile, historyFor, missingTable, resolveLift } from "@/lib/jordan-gym-db"

export const maxDuration = 120

// /api/jordan/gym/swap — "the machine's taken / this one hurts / I hate it".
//
// POST gives a list to pick from; PUT swaps it into the programme for good.
// ⚠ The catalogue list comes back INSTANTLY and without the AI — same movement pattern, so the
// day still trains what it was built to train. The AI list is the extra, asked for on purpose,
// because waiting on a model while standing at a taken machine is not a feature.
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { slug, ai = false, why = "", create = null, model: modelId = "" } = await req.json()
    if (!slug) return NextResponse.json({ error: "Which exercise?" }, { status: 400 })

    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: "Couldn't open the profile" }, { status: 500 })
    const lifts = await allLifts()

    // A swap taken mid-session: make sure the chosen movement is a real catalogue entry (the AI
    // can suggest one that isn't there yet) and hand back its suggested weight, so a substitute
    // arrives with a proper number rather than an empty box.
    if (create?.slug) {
      const original = matchLift(String(slug), lifts)
      const { lift: made } = await resolveLift({
        slug: String(create.slug), name: String(create.name ?? create.slug),
        pattern: original?.pattern ?? "isolation",
        equipment: String(create.equipment ?? "barbell"), restSeconds: 120,
      }, lifts)
      const int = (v: any, dflt: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : dflt }
      const ex = { sets: int(create.sets, 3), repLow: int(create.repLow, 8), repHigh: int(create.repHigh, 12), rir: int(create.rir, 2) }
      const h = (await historyFor([made.id!])).get(made.id!) ?? []
      const mealGoal = ((profile.mealProfile?.goal ?? "maintain") as any)
      return NextResponse.json({ lift: made, suggestion: suggest(ex, made, h, mealGoal, Date.now()) })
    }
    const lift = matchLift(String(slug), lifts)
    if (!lift) return NextResponse.json({ error: "Unknown exercise" }, { status: 404 })

    // Same pattern, not the same exercise. Ordered so the ones he has actually done come first —
    // a swap with history behind it gets a real suggested weight straight away.
    const sameShape = lifts.filter(l => l.pattern === lift.pattern && l.slug !== lift.slug)
    const hist = await historyFor(sameShape.map(l => l.id!).filter(Boolean))
    const catalogue = sameShape
      .map(l => ({ lift: l, sessions: (hist.get(l.id!) ?? []).length }))
      .sort((a, b) => b.sessions - a.sessions || a.lift.name.localeCompare(b.lift.name))
      .map(x => ({ ...x.lift, sessions: x.sessions }))

    if (!ai) return NextResponse.json({ catalogue, options: [] })

    const model = await getToolModel("jordan_gym", modelId)
    const raw = await generateAiText({
      model,
      system: swapSystemPrompt(),
      prompt: swapUserPrompt({
        name: lift.name, pattern: lift.pattern,
        equipment: profile.equipment, injuries: profile.injuries, preferences: profile.preferences,
        slugs: sameShape.map(l => l.slug),
        history: String(why ?? "").slice(0, 500),
      }),
      json: true,
      maxOutputTokens: 2048,
    })
    const options = normaliseSwap(parseModelJson(raw))
    if (!options.length) return NextResponse.json({ catalogue, options: [], note: "The AI didn't come back with anything usable — the list above still works." })
    return NextResponse.json({ catalogue, options })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the gym tables aren't there yet." }, { status: 503 })
    console.error("jordan/gym/swap POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

/** PUT — make the swap stick. Body: { programmeId, dayName, slug, option: {slug,name,equipment,why} } */
export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { programmeId, dayName, slug, option } = await req.json()
    if (!programmeId || !dayName || !slug || !option?.slug) return NextResponse.json({ error: "Missing details" }, { status: 400 })

    const row = await prisma.jordanProgramme.findUnique({ where: { id: String(programmeId) } })
    if (!row) return NextResponse.json({ error: "That programme no longer exists" }, { status: 404 })

    const lifts = await allLifts()
    // An option the AI invented becomes a real catalogue entry here — visible, never silent, and
    // matched against the aliases first so it can't become a twin of something that exists.
    const { lift } = await resolveLift({
      slug: String(option.slug), name: String(option.name ?? option.slug),
      pattern: matchLift(String(slug), lifts)?.pattern ?? "isolation",
      equipment: String(option.equipment ?? "barbell"), restSeconds: 120,
    }, lifts)

    const plan = normaliseProgramme(row.plan as unknown as Programme)
    const next = applySwap(plan, String(dayName), String(slug), {
      slug: lift.slug, name: lift.name, equipment: lift.equipment, pattern: lift.pattern,
      sets: 3, repLow: 8, repHigh: 12, rir: 2, restSeconds: lift.restSec,
      note: String(option.why ?? "").slice(0, 200), substitute: "",
    })
    if (!next) return NextResponse.json({ error: "That exercise isn't in this day any more." }, { status: 404 })

    const saved = await prisma.jordanProgramme.update({ where: { id: row.id }, data: { plan: next as any } })
    return NextResponse.json({ programme: programmeOut(saved) })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the gym tables aren't there yet." }, { status: 503 })
    console.error("jordan/gym/swap PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
