import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { findComparables, summariseComparables, type ComparableSummary } from "@/lib/comparables"

export const maxDuration = 300

// POST /api/research/valuation   (multipart: image0…imageN, optional note)
//
// Cataloguing → Research → Valuations. A customer emails photos asking what
// their things are worth; the cataloguer drops the photos in and gets a priced
// list to quote from.
//
// ⚠ THE FIGURES MUST COME IN UNDER WHAT THE ITEMS REALLY MAKE. Quoting high and
// selling low is the failure that matters here, so every choice below leans low:
//   • the estimate is anchored on OUR OWN sold archive (WarehouseItem.hammerPrice)
//     rather than the model's memory of retail/asking prices, which run high
//   • the archive figure is a MEDIAN of single-item sales, group lots excluded
//   • a safety discount is applied by the CLIENT, not here — see below
//
// ⚠ The discount is deliberately NOT applied in this route. The route returns
// honest market figures and the page takes the percentage off, so the number is
// arithmetic the user can see and adjust, not a value buried in a prompt where
// it silently drifts away from what the business actually does.

const MAX_IMAGES = 20

type ValuedItem = {
  name: string
  maker: string | null
  model: string | null
  catalogueNumber: string | null
  variant: string | null
  quantity: number
  condition: string | null
  confidence: "high" | "medium" | "low"
  /** True for "a pile of loose stuff" — one rough line, not invented detail. */
  mixedLot: boolean
  photoIndex: number | null
  searchTerms: string[]
  estimateLow: number
  estimateHigh: number
  basis: string | null
}

const PROMPT = `You value collectable items for a UK auction house from photographs a customer has sent in.

Use Google Search to CHECK any maker, model or catalogue number before stating it — a number recalled from memory is often wrong, and a wrong number produces a wrong valuation.

Return ONLY a JSON object, no markdown fence:
{
  "items": [
    {
      "name": "what a cataloguer would call it, e.g. 'Corgi 261 James Bond Aston Martin DB5, boxed'",
      "maker": "Corgi" or null,
      "model": "the model/item name" or null,
      "catalogueNumber": "the maker's reference number" or null,
      "variant": "colour/version detail that changes the value" or null,
      "quantity": 1,
      "condition": "one short phrase on what you can SEE — 'boxed, box tatty', 'playworn, no box'" or null,
      "confidence": "high" | "medium" | "low",
      "mixedLot": false,
      "photoIndex": 0,
      "searchTerms": ["3-6 short terms to find this in a sold-lot archive"],
      "estimateLow": 80,
      "estimateHigh": 120,
      "basis": "one short sentence on what the figure rests on"
    }
  ],
  "overallNotes": "anything the cataloguer should know before quoting — poor photos, something needing a closer look, a possible high-value piece"
}

HOW TO SPLIT THE PHOTOS INTO ITEMS:
- Identify SEPARATELY anything individually identifiable and worth more than about £20 on its own — a boxed model, a named figure, a piece of a known set.
- A pile of loose, low-value, hard-to-identify things is ONE row with "mixedLot": true, a quantity that is your best count (approximate is fine), a name like "Mixed loose diecast, approx 40 pieces", and a single rough range. Do NOT invent forty rows of detail you cannot actually see. Mark it confidence "low".
- The SAME item photographed from several angles is ONE row, not one per photo. Set photoIndex to the clearest photo of it.
- If a photo shows nothing valuable or nothing identifiable, leave it out rather than padding the list.

HOW TO PRICE:
- estimateLow/estimateHigh are what the item would realistically fetch at AUCTION HAMMER in the UK — not retail, not a dealer's asking price, not a completed eBay "buy it now". Auction hammer is materially lower than all of those.
- The figures are for the WHOLE ROW. If quantity is more than 1, price all of them together — never per unit. So a row of 40 loose diecast is the price of all 40.
- Price what you can SEE. Missing boxes, paint chips, incomplete sets and playwear all cut the figure hard — say so in "condition".
- Whole pounds, no currency symbols, no text in the number fields.
- If you genuinely cannot value it, use 0 for both and explain in "basis". A zero we can spot is better than a number we cannot trust.
- Do not apply any discount or safety margin yourself. Give the honest market figure — the system applies the house margin afterwards.`

