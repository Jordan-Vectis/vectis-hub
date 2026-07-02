import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 120

// Length presets — duplicated from /article so this route can stand alone.
const LENGTH_PRESETS: Record<string, { instruction: string; maxTokens: number }> = {
  short:  { instruction: `LENGTH: write a CONCISE version — about 250–400 words. Keep it tight.`,                                                                                                                  maxTokens: 2048 },
  medium: { instruction: `LENGTH: write a standard-length article — about 500–700 words.`,                                                                                                                          maxTokens: 4096 },
  long:   { instruction: `LENGTH: write an EXTENDED article — about 900–1,400 words. Add an extra paragraph per section, dwell on more lots in detail, expand market context.`,                                     maxTokens: 8192 },
  max:    { instruction: `LENGTH: write the MOST DETAILED article you can produce. Cover every lot in the pasted text with a full paragraph, expand on manufacturer history and collecting context. Aim for 2,000+ words if the data supports it.`, maxTokens: 16384 },
}

// Mirrors the type instructions from /article — intentionally duplicated so the
// two routes can evolve independently if needed.
const TYPE_INSTRUCTIONS: Record<string, string> = {
  sale_highlight: `Write a news article highlighting these auction lots/results. Lead with the most striking lot. Output: HTML (h1, h2, p, strong, em).`,
  news_story:     `Write a news-story article in editorial style. Output: HTML.`,
  collectors_guide: `Write a collector's guide drawing on the lot detail below. Output: HTML.`,
  market_report:    `Write a market report analysing these lots. Output: HTML.`,
  preview_teaser:   `Write a preview/teaser article building anticipation for the lots below. Use estimates not realised prices if hammer prices aren't in the text. Output: HTML.`,
  email_newsletter: `Write a subscriber email newsletter. Lead with <h1>SUBJECT: …</h1>, then <p>PREHEADER: …</p>, then the body. Output: HTML.`,
  social_instagram: `Write 5 Instagram caption variants. Each: 100–180 words, 2–3 emojis, ending with 8–15 hashtags. Structure each as <h2>Variant N</h2><p>caption</p><p><em>#hashtags</em></p>.`,
  social_facebook:  `Write 3 Facebook post variants in the actual Vectis Auctions Facebook voice. Match one of three formats per variant where the source allows: (a) single-lot highlight — punny headline + price, context paragraph, drama paragraph, link line "🔗 https://www.vectis.co.uk/…", 3–5 hashtags. (b) sale announcement — 📣 or 🎬 opener, sale title + date, real categories listed, live time "09:30 (UK)", "Can't wait until the [date]? View the catalogue NOW…" line, 15–25 hashtags. (c) results recap — achievement line + 👏 emoji, soft consigning CTA "Do you have a [X] Collection you would like to auction? Contact us to find out how.", contact lines (🌐 vectis.co.uk · 📩 collections@vectis.co.uk · 📞 01642 750616), 3–5 hashtags. Use "Our [X] Auction" not "Vectis's". Phone always "01642 750616" with no country code in social copy. British English. Emojis sparingly and contextually — never decorative spam. Wordplay/puns welcome ("tea-rific", "Out Of This World"). Output structure: <h2>Variant N — [sub-type label]</h2><p>caption</p>.`,
  social_twitter:   `Write 5 short tweets, each under 280 chars including hashtags. Structure as <h2>Variant N</h2><p>tweet</p><p><em>character count: NN</em></p>.`,
  carousel_pack:    `Write a 5–10 slide IG carousel pack. Structure each slide as <h2>Slide N</h2><p>SLIDE TEXT</p>.`,
  press_release:    `Write a formal press release. Structure: <h1>HEADLINE</h1><p><strong>FOR IMMEDIATE RELEASE — [date]</strong></p>, dateline opening (Thornaby, Teesside), body paragraphs, "About Vectis" boilerplate at the end. Output: HTML.`,
  vendor_summary:   `Write a one-page result summary suitable for the consigning vendor. Structure: <h1>Sale Result Summary</h1>, intro, <h2>Highlights</h2>, <h2>Performance Summary</h2>, closing thanks. Output: HTML.`,
  headline_pack:    `Generate 10 alternative headlines for an article based on the pasted lots. Mix SEO/click-worthy/news/listicle/question styles. Output: <h2>Headlines</h2><ol><li>...</li></ol>.`,
  alt_text:         `For each lot in the pasted text, generate an SEO alt-text (under 125 chars) and a meta description (under 155 chars). Output as <h2>Lot</h2><p><strong>Alt text:</strong> ...</p><p><strong>Meta:</strong> ...</p>.`,
  catalogue_blurb:  `Write 2–3 sentence catalogue intros for each category in the pasted lots. Output as <h2>Category</h2><p>blurb</p>.`,
  year_in_review:   `Write a "year in review" retrospective using the pasted lots. Output: HTML with <h1>, then <h2> sections (Standout Sales / Record Results / Categories on the Rise / Looking Ahead).`,
}

