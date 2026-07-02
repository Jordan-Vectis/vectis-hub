import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 120

export type LotGroup = {
  id:           number
  title:        string
  items:        string[]
  estimateLow:  number
  estimateHigh: number
  bounds:       { x: number; y: number; w: number; h: number } // % of image dimensions
  notes:        string
  colour:       string
}

export type LottingUpResult = {
  totalEstimateLow:  number
  totalEstimateHigh: number
  groups:            LotGroup[]
}

const COLOURS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
  "#84cc16", // lime
]

const SYSTEM_PROMPT = `You are an expert auction cataloguer at Vectis, a specialist toy and collectible auction house.

You will be given a photo of items laid out for cataloguing. Your job is to:
1. Identify all visible items
2. Group them into logical auction lots based on type, theme, value, and what collectors would want together
3. Estimate a sale value for each lot based on typical Vectis auction results
4. Also estimate the total value of everything in the photo
5. For each group, identify where vertically in the image those items appear

Return ONLY valid JSON in this exact format — no markdown, no explanation, just the JSON:

{
  "totalEstimateLow": <number>,
  "totalEstimateHigh": <number>,
  "groups": [
    {
      "id": 1,
      "title": "<short lot title>",
      "items": ["<item 1>", "<item 2>"],
      "estimateLow": <number>,
      "estimateHigh": <number>,
      "yTop": <number 0-100>,
      "yBottom": <number 0-100>,
      "notes": "<any condition notes or relevant detail>"
    }
  ]
}

VERTICAL POSITION RULES — very important:
yTop and yBottom describe where this lot's items appear vertically in the image.
  - 0 = the very top of the image
  - 100 = the very bottom of the image
  - yTop is where this lot starts (top edge)
  - yBottom is where this lot ends (bottom edge)
  - yBottom must always be greater than yTop
  - If items span the whole image: yTop=0, yBottom=100
  - If items are in the top half: yTop=0, yBottom=50
  - If items are in the bottom half: yTop=50, yBottom=100
  - If items are in the middle third: yTop=33, yBottom=67

For shelving units: count visible shelves from top. If there are 12 shelves and lot items are on shelves 3-5, those shelves start at roughly yTop=17 and end at yBottom=42.
If items from one lot appear on multiple non-adjacent shelves, use the range that covers from the topmost to bottommost item.

Other rules:
- Combine items of similar type/theme/value into sensible lots
- Do not create lots worth less than £5
- estimateLow and estimateHigh are in GBP as whole numbers
- Keep titles concise (under 60 characters)
- items should list individual pieces clearly`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  try {
    const formData = await req.formData()
    const file = formData.get("photo") as File | null
    if (!file) return NextResponse.json({ error: "No photo provided" }, { status: 400 })
    const modelId     = (formData.get("model") as string | null) ?? "gemini-2.5-flash-preview-04-17"
    const minLotValue = parseInt(formData.get("minLotValue") as string ?? "", 10) || null

    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    const mimeType = file.type || "image/jpeg"

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: await getToolModel("catalogue_lotting_up", modelId) })

    const minValueInstruction = minLotValue
      ? `\n\nIMPORTANT OVERRIDE — Minimum lot value: Every lot MUST have an estimateLow of at least £${minLotValue}. ` +
        `Combine items together until each lot reaches this minimum. ` +
        `It is better to have fewer, larger lots than any lot falling below £${minLotValue}. ` +
        `Do not create any lot with estimateLow below £${minLotValue}.`
      : ""

    const result = await model.generateContent([
      SYSTEM_PROMPT + minValueInstruction,
      { inlineData: { data: base64, mimeType } },
    ])

    const raw = result.response.text().trim()
    console.log("[lotting-up] raw response:", raw.slice(0, 500))
    const json = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim()
    type RawGroup = LotGroup & { yTop?: number; yBottom?: number }
    const parsed = JSON.parse(json) as { totalEstimateLow: number; totalEstimateHigh: number; groups: RawGroup[] }

    // Convert yTop/yBottom to x/y/w/h bounds
    parsed.groups = parsed.groups.map((g: RawGroup, i: number) => {
      const yTop    = Math.max(0, Math.min(98, g.yTop    ?? 0))
      const yBottom = Math.max(yTop + 2, Math.min(100, g.yBottom ?? 100))
      console.log(`[lotting-up] group ${g.id} "${g.title}": yTop=${g.yTop} yBottom=${g.yBottom} → y=${yTop} h=${yBottom - yTop}`)
      return {
        ...g,
        colour: COLOURS[i % COLOURS.length],
        bounds: {
          x: 0,
          y: yTop,
          w: 100,
          h: yBottom - yTop,
        },
      }
    })

    return NextResponse.json(parsed)
  } catch (e: any) {
    console.error("[lotting-up]", e)
    return NextResponse.json({ error: e.message ?? "Analysis failed" }, { status: 500 })
  }
}
