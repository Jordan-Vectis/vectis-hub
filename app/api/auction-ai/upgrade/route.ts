import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

const MODE_INSTRUCTIONS: Record<string, string> = {
  shorten:          "Shorten the description — remove unnecessary words and padding while keeping all factual detail.",
  expand:           "Expand the description — add useful context, detail, and specifics that would help a buyer.",
  humanise:         "Humanise the language — remove AI-sounding or robotic phrasing and make it read naturally.",
  grammar:          "Fix grammar, spelling, punctuation, and sentence structure throughout.",
  format:           "Standardise the format — consistent bullet point style, capitalisation, and spacing.",
  condition:        "Expand condition notes — be more specific and explicit about any defects, damage, or completeness issues.",
  remove_condition: "Remove any condition or grading statement — delete grade words used as a condition assessment (e.g. \"Mint\", \"Near Mint\", \"Excellent to Near Mint\", \"Good Plus\") and condition phrases (e.g. \"condition appears…\", \"in good condition\", \"shows light wear\", \"paint chips\"). Condition is recorded separately by a human, so the description must contain NO condition assessment. Do NOT remove a grade word that is part of an official product name.",
  no_hyperbole:     "Remove hyperbole and sales-speak — replace vague positive language with specific factual statements.",
  auction_language: "Ensure auction-appropriate terminology throughout — use lot/catalogue language as appropriate.",
  seo:              "Improve search visibility (SEO) — naturally weave in the specific terms a buyer would search for (brand, maker, model/range name, character, theme, era, format). Do not keyword-stuff, repeat unnaturally, or change any facts.",
  brand_first:      "Move the brand or maker name to the very start of the description — the first word or phrase must be the brand/maker. If the brand is already first, leave it unchanged.",
}

// POST /api/auction-ai/upgrade
// Body: { description: string, modes: string[], model: string }
// Returns: { revised: string }
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { description, modes, model, keyPoints } = await req.json()
    if (!description?.trim()) return NextResponse.json({ error: "description is required" }, { status: 400 })
    if (!Array.isArray(modes) || modes.length === 0) return NextResponse.json({ error: "at least one mode required" }, { status: 400 })

    const instructions = modes
      .filter(m => MODE_INSTRUCTIONS[m])
      .map((m, i) => `${i + 1}. ${MODE_INSTRUCTIONS[m]}`)
      .join("\n")

    // When key points are supplied, they are cataloguer-verified facts that must survive
    // the rewrite untouched — this is the single most important rule.
    const kpRule = keyPoints?.trim()
      ? `\n\n⚠ ABSOLUTE RULE — these cataloguer key points are verified facts. EVERY one of them must remain present in the rewritten description with its exact meaning and the cataloguer's wording for condition/completeness terms (e.g. "Sealed Mint"). Never remove, soften, paraphrase away, or contradict any of them:\n${keyPoints.trim()}`
      : ""

    const systemInstruction = `You are rewriting auction lot descriptions. Apply the following transformations:

${instructions}

Rules:
- Return ONLY the rewritten description. No commentary, headers, or explanations.
- Preserve all factual information — do not invent details or remove real facts.
- Keep British English spelling throughout.
- Do not add or change estimate figures.
- Join lines with \\n, never collapse multi-paragraph or list formatting into a single paragraph.${kpRule}`

    const genai  = new GoogleGenerativeAI(apiKey)
    const gemini = genai.getGenerativeModel({ model: model || (await getToolModel("catalogue_upgrade")), systemInstruction })
    const result = await gemini.generateContent(description.trim())

    const blockReason = (result.response as any).promptFeedback?.blockReason
    if (blockReason) throw new Error(`BLOCKED: prompt blocked — ${blockReason}`)

    const finishReason = result.response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`BLOCKED: response stopped — ${finishReason}`)
    }

    const revised = result.response.text().trim()
    return NextResponse.json({ revised })
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error"
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` }, { status: 429 })
    }
    console.error("[auction-ai/upgrade POST]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
