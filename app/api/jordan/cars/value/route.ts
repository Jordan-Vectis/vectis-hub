import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { groundedJson } from "@/lib/mcoc-ai"
import { friendlyGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 120

// /api/jordan/cars/value — what a car is worth. Locked to jordan.orange.
//
// POST { carId }                       → ask the AI (Google Search grounded) for today's
//                                        value AND an estimate of each past year-end. Today's
//                                        figure is kept for ever (source "AI" — the trend is
//                                        these snapshots); the past-year guesses are source
//                                        "AI_HISTORY" and are REPLACED on every re-run so they
//                                        never pile up.
// POST { carId, manual: true, asOf, mid, low?, high?, note? }
//                                      → a real quote typed in (WeBuyAnyCar, a dealer, an advert).
// DELETE { id }                        → remove one row.
//
// ⚠ No free UK valuation API exists (AutoTrader / Parkers / cap hpi are all paid), so the AI
// estimate is the honest route and the screen says it is an estimate.

function missingTable(e: any): boolean {
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(String(e?.message ?? e))
}
const pounds = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Math.round(Number(String(v).replace(/[^\d.-]/g, "")))
  return Number.isFinite(n) && n >= 0 ? n : null
}

const PROMPT = `You are a UK used-car valuer. Estimate what the car below is worth in POUNDS STERLING on the UK market TODAY, and what a car like it was typically worth at the END of each past year listed. Use live UK sources where you can (AutoTrader, Parkers, WeBuyAnyCar, Motorway, eBay sold listings) and the car's age and mileage. Where mileage history isn't known, assume typical UK mileage for its age.

Return STRICT JSON only (no prose, no markdown fences):
{
  "current": {
    "low": number,      // private-sale, a quick sale / rough example
    "mid": number,      // private-sale, a fair typical price — the headline figure
    "high": number,     // private-sale, a tidy low-mileage example
    "tradeIn": number   // what a dealer or WeBuyAnyCar would offer
  },
  "history": [ { "year": number, "mid": number } ],   // one entry per year asked for, a fair private-sale figure at the END of that year
  "summary": string,    // 2–3 plain sentences: what drives the value and which way it is heading
  "confident": boolean  // false if the make/model/year is too vague to value
}

Whole pounds, no currency symbols, realistic figures (a 15-year-old hatchback is hundreds, not hundreds of thousands).`

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const b = await req.json()
    if (!b.carId) return NextResponse.json({ error: "Missing carId" }, { status: 400 })

    const car = await prisma.jordanCar.findUnique({ where: { id: String(b.carId) } })
    if (!car) return NextResponse.json({ error: "Car not found" }, { status: 404 })

    // ── A real quote, typed in ──
    if (b.manual) {
      const mid = pounds(b.mid)
      if (mid == null) return NextResponse.json({ error: "Give it a value in pounds" }, { status: 400 })
      const asOf = new Date(String(b.asOf ?? ""))
      if (isNaN(asOf.getTime())) return NextResponse.json({ error: "Give it a date" }, { status: 400 })
      const row = await prisma.jordanCarValuation.create({
        data: {
          carId: car.id, asOf, mid,
          low: pounds(b.low), high: pounds(b.high), tradeIn: null,
          mileage: car.mileage, source: "MANUAL",
          note: String(b.note ?? "").trim().slice(0, 2000),
        },
      })
      return NextResponse.json({ id: row.id })
    }

    // ── The AI valuer ──
    const desc = [car.year, car.make, car.model, car.colour, car.fuel].filter(Boolean).join(" ")
    if (!car.make && !car.model) {
      return NextResponse.json({ error: "Fill in at least the make and model first — the valuer has nothing to go on." }, { status: 400 })
    }
    const thisYear = new Date().getFullYear()
    // Past year-ends: from the car's year (or when it was bought, if later), at most ten back.
    const firstYear = Math.max(
      parseInt(car.year, 10) || thisYear,
      car.boughtOn ? car.boughtOn.getFullYear() : 0,
      thisYear - 10,
    )
    const years: number[] = []
    for (let y = firstYear; y < thisYear; y++) years.push(y)

    const lines = [
      `CAR: ${desc || "(no details)"}`,
      car.reg ? `REGISTRATION: ${car.reg}` : "",
      car.mileage != null ? `CURRENT MILEAGE: ${car.mileage.toLocaleString("en-GB")} miles` : "MILEAGE: not recorded",
      car.boughtOn ? `BOUGHT: ${car.boughtOn.toISOString().slice(0, 10)}${car.boughtPrice != null ? ` for £${car.boughtPrice}` : ""}` : "",
      car.soldOn ? `SOLD: ${car.soldOn.toISOString().slice(0, 10)}${car.soldPrice != null ? ` for £${car.soldPrice}` : ""}` : "",
      `TODAY: ${new Date().toISOString().slice(0, 10)}`,
      years.length ? `PAST YEAR-ENDS TO ESTIMATE: ${years.join(", ")}` : "PAST YEAR-ENDS TO ESTIMATE: none (return an empty history array)",
    ].filter(Boolean)

    let groundedFallback = false
    const modelId = await getToolModel("jordan_fun", null)
    const parsed = await groundedJson(`${PROMPT}\n\n${lines.join("\n")}`, null, () => { groundedFallback = true })

    const cur = parsed?.current ?? {}
    const mid = pounds(cur.mid)
    if (mid == null) return NextResponse.json({ error: "The valuer didn't give a figure — try again." }, { status: 502 })
    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim().slice(0, 2000) : ""
    const note = (groundedFallback ? "(answered without a live web search) " : "") + summary

    const history = (Array.isArray(parsed?.history) ? parsed.history : [])
      .map((h: any) => ({ year: parseInt(h?.year, 10), mid: pounds(h?.mid) }))
      .filter((h: any) => years.includes(h.year) && h.mid != null) as { year: number; mid: number }[]

    const now = new Date()
    await prisma.$transaction([
      // Past-year guesses are replaced, never stacked.
      prisma.jordanCarValuation.deleteMany({ where: { carId: car.id, source: "AI_HISTORY" } }),
      ...history.map(h => prisma.jordanCarValuation.create({
        data: { carId: car.id, asOf: new Date(Date.UTC(h.year, 11, 31, 12)), mid: h.mid, source: "AI_HISTORY", model: modelId },
      })),
      prisma.jordanCarValuation.create({
        data: {
          carId: car.id, asOf: now, mid,
          low: pounds(cur.low), high: pounds(cur.high), tradeIn: pounds(cur.tradeIn),
          mileage: car.mileage, source: "AI", note, model: modelId,
        },
      }),
    ])

    return NextResponse.json({
      ok: true, mid, low: pounds(cur.low), high: pounds(cur.high), tradeIn: pounds(cur.tradeIn),
      summary, confident: parsed?.confident !== false, groundedFallback, historyYears: history.length,
    })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "A database update is waiting — the value table isn't there yet." }, { status: 503 })
    console.error("jordan/cars/value POST:", e)
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.jordanCarValuation.delete({ where: { id: String(id) } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/cars/value DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
