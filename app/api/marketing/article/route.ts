import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 120

type Lot = {
  uniqueId:    string
  lotNo:       string | null
  description: string | null
  category:    string | null
  hammerPrice: number | null
  lowEstimate: number | null
  highEstimate:number | null
  auctionCode: string | null
  auctionName: string | null
  auctionDate: string | null
}

function fmtPrice(n: number | null) {
  if (n == null) return ""
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0 })
}

function buildPrompt(lots: Lot[], articleType: string): string {
  // Describe the lot data
  const lotLines = lots.map((l, i) => {
    const price   = l.hammerPrice ? `sold for ${fmtPrice(l.hammerPrice)}` : "unsold"
    const est     = l.lowEstimate && l.highEstimate
      ? ` (estimate ${fmtPrice(l.lowEstimate)}–${fmtPrice(l.highEstimate)})`
      : ""
    const sale    = l.auctionName ?? l.auctionCode ?? "Unknown Sale"
    const date    = l.auctionDate ? ` on ${l.auctionDate}` : ""
    const lotRef  = l.lotNo ? ` (Lot ${l.lotNo})` : ""
    return `${i + 1}. ${l.description ?? "Unnamed lot"}${lotRef} — ${price}${est} — ${sale}${date}`
  }).join("\n")

  const saleNames   = [...new Set(lots.map(l => l.auctionName ?? l.auctionCode).filter(Boolean))].join(", ")
  const categories  = [...new Set(lots.map(l => l.category).filter(Boolean))].join(", ")
  const totalValue  = lots.reduce((s, l) => s + (l.hammerPrice ?? 0), 0)

  const typeInstructions: Record<string, string> = {
    sale_highlight: `Write a news article for the Vectis website highlighting these top auction results.
Lead with the most impressive result. Mention specific hammer prices to give the article credibility.
The tone should be enthusiastic but professional — like a press release from a respected auction house.
Structure: H1 headline, 2–3 paragraphs covering the headline lots, a paragraph on overall performance,
and a short call-to-action encouraging collectors to register for future sales at vectis.co.uk.`,

    news_story: `Write a news story article in the style of https://www.vectis.co.uk/news-stories/news.
It should read like editorial content: engaging, informative, conversational but authoritative.
Include specific lot descriptions and prices to bring the results to life.
Structure: H1 headline, introduction paragraph, main body (2–3 paragraphs), market context,
and a closing line with a call-to-action linking to vectis.co.uk.`,

    collectors_guide: `Write a collector's guide article aimed at enthusiasts interested in collecting
items like the lots below. Draw on the lot descriptions and prices to illustrate value and rarity.
Structure: H1 headline (e.g. "A Collector's Guide to [category]"), introduction explaining the
collecting area, H2 sections for key things to look for, notable recent results (using the lots below),
tips for new collectors, and a closing paragraph mentioning Vectis auctions.`,

    market_report: `Write a market report article analysing the auction results below.
Focus on price trends, which categories or items performed strongly, and what the results
suggest about collector demand. Use a data-driven but accessible tone.
Structure: H1 headline, executive summary paragraph, H2 sections covering top performers,
category analysis, and market outlook, with a closing note about Vectis at vectis.co.uk.`,
  }

  const instruction = typeInstructions[articleType] ?? typeInstructions.sale_highlight

  return `You are a professional copywriter for Vectis Auctions, one of the UK's leading specialist toy and collectables auction houses based in Shanklin, Isle of Wight.

${instruction}

IMPORTANT REQUIREMENTS:
- British English spelling throughout (e.g. "realised", "recognised", "colour")
- Output valid HTML only — use <h1>, <h2>, <p>, <strong>, <em> tags
- Do NOT include <!DOCTYPE>, <html>, <head>, or <body> tags — just the article content HTML
- Do NOT add placeholder links or made-up URLs — only reference vectis.co.uk
- Aim for 400–600 words
- Be specific: mention real lot descriptions and prices from the data below
- The article should be genuinely useful for SEO — naturally include relevant keywords

AUCTION DATA:
Sales covered: ${saleNames || "Various"}
Categories: ${categories || "Various"}
Total hammer value: ${fmtPrice(totalValue)}
Number of lots: ${lots.length}

TOP LOTS (sorted by hammer price, highest first):
${lotLines}`
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { lots, articleType } = await req.json() as { lots: Lot[]; articleType: string }

    if (!lots?.length) return NextResponse.json({ error: "No lots provided" }, { status: 422 })
    if (lots.length > 100) return NextResponse.json({ error: "Too many lots (max 100)" }, { status: 422 })

    const prompt = buildPrompt(lots, articleType ?? "sale_highlight")

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: "gemini-2.0-flash" })

    const result   = await model.generateContent(prompt)
    const response = result.response

    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) {
      return NextResponse.json(
        { error: `Request blocked by Gemini: ${promptBlock}` },
        { status: 422 },
      )
    }

    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json(
        { error: `Gemini stopped unexpectedly: ${finishReason}` },
        { status: 422 },
      )
    }

    const article = response.text().trim()

    return NextResponse.json({ article })
  } catch (e: any) {
    console.error("marketing/article error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
