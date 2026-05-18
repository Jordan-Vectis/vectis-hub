import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { auctionId, modelId } = await req.json()
    if (!auctionId) return NextResponse.json({ error: "auctionId required" }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 })

    // Fetch auction + all lots
    const auction = await prisma.catalogueAuction.findUnique({
      where: { id: auctionId },
      include: {
        lots: {
          select: {
            title: true,
            category: true,
            subCategory: true,
            brand: true,
            keyPoints: true,
            status: true,
          },
        },
      },
    })

    if (!auction) return NextResponse.json({ error: "Auction not found" }, { status: 404 })
    if (auction.lots.length === 0) {
      return NextResponse.json({ error: "This auction has no lots to describe." }, { status: 422 })
    }

    // Build a rich summary of the auction contents
    const categories    = [...new Set(auction.lots.map(l => l.category).filter(Boolean))].sort()
    const subCategories = [...new Set(auction.lots.map(l => l.subCategory).filter(Boolean))].sort()
    const brands        = [...new Set(auction.lots.map(l => l.brand).filter(Boolean))].sort()
    const titles        = auction.lots
      .map(l => l.title)
      .filter(Boolean)
      .slice(0, 60)                    // cap at 60 titles to keep prompt lean

    const keyPointSamples = auction.lots
      .map(l => l.keyPoints)
      .filter(kp => kp && kp.trim().length > 10)
      .slice(0, 20)
      .join("\n")

    const prompt = `You are writing a web description for the Vectis auction house website sale page.
Your task: write a single flowing paragraph (2–5 sentences) that describes what is in this auction.

Rules:
- Be specific — mention actual model names, series, formats, and types you can see in the data
- Vary the sentence structure; do not repeat the same pattern every sentence
- SEO-friendly: naturally include key collector search terms from the lot data
- British English spelling
- Do NOT mention prices, estimates, or lot counts
- Do NOT use phrases like "a wide range of" or "variety of" — be specific instead
- Start with "This auction includes..." or similar
- Output only the description paragraph — no headings, no bullet points, no extra text

Auction: ${auction.name} (${auction.code})
Type: ${auction.auctionType}
Total lots: ${auction.lots.length}
Categories: ${categories.length ? categories.join(", ") : "—"}
Subcategories: ${subCategories.length ? subCategories.join(", ") : "—"}
Brands: ${brands.length ? brands.join(", ") : "—"}
Lot titles (sample):
${titles.join("\n")}
${keyPointSamples ? `\nKey points (sample):\n${keyPointSamples}` : ""}

Write the auction description now:`

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: modelId ?? "gemini-2.5-flash-preview-04-17" })

    const result = await model.generateContent(prompt)

    const { promptFeedback } = result.response
    if (promptFeedback?.blockReason) {
      return NextResponse.json(
        { error: `Content blocked: ${promptFeedback.blockReason}` },
        { status: 422 }
      )
    }

    const finishReason = result.response.candidates?.[0]?.finishReason
    if (finishReason && !["STOP", "MAX_TOKENS"].includes(finishReason)) {
      return NextResponse.json(
        { error: `Generation ended unexpectedly: ${finishReason}` },
        { status: 422 }
      )
    }

    const description = result.response.text().trim()
    return NextResponse.json({ description })
  } catch (e: any) {
    console.error("web-descriptions generate error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