const BRAND_VOICE_BLOCK = `═══════════════════════════════════════════════════════════════════
BRAND VOICE — STRICT RULES
═══════════════════════════════════════════════════════════════════

ABOUT VECTIS AUCTIONS — REFERENCE ONLY.

This block exists so you don't INVENT facts about Vectis. It is NOT a
checklist to include in every article.

⚠ DEFAULT BEHAVIOUR: do NOT mention any of these facts unless they are
genuinely relevant to the specific article type. Most articles should
focus entirely on the LOTS — not on the company.

Identity:
- Trading name: "Vectis Auctions" or "Vectis".
- Established 1988 (Isle of Wight) by Roger and Jill Mazillius.
- Acquired 1996 by Bryan Goodall, current owner.
- Self-description: "a professional, reliable and friendly service".

Location (only place name allowed):
- Head Office: Thornaby, Teesside, North East England.
- Mention only when genuinely useful (e.g. a press release dateline,
  "viewing at our Thornaby saleroom"). Most articles should not mention
  any location at all.

Auction format / specialism:
- Live online auctions with worldwide bidder reach. Bidding online,
  by phone, or by post.
- Specialist toy/collectables auction house. Departments include
  Star Wars, TV & Film, Diecast (Corgi, Dinky, Matchbox), Trains
  & Model Railway, Dolls, Teddy Bears, Lego, Action Man, Tinplate,
  Action Figures, Comics, Sports Memorabilia, Trading Cards,
  Militaria, Transformers, Barbie, Retro Gaming and more.

Web:
- Only allowed URL: vectis.co.uk

DO NOT under any circumstances:
- Invent staff names, quotes, founder details beyond Bryan Goodall
  and Roger & Jill Mazillius.
- Reference URLs other than vectis.co.uk.
- Invent dates, years, prices or sale names not present in the
  pasted text.
- Claim "world's largest", "world's leading", awards or similar
  superlatives unless the pasted text says so.
- Use the word "CRM".
- Mention any internal Vectis reference codes — short codes that
  look like a letter followed by digits (e.g. "F025", "DM0126",
  "TR2025"). These are internal Business Central codes used only
  by staff. Use the human-readable sale name instead.

ALWAYS:
- British English: "realised", "colour", "specialise", "catalogue".
- Use the EXACT sale names, lot numbers, prices, and dates from the
  pasted text. Never invent them or expand single years to ranges.
- Output valid HTML only — no DOCTYPE, html, head, or body tags.
- Tone: professional, reliable, friendly, knowledgeable enthusiast.
  Not bombastic auction-house cliché.
`

function buildPrompt(pastedText: string, contentType: string, length: string, contextNote: string): string {
  const instruction    = TYPE_INSTRUCTIONS[contentType] ?? TYPE_INSTRUCTIONS.sale_highlight
  const lengthInstr    = LENGTH_PRESETS[length]?.instruction ?? LENGTH_PRESETS.medium.instruction
  const contextSection = contextNote.trim()
    ? `\n\nADDITIONAL CONTEXT FROM THE USER:\n${contextNote.trim()}\n`
    : ""

  return `You are a professional copywriter for Vectis Auctions, a specialist toy and collectables auction house based at Thornaby on Teesside in the North East of England.

${instruction}

${lengthInstr}

${BRAND_VOICE_BLOCK}

═══════════════════════════════════════════════════════════════════
SOURCE MATERIAL — pasted by the user
═══════════════════════════════════════════════════════════════════

The user has pasted lot information from the Vectis website (or another
source). Your job is to extract the relevant lot details — descriptions,
prices, estimates, sale names, dates, manufacturers, lot numbers — and
write the requested article using ONLY what's in the pasted material.

If a fact is not in the pasted text, do NOT invent it. If sale names,
dates, or prices are missing, write around them rather than guessing.${contextSection}

PASTED CONTENT (treat as raw — may be plain text, HTML or a mix):
"""
${pastedText}
"""`
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { pastedContent, contentType, length, modelId, contextNote } = await req.json() as {
      pastedContent: string
      contentType:   string
      length?:       "short" | "medium" | "long" | "max"
      modelId?:      string
      contextNote?:  string
    }

    if (!pastedContent?.trim()) {
      return NextResponse.json({ error: "Paste some content first" }, { status: 422 })
    }
    if (pastedContent.length > 200_000) {
      return NextResponse.json({ error: "Pasted content too long (max 200,000 chars)" }, { status: 422 })
    }

    const lengthKey = length ?? "medium"
    const prompt    = buildPrompt(pastedContent, contentType ?? "sale_highlight", lengthKey, contextNote ?? "")
    const maxTokens = LENGTH_PRESETS[lengthKey]?.maxTokens ?? 4096

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: await getToolModel("marketing_article_text", modelId),
      generationConfig: { maxOutputTokens: maxTokens },
    })

    const result   = await model.generateContent(prompt)
    const response = result.response

    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) {
      return NextResponse.json({ error: `Request blocked by Gemini: ${promptBlock}` }, { status: 422 })
    }

    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Gemini stopped unexpectedly: ${finishReason}` }, { status: 422 })
    }

    const article = response.text().trim()
    return NextResponse.json({ article })
  } catch (e: any) {
    console.error("marketing/article-from-text error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
