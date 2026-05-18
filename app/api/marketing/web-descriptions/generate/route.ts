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

    const prompt = `You are writing a short web description for a Vectis auction house sale page.

Follow this EXACT style — short, factual, catalogue-like sentences that group items by type:

EXAMPLE (Matchbox auction):
"This auction includes group and single lots of boxed and unboxed Matchbox models. Including Regular Wheels, Speed Kings, Super Kings, King Size, major and accessory packs, plus collectors cases and a Regular Wheels G10 Fire Station gift set. Superfast models include blister carded models and packs, gift sets, twin packs, Convoy and MB series. Further items include books, Matchbox Collectibles series and Yesteryear models."

Notice:
- Starts with "This auction includes group and single lots of [main theme]."
- Second sentence starts with "Including" and lists the key sub-types/series/formats separated by commas
- Further sentences group remaining types: "[Type] include/s [list]."
- Ends with "Further items include [remaining types]."
- Short, direct sentences — no flowery language, no adjectives like "impressive" or "stunning"
- Mentions formats and scales where known (e.g. "3.75-inch", "carded", "boxed and unboxed", "1:43")
- Groups by TYPE not by brand name — brands are secondary
- SEO: the specific series names, scales, formats and condition terms (boxed, carded, unboxed, mint) are the SEO keywords — use exact collector terminology from the lot data naturally throughout
- British English spelling
- Do NOT mention prices, estimates, or lot counts
- Output only the description — no headings, no bullet points

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
