import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { withGeminiRetry, friendlyGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 120

// /api/jordan/cars/advert — write a for-sale advert for a car. Locked to jordan.orange.
// POST { carId, style?: "autotrader" | "marketplace" | "short" } → { advert }
//
// Everything it says comes from the car's own record: spec, mileage, MOT/tax dates, the
// service and MOT history, notes, and the latest valuation for an asking price. Anything it
// doesn't know goes in [square brackets] for Jordan to fill in — it must never invent a
// feature, an owner count or a history the record doesn't hold. Saved on the car (advert)
// so it can be edited and kept.

const STYLES: Record<string, string> = {
  autotrader:  "a full AutoTrader-style private advert: a one-line headline, then 3–5 short paragraphs (overview · spec and condition · history and paperwork · why it's being sold / what's included · viewing and contact), then a short bullet list of the key facts",
  marketplace: "a Facebook Marketplace / Gumtree style advert: friendly, plain, about 120–180 words, headline first, key facts as a short list at the end, no waffle",
  short:       "a very short advert for a classifieds site or a car-group post: a headline line and 3–4 sentences, under 80 words",
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const b = await req.json()
    if (!b.carId) return NextResponse.json({ error: "Missing carId" }, { status: 400 })
    const style = STYLES[String(b.style)] ? String(b.style) : "autotrader"

    const car = await prisma.jordanCar.findUnique({
      where: { id: String(b.carId) },
      include: { records: { orderBy: { date: "desc" } } },
    })
    if (!car) return NextResponse.json({ error: "Car not found" }, { status: 404 })
    if (!car.make && !car.model) return NextResponse.json({ error: "Fill in at least the make and model first." }, { status: 400 })

    // The latest real valuation, if the table is there (it arrived later than the car table).
    let price: { mid: number; low: number | null; high: number | null; asOf: Date } | null = null
    try {
      const v = await prisma.jordanCarValuation.findFirst({
        where: { carId: car.id, source: { not: "AI_HISTORY" } },
        orderBy: { asOf: "desc" }, select: { mid: true, low: true, high: true, asOf: true },
      })
      if (v) price = v
    } catch { /* value table not migrated yet — the advert just leaves the price blank */ }

    const d = (x: Date | null) => (x ? x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "")
    const KIND: Record<string, string> = { MOT: "MOT", SERVICE: "Service", REPAIR: "Repair", TAX: "Tax", INSURANCE: "Insurance", OTHER: "Other" }
    const history = car.records
      .filter(r => r.kind === "MOT" || r.kind === "SERVICE" || r.kind === "REPAIR")
      .slice(0, 25)
      .map(r => `- ${d(r.date)} · ${KIND[r.kind] ?? r.kind}${r.result ? ` (${r.result === "PASS" ? "pass" : "FAIL"})` : ""}${r.mileage != null ? ` · ${r.mileage.toLocaleString("en-GB")} miles` : ""}${r.garage ? ` · ${r.garage}` : ""}${r.notes ? ` · ${r.notes.replace(/\s+/g, " ").slice(0, 160)}` : ""}`)

    const facts = [
      `CAR: ${[car.year, car.make, car.model, car.colour, car.fuel].filter(Boolean).join(" ")}`,
      car.reg ? `REGISTRATION: ${car.reg}` : "",
      car.mileage != null ? `MILEAGE: ${car.mileage.toLocaleString("en-GB")} miles` : "MILEAGE: [mileage]",
      car.spec ? `SPEC / EXTRAS (from the owner): ${car.spec.replace(/\s+/g, " ")}` : "SPEC / EXTRAS: none given",
      car.motDue ? `MOT UNTIL: ${d(car.motDue)}` : "MOT UNTIL: [MOT date]",
      car.taxDue ? `TAX UNTIL: ${d(car.taxDue)}` : "",
      car.serviceDue ? `NEXT SERVICE DUE: ${d(car.serviceDue)}` : "",
      car.boughtOn ? `OWNED SINCE: ${d(car.boughtOn)}` : "",
      price ? `ASKING PRICE GUIDE: about £${price.mid}${price.low != null && price.high != null ? ` (private-sale range £${price.low}–£${price.high})` : ""}, valued ${d(price.asOf)}` : "ASKING PRICE GUIDE: none — write [price]",
      car.notes ? `OWNER'S NOTES: ${car.notes.replace(/\s+/g, " ").slice(0, 1500)}` : "",
      history.length ? `SERVICE / MOT / REPAIR HISTORY (newest first):\n${history.join("\n")}` : "SERVICE / MOT / REPAIR HISTORY: nothing recorded",
    ].filter(Boolean).join("\n")

    const prompt = `You write honest, appealing private car-sale adverts for the UK market, in British English. Write ${STYLES[style]}.

RULES
- Use ONLY the facts below. Never invent a feature, an owner count, a reason for sale, a service that isn't listed, or a condition claim the owner hasn't made.
- Anything an advert normally states that you have NOT been given goes in [square brackets] for the owner to fill in — e.g. [number of owners], [reason for sale], [any known faults].
- Lead with what makes THIS car worth buying: the spec and variant first (it is what a buyer searches for), then mileage, MOT, history.
- Summarise the history in plain words (e.g. "MOT'd every year, last three passes clean, serviced at … in …") — don't paste the list.
- Give the asking price as "£N" from the guide, rounded to a sensible figure, with "ono" only if the guide shows a range. If there is no guide, write [price].
- No hype words (stunning, immaculate, must see), no emojis, no hashtags, no "first to see will buy".
- End with a plain line for viewing/contact with [location] and [phone/message] placeholders.
- Plain text only: no markdown headings, no asterisks, no bold. Bullets as "- ".

FACTS
${facts}`

    const modelId = await getToolModel("jordan_fun", null)
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: modelId })
    const resp = (await withGeminiRetry(() => model.generateContent(prompt))).response
    const block = resp.promptFeedback?.blockReason
    if (block) return NextResponse.json({ error: `Blocked by Gemini: ${block}` }, { status: 422 })
    const finish = resp.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") return NextResponse.json({ error: `Blocked by Gemini (${finish})` }, { status: 422 })

    const advert = resp.text().trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").replace(/\*\*/g, "").trim()
    if (!advert) return NextResponse.json({ error: "The writer came back empty — try again." }, { status: 502 })

    // Saved on the car so it can be edited and kept. Minimal select: the write must
    // survive a column that hasn't been migrated yet elsewhere on the row.
    try {
      await prisma.jordanCar.update({ where: { id: car.id }, data: { advert }, select: { id: true } })
    } catch (e: any) {
      if (!/does not exist|P2021|P2022/i.test(String(e?.message ?? e))) throw e
      // Column not there yet — still hand the text back; it just won't be remembered.
      return NextResponse.json({ advert, unsaved: true })
    }
    return NextResponse.json({ advert })
  } catch (e: any) {
    console.error("jordan/cars/advert POST:", e)
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
