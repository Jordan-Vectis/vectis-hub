import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { prisma } from "@/lib/prisma"

export const maxDuration = 120

// POST /api/catalogue/lens   (multipart: image)
//
// "Lens" for the tablet cataloguing screen — a cataloguer photographs an item and
// gets back (a) what it is, and (b) what WE have made on the same thing before.
//
// Two halves, deliberately:
//  1. IDENTIFY — Gemini with Google Search grounding (same plumbing as
//     /api/auction-ai/chat-grounded, which is proven for this). Grounding matters
//     because catalogue numbers recalled from training data are frequently wrong;
//     a live search checks them.
//  2. COMPARABLES — what Google Lens can't do: search our OWN sold items.
//     WarehouseItem holds 192k+ rows with a real hammerPrice and an auction date.
//
// ⚠ SUGGESTION ONLY. Nothing here writes to a lot. Gemini identifies boxed/marked
// items well and confidently guesses at unmarked ones, so the UI shows confidence
// and sources and the cataloguer decides. Same principle as the batch route: the
// person holding the item is the authority.
//
// ⚠ NO SIZE/DIMENSIONS in the output (Jordan, 2026-07-30) — they're holding the
// thing, so describing how big it is wastes the answer.

type Identification = {
  identified: boolean
  maker: string | null
  model: string | null
  catalogueNumber: string | null
  year: string | null
  variant: string | null
  confidence: "high" | "medium" | "low"
  reasoning: string | null
  searchTerms: string[]
}

const PROMPT = `You identify collectable auction items for a UK auction house from a single photograph.

Use Google Search to CHECK any maker, model or catalogue number before stating it — catalogue numbers recalled from memory are often wrong, and a wrong number is worse than no number.

Return ONLY a JSON object, no markdown fence, with exactly these keys:
{
  "identified": true/false,
  "maker": "e.g. Corgi, Dinky, Hornby, Steiff" or null,
  "model": "the model/item name" or null,
  "catalogueNumber": "the maker's catalogue/reference number" or null,
  "year": "year or range of issue" or null,
  "variant": "colour/version/issue detail that changes what it is" or null,
  "confidence": "high" | "medium" | "low",
  "reasoning": "one short sentence on what you based it on (markings, box, casting)",
  "searchTerms": ["3-6 short terms to find this item in a sold-lot archive"]
}

Rules:
- NEVER state the item's size, scale or dimensions. The cataloguer is holding it.
- Do not value the item or suggest an estimate.
- If markings aren't legible or it could be several things, say so: identified false or confidence "low". A hedge is more useful than a confident guess.
- searchTerms must be plain words a description would contain — maker, catalogue number, model name. No punctuation, no size, no condition words.`

/** Pull the JSON object out of a model reply that may be fenced or padded. */
function parseJson(text: string): Identification | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim()
  const start = cleaned.indexOf("{")
  const end   = cleaned.lastIndexOf("}")
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Identification
  } catch {
    return null
  }
}

export type Comparable = {
  description: string
  hammerPrice: number
  auctionDate: string | null
  auctionName: string | null
  category: string | null
  grouped: boolean
}

// ⚠ Group lots are the accuracy trap here. A lot of our archive reads
// "Corgi Unboxed Group Of Cars to include 261 James Bond…" — that £150 is for six
// cars, not for the one in the cataloguer's hand. We flag them so the UI can
// separate them out rather than averaging nonsense.
const GROUPED = /\bgroup\b|\bto include\b|\bcollection of\b|\bquantity\b|\b\(\d+\)\s*$/i

// ⚠ Catalogue numbers must match as WHOLE words — a plain "contains" for Hornby
// R351 also matches R3514, a different train, which showed up at £190 in testing.
// ⚠ But apply it ONLY to number-bearing terms: forcing whole words on ordinary
// vocabulary breaks plurals, and "Steiff bear" then missed every "teddy bears"
// lot. So catalogue numbers are matched precisely and plain words stay fuzzy.
const looksLikeCatalogueNumber = (term: string) => /\d/.test(term)