/** Pull the JSON object out of a model reply that may be fenced or padded. */
function parseJson(text: string): { items: ValuedItem[]; overallNotes?: string } | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim()
  const start = cleaned.indexOf("{")
  const end   = cleaned.lastIndexOf("}")
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""))
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const formData = await req.formData()
    const files = formData.getAll("images").filter((f): f is File => f instanceof File)
    if (files.length === 0) return NextResponse.json({ error: "No photos were sent" }, { status: 400 })
    if (files.length > MAX_IMAGES) {
      return NextResponse.json({ error: `That's ${files.length} photos — send up to ${MAX_IMAGES} at a time.` }, { status: 400 })
    }

    const imageParts = await Promise.all(files.map(async f => ({
      inlineData: {
        data: Buffer.from(await f.arrayBuffer()).toString("base64"),
        mimeType: f.type || "image/jpeg",
      },
    })))

    const modelId = await getToolModel("research_valuation", formData.get("model") as string | null)
    const genai   = new GoogleGenerativeAI(apiKey)
    const model   = genai.getGenerativeModel({
      model: modelId,
      tools: [{ googleSearch: {} } as any],
    })

    // Whatever the customer said in their email — "my late father's collection",
    // "the trains are all runners". That context outranks a guess from a photo.
    const note = ((formData.get("note") as string) ?? "").trim().slice(0, 1000)
    const prompt = note
      ? `${PROMPT}\n\nThe customer says: "${note}"\nTreat that as fact unless the photos plainly contradict it.`
      : PROMPT

    let text: string
    try {
      const result   = await model.generateContent([...imageParts, { text: prompt }])
      const response = result.response

      // ⚠ Check both block paths BEFORE .text() — calling it on a blocked
      // response throws and loses the reason (house rule).
      const promptBlock = response.promptFeedback?.blockReason
      if (promptBlock) {
        return NextResponse.json({ error: `Gemini blocked the photos (${promptBlock}).` }, { status: 422 })
      }
      const finishReason = response.candidates?.[0]?.finishReason
      if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
        return NextResponse.json({ error: `Gemini blocked the reply (${finishReason}).` }, { status: 422 })
      }
      text = response.text()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes("400") || msg.toLowerCase().includes("tool") || msg.toLowerCase().includes("grounding")) {
        return NextResponse.json(
          { error: "The configured Valuations model doesn't support Google Search. Pick another in Admin → AI Models." },
          { status: 400 },
        )
      }
      throw e
    }

    const parsed = parseJson(text)
    if (!parsed || !Array.isArray(parsed.items)) {
      return NextResponse.json({ error: "Couldn't read the valuation back — try again, or with fewer photos." }, { status: 502 })
    }

    // ── Anchor each item on what WE have actually sold ───────────────────────
    // A mixed lot is skipped: there is no single item to look up, and matching a
    // vague "assorted diecast" against the archive returns noise that would make
    // the figure look better-founded than it is.
    const rows = await Promise.all(parsed.items.slice(0, 60).map(async (raw, i) => {
      const item: ValuedItem = {
        name: String(raw?.name ?? "").trim() || "Unidentified item",
        maker: raw?.maker ?? null,
        model: raw?.model ?? null,
        catalogueNumber: raw?.catalogueNumber ?? null,
        variant: raw?.variant ?? null,
        quantity: Math.max(1, num(raw?.quantity) || 1),
        condition: raw?.condition ?? null,
        confidence: raw?.confidence === "high" || raw?.confidence === "medium" ? raw.confidence : "low",
        mixedLot: raw?.mixedLot === true,
        photoIndex: Number.isInteger(raw?.photoIndex) ? raw.photoIndex : null,
        searchTerms: Array.isArray(raw?.searchTerms) ? raw.searchTerms.map(String).slice(0, 8) : [],
        estimateLow: num(raw?.estimateLow),
        estimateHigh: num(raw?.estimateHigh),
        basis: raw?.basis ?? null,
      }
      // A model that returns them the wrong way round would otherwise produce a
      // negative-looking range in the table.
      if (item.estimateHigh && item.estimateLow > item.estimateHigh) {
        const t = item.estimateLow; item.estimateLow = item.estimateHigh; item.estimateHigh = t
      }

      let archive: ComparableSummary | null = null
      if (!item.mixedLot) {
        try {
          archive = summariseComparables(await findComparables(item))
        } catch (e) {
          // The archive is a bonus. Losing it must not lose the valuation.
          console.error("research/valuation comparables error:", e)
        }
      }

      return { id: `${i}`, ...item, archive }
    }))

    return NextResponse.json({
      items: rows,
      overallNotes: typeof parsed.overallNotes === "string" ? parsed.overallNotes : "",
      photoCount: files.length,
      model: modelId,
    })
  } catch (e: unknown) {
    console.error("research/valuation error:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Valuation failed" }, { status: 500 })
  }
}
