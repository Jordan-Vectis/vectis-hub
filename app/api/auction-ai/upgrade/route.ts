import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isCronRequest } from "@/lib/cron-auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { cleanBearsDescription } from "@/lib/description-cleanup"
import { GEMINI_SAFETY_SETTINGS } from "@/lib/ai-safety"

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
  brand_caps:       "Correct the capitalisation of BRAND, MAKER, CHARACTER and TITLE names only — e.g. \"marvel\" to \"Marvel\", \"Dc\" to \"DC\", \"charlie bears\" to \"Charlie Bears\", \"star wars\" to \"Star Wars\", \"lego\" to \"LEGO\", \"bbc\" to \"BBC\". Write an acronym in full capitals and an ordinary name in title case. ⚠ Change NOTHING else: not the wording, the word order, the punctuation or the line breaks. NEVER alter a product or catalogue code, a white tag number, an edition number or a measurement — leave every one exactly as written whatever its case (CB165133, 670442A, 13\"/33cm). Do not capitalise ordinary words, do not Title Case whole sentences, and never introduce a brand that is not already in the text. If a name is already correct, leave it alone.",
  brand_first:      "Move the brand or maker name to the very start of the description — the first word or phrase must be the brand/maker. If the brand is already first, leave it unchanged.",
  dolls_bears_fix:  "Dolls & Bears check — fix the recurring cataloguing errors WITHOUT changing any facts: (a) never write a shorthand count like \"x three\" — use natural English (\"a trio of\", \"a pair of\"); (b) write editions in full as \"limited edition 6000\" or \"limited edition 1176 of 4000\", never the shorthand \"LE\"; (c) never print a \"plumo means…\" note — just say \"plumo\", and expand it once in the opening as \"plush with mohair and alpaca accents\"; (d) after each item's bold/lead name go straight to the type (e.g. \"panda bear\") — do NOT repeat the item's own name; (e) never call a bear or doll a \"figure\"; (f) do NOT state an animal type (panda, monkey, hare) unless it is already stated or unmistakable — a dark brown bear is not a panda; (g) drop a routine \"designed by [name]\" unless the designer is the genuine selling point of that specific piece; (h) the opening must name the individual bears/dolls (five or fewer) and say what they are — never just \"Charlie Bears pair.\"; (i) tidy broken phrasing like \"swing labels label is faded\" to \"swing label, faded\"; (j) remove any markdown ** and close a stray space in a product code (\"CB 114790\" → \"CB114790\").",
}

// POST /api/auction-ai/upgrade
// Body: { description: string, modes: string[], model: string }
// Returns: { revised: string }
export async function POST(req: NextRequest) {
  try {
    // The overnight queue runner calls this same route over localhost, so the
    // prompt and mode instructions stay single-source (see lib/pipeline-runner.ts).
    const session = await auth()
    if (!session && !isCronRequest(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

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
    const gemini = genai.getGenerativeModel({
    safetySettings: GEMINI_SAFETY_SETTINGS, model: await getToolModel("catalogue_upgrade", model), systemInstruction })
    const result = await gemini.generateContent(description.trim())

    const blockReason = (result.response as any).promptFeedback?.blockReason
    if (blockReason) throw new Error(`BLOCKED: prompt blocked — ${blockReason}`)

    const finishReason = result.response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`BLOCKED: response stopped — ${finishReason}`)
    }

    const revised = result.response.text().trim()
    // Belt-and-braces: when the Dolls & Bears check ran, also apply the
    // deterministic clean-up so the mechanical fixes are guaranteed.
    const cleaned = modes.includes("dolls_bears_fix") ? cleanBearsDescription(revised) : revised
    return NextResponse.json({ revised: cleaned })
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error"
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` }, { status: 429 })
    }
    console.error("[auction-ai/upgrade POST]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