function wholeWord(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i")
}

async function findComparables(terms: string[]): Promise<Comparable[]> {
  const clean = terms
    .map(t => t.trim())
    .filter(t => t.length >= 2 && t.length <= 40)
    .slice(0, 6)
  if (clean.length === 0) return []

  // Every term must appear somewhere in the description (AND), which keeps a
  // catalogue number tied to its maker. Ordered newest first — recent prices are
  // the representative ones. Over-fetch, because the whole-word pass below drops
  // some of these.
  const rows = await prisma.warehouseItem.findMany({
    where: {
      hammerPrice: { gt: 0 },
      AND: clean.map(t => ({ description: { contains: t, mode: "insensitive" as const } })),
    },
    select: { description: true, hammerPrice: true, auctionDate: true, auctionName: true, category: true },
    orderBy: { auctionDate: "desc" },
    take: 150,
  })

  // Plain words are already guaranteed present by the SQL `contains`; only the
  // number-bearing terms need the stricter pass.
  const patterns = clean.filter(looksLikeCatalogueNumber).map(wholeWord)
  const exact = patterns.length === 0
    ? rows
    : rows.filter(r => {
        const d = r.description ?? ""
        return patterns.every(p => p.test(d))
      })

  return exact.slice(0, 40).map(r => ({
    description: r.description ?? "",
    hammerPrice: r.hammerPrice ?? 0,
    auctionDate: r.auctionDate ?? null,
    auctionName: r.auctionName ?? null,
    category:    r.category ?? null,
    grouped:     GROUPED.test(r.description ?? ""),
  }))
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const formData = await req.formData()
    const file = formData.get("image") as File | null
    if (!file) return NextResponse.json({ error: "No photo was sent" }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const imagePart = {
      inlineData: {
        data: Buffer.from(buffer).toString("base64"),
        mimeType: file.type || "image/jpeg",
      },
    }

    const modelId = await getToolModel("catalogue_lens", formData.get("model") as string | null)
    const genai   = new GoogleGenerativeAI(apiKey)
    const model   = genai.getGenerativeModel({
      model: modelId,
      tools: [{ googleSearch: {} } as any],
    })

    let text: string
    let searchQueries: string[] = []
    try {
      const result   = await model.generateContent([imagePart, { text: PROMPT }])
      const response = result.response

      // ⚠ Check both block paths BEFORE .text() — calling it on a blocked
      // response throws and loses the reason (house rule).
      const promptBlock = response.promptFeedback?.blockReason
      if (promptBlock) {
        return NextResponse.json({ error: `Gemini blocked the photo (${promptBlock}).` }, { status: 422 })
      }
      const candidate    = response.candidates?.[0]
      const finishReason = candidate?.finishReason
      if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
        return NextResponse.json({ error: `Gemini blocked the reply (${finishReason}).` }, { status: 422 })
      }
      text = response.text()
      searchQueries = ((candidate?.groundingMetadata as any)?.webSearchQueries ?? []) as string[]
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes("400") || msg.toLowerCase().includes("tool") || msg.toLowerCase().includes("grounding")) {
        return NextResponse.json(
          { error: "The configured Lens model doesn't support Google Search. Pick another in Admin → AI Models." },
          { status: 400 },
        )
      }
      throw e
    }

    const id = parseJson(text)
    if (!id) {
      return NextResponse.json({ error: "Couldn't read the identification back — try another photo." }, { status: 502 })
    }

    // Comparables are a bonus: a failure here must not lose the identification.
    let comparables: Comparable[] = []
    try {
      comparables = await findComparables(id.searchTerms ?? [])
    } catch (e) {
      console.error("catalogue/lens comparables error:", e)
    }

    return NextResponse.json({ identification: id, comparables, searchQueries })
  } catch (e: unknown) {
    console.error("catalogue/lens error:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lens failed" }, { status: 500 })
  }
}
