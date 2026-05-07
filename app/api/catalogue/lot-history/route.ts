import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 120

// POST /api/catalogue/lot-history
// Body: { lot: LotData, modelId?: string, customInstructions?: string }
// Returns: { extraDetails: string, defaultInstructions: string }

type LotData = {
  title:       string
  description: string
  keyPoints:   string
  category:    string | null
  subCategory: string | null
  brand:       string | null
  condition:   string | null
  estimateLow: number | null
  estimateHigh:number | null
  lotNumber:   string
}

export const DEFAULT_INSTRUCTIONS = `Write a single, long, detailed SEO-optimised paragraph (250–400 words) about the item described below. This paragraph will appear on the auction lot page to help collectors find it via search engines.

The paragraph should cover ALL of the following where relevant:
- History and background of the manufacturer or brand (founding, key years, notable products, country of origin)
- What makes this specific type of item collectable and desirable
- Details about the particular item: model, era, variant, features, materials
- Why collectors seek this out (rarity, nostalgia, investment value, cultural significance)
- Any notable information about the condition or completeness
- Relevant keywords woven in naturally (brand name, product type, era, materials, collector terms)

Write in flowing, informative prose — NOT as bullet points. British English throughout. Do not start with "This" or "The item". Do not mention Vectis by name. Output plain text only — no HTML tags, no headings, no markdown.`

function buildPrompt(lot: LotData, instructions: string): string {
  const estimate = lot.estimateLow && lot.estimateHigh
    ? `£${lot.estimateLow}–£${lot.estimateHigh}`
    : null

  return `You are a specialist in antique toys, collectables, and auction house copywriting for Vectis Auctions, one of the UK's leading specialist toy and collectable auction houses.

${instructions}

LOT DETAILS:
Lot ${lot.lotNumber}: ${lot.title}
${lot.description ? `Description: ${lot.description}` : ""}
${lot.keyPoints ? `Key points: ${lot.keyPoints}` : ""}
${lot.category ? `Category: ${lot.category}` : ""}
${lot.subCategory ? `Sub-category: ${lot.subCategory}` : ""}
${lot.brand ? `Brand/Manufacturer: ${lot.brand}` : ""}
${lot.condition ? `Condition: ${lot.condition}` : ""}
${estimate ? `Estimate: ${estimate}` : ""}`
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { lot, modelId, customInstructions } = await req.json() as {
      lot: LotData
      modelId?: string
      customInstructions?: string
    }
    if (!lot) return NextResponse.json({ error: "No lot provided" }, { status: 422 })

    const instructions = customInstructions?.trim() || DEFAULT_INSTRUCTIONS
    const prompt = buildPrompt(lot, instructions)

    const genai  = new GoogleGenerativeAI(apiKey)
    const model  = genai.getGenerativeModel({ model: modelId || "gemini-2.5-flash-preview-04-17" })

    const result   = await model.generateContent(prompt)
    const response = result.response

    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) {
      return NextResponse.json({ error: `Blocked by Gemini: ${promptBlock}` }, { status: 422 })
    }

    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Gemini stopped: ${finishReason}` }, { status: 422 })
    }

    return NextResponse.json({ extraDetails: response.text().trim() })
  } catch (e: any) {
    console.error("lot-history error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
