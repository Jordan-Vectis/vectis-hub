import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
// ⚠ The comparables search lives in lib/comparables.ts and is SHARED with the
// Valuations tool. Don't fork it back into this file — the scoring was measured,
// and a second copy will drift.
import { findComparables, type Comparable } from "@/lib/comparables"

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
  keyPoints: string | null
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
  "searchTerms": ["3-6 short terms to find this item in a sold-lot archive"],
  "keyPoints": "a short plain-text key points line the cataloguer can paste"
}

keyPoints must read exactly like the ones our cataloguers write — one short line of plain text, no bullets, no headings, no line breaks, roughly 6-25 words. Real examples:
  "Boxed Commodore 64 Personal Computer"
  "Wrenn, OO gauge, 2x ref. W2206 , box inserts included but no instructions"
  "Corgi loose busses comprising of corgi omnibus and similar, no boxes included"
Include maker, model and reference number. ONLY mention a box, packaging, completeness or damage if you can plainly SEE it in the photo — never assume it. If you are not confident what the item is, keep keyPoints to what is genuinely visible rather than naming a model you are unsure of.

Rules:
- NEVER state the item's size, scale or dimensions. The cataloguer is holding it.
- Do not value the item or suggest an estimate.
- If markings aren't legible or it could be several things, say so: identified false or confidence "low". A hedge is more useful than a confident guess.
- searchTerms must be plain words a description would contain — maker, catalogue number, model name. No punctuation, no size, no condition words.`

/** Up to 3 pages the answer was actually grounded in. */
function extractSources(candidate: any): { title: string; uri: string }[] {
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? []
  const out: { title: string; uri: string }[] = []
  const seen = new Set<string>()
  for (const c of chunks) {
    const uri   = c?.web?.uri
    const title = c?.web?.title
    if (!uri || seen.has(uri)) continue
    seen.add(uri)
    out.push({ title: String(title || uri).slice(0, 120), uri: String(uri) })
    if (out.length >= 3) break
  }
  return out
}

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

export type { Comparable }

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

    // Optional free-text hint from the cataloguer — "it says Dinky on the base",
    // "which variant is this?". They're holding the item, so their note outranks
    // anything the model thinks it can see.
    const note = ((formData.get("note") as string) ?? "").trim().slice(0, 500)
    const prompt = note
      ? `${PROMPT}\n\nThe cataloguer, who has the item in front of them, adds: "${note}"\nTreat that as fact and answer it if it's a question.`
      : PROMPT

    let text: string
    let searchQueries: string[] = []
    let sources: { title: string; uri: string }[] = []
    try {
      const result   = await model.generateContent([imagePart, { text: prompt }])
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
      sources = extractSources(candidate)
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
      comparables = await findComparables(id)
    } catch (e) {
      console.error("catalogue/lens comparables error:", e)
    }

    return NextResponse.json({ identification: id, comparables, searchQueries, sources })
  } catch (e: unknown) {
    console.error("catalogue/lens error:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lens failed" }, { status: 500 })
  }
}
