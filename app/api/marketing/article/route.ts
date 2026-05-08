import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 120

type Lot = {
  uniqueId:     string
  lotNo:        string | null
  currentLotNo: string | null
  description:  string | null
  category:     string | null
  hammerPrice:  number | null
  lowEstimate:  number | null
  highEstimate: number | null
  auctionCode:  string | null
  auctionName:  string | null
  auctionDate:  string | null
  // Enriched from CatalogueLot
  catTitle?:        string | null
  catDescription?:  string | null
  catKeyPoints?:    string | null
  catCondition?:    string | null
  catSubCategory?:  string | null
  catBrand?:        string | null
  catExtraDetails?: string | null
}

function fmtPrice(n: number | null) {
  if (n == null) return ""
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0 })
}

function fmtDate(d: string | null) {
  if (!d) return null
  const parsed = new Date(d)
  if (isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

const TYPE_INSTRUCTIONS: Record<string, string> = {
  // ── Articles ──────────────────────────────────────────────────────────────
  sale_highlight: `Write a news article for the Vectis website highlighting these top auction results.
Lead with the most impressive result. Mention specific hammer prices to give the article credibility.
The tone should be enthusiastic but professional — like a press release from a respected auction house.
Structure: H1 headline, 2–3 paragraphs covering the headline lots, a paragraph on overall performance,
and a short call-to-action encouraging collectors to register for future sales at vectis.co.uk.
Output: HTML (h1, h2, p, strong, em). 400–600 words.`,

  news_story: `Write a news story article in the style of https://www.vectis.co.uk/news-stories/news.
It should read like editorial content: engaging, informative, conversational but authoritative.
Include specific lot descriptions and prices to bring the results to life.
Structure: H1 headline, introduction paragraph, main body (2–3 paragraphs), market context,
and a closing line with a call-to-action linking to vectis.co.uk.
Output: HTML (h1, h2, p, strong, em). 400–600 words.`,

  collectors_guide: `Write a collector's guide article aimed at enthusiasts interested in collecting
items like the lots below. Draw on the lot descriptions and prices to illustrate value and rarity.
Structure: H1 headline (e.g. "A Collector's Guide to [category]"), introduction explaining the
collecting area, H2 sections for key things to look for, notable recent results (using the lots below),
tips for new collectors, and a closing paragraph mentioning Vectis auctions.
Output: HTML (h1, h2, p, strong, em). 500–800 words.`,

  market_report: `Write a market report article analysing the auction results below.
Focus on price trends, which categories or items performed strongly, and what the results
suggest about collector demand. Use a data-driven but accessible tone.
Structure: H1 headline, executive summary paragraph, H2 sections covering top performers,
category analysis, and market outlook, with a closing note about Vectis at vectis.co.uk.
Output: HTML (h1, h2, p, strong, em). 500–700 words.`,

  preview_teaser: `Write an "auction preview" article teasing UPCOMING lots before they go under the hammer.
Build excitement — highlight what makes these lots special, why collectors should pay attention,
and include estimates rather than realised prices. Tone: enthusiastic, anticipatory.
Structure: H1 headline ("Lots to watch in the upcoming…"), short intro, H2/H3 for each featured lot
with description and estimate, closing CTA to register/bid at vectis.co.uk.
Output: HTML (h1, h2, h3, p, strong, em). 400–600 words.`,

  // ── Email ─────────────────────────────────────────────────────────────────
  email_newsletter: `Write a subscriber email newsletter for Vectis Auctions.
Lead with a compelling subject line, then a preheader, then the email body.
Body should feature the top lots/results in a scannable format — use h2 for section headers,
bullet points or short paragraphs for each lot with hammer price (or estimate for upcoming lots),
and a clear CTA button-style line at the bottom.
Structure: <h1>SUBJECT: ...</h1><p>PREHEADER: ...</p> then the email body.
Output: HTML (h1, h2, p, ul, li, strong, a href="https://vectis.co.uk").
Tone: warm, direct, on-brand. 300–450 words for the body.`,

  // ── Social media ──────────────────────────────────────────────────────────
  social_instagram: `Write 5 Instagram caption variants based on these auction lots/results.
Each caption: 100–180 words, includes 2–3 emojis used tastefully, mentions the lot and result,
ends with relevant hashtags (8–15 hashtags, mix of broad + niche).
Structure each as: <h2>Variant N</h2><p>caption</p><p><em>#hashtags</em></p>
Output: HTML.`,

  social_facebook: `Write 3 Facebook post variants based on these auction lots/results.
Each post: 80–150 words, conversational tone, asks a question to drive engagement,
includes a CTA to vectis.co.uk. Less hashtag-heavy than Instagram (3–5 hashtags max).
Structure each as: <h2>Variant N</h2><p>caption</p>
Output: HTML.`,

  social_twitter: `Write 5 short Twitter/X post variants. Each under 280 characters including hashtags.
Mention a specific lot result, include a link placeholder (vectis.co.uk), 2–3 hashtags.
Structure: <h2>Variant N</h2><p>tweet text</p><p><em>character count: NN</em></p>
Output: HTML.`,

  carousel_pack: `Write a 5–10 slide Instagram carousel pack from a single sale.
Slide 1: a strong hook headline. Slides 2–N: each a featured lot with the description trimmed
to one short sentence and the hammer price prominent. Final slide: CTA.
Structure each slide as: <h2>Slide N</h2><p>SLIDE TEXT</p>
Output: HTML.`,

  // ── PR ────────────────────────────────────────────────────────────────────
  press_release: `Write a formal press release for trade press / collector magazines.
Structure: <h1>HEADLINE (all caps)</h1><p><strong>FOR IMMEDIATE RELEASE — [date]</strong></p>
<p>Dateline (Shanklin, Isle of Wight) — opening paragraph with the news.</p>
Then 2–3 body paragraphs with quotes (attribute to "a Vectis spokesperson") and detail.
Closing boilerplate paragraph about Vectis. Final line: <p><em>— ENDS —</em></p>
followed by an "About Vectis" paragraph and contact line referencing vectis.co.uk.
Output: HTML. 350–500 words.`,

  // ── Helpers ──────────────────────────────────────────────────────────────
  headline_pack: `Generate 10 alternative headlines for an article based on these auction results.
Mix styles: SEO-optimised, click-worthy, formal news-style, listicle-style, question-style.
Output: <h2>Headlines</h2><ol><li>headline 1</li>...<li>headline 10</li></ol>`,

  alt_text: `For each lot below, generate an SEO-friendly image alt-text (under 125 chars)
and a meta description (under 155 chars).
Structure: <h2>Lot description (Lot N)</h2><p><strong>Alt text:</strong> ...</p><p><strong>Meta description:</strong> ...</p>
Output: HTML. Be specific — include manufacturer, era, and condition cues from the description.`,

  catalogue_blurb: `Write short 2–3 sentence catalogue intros for each category represented in these lots,
suitable for the printed sale catalogue. Tone: descriptive, evocative, professional.
Structure: <h2>Category name</h2><p>blurb text</p>
Output: HTML.`,

  vendor_summary: `Write a one-page result summary suitable for sending back to the consigning vendor.
Tone: warm, professional, congratulatory where appropriate. Avoid auction jargon.
Structure: <h1>Sale Result Summary</h1>
<p>Opening paragraph noting the sale, date, and overall result.</p>
<h2>Highlights</h2><ul><li>top lots with prices</li></ul>
<h2>Performance Summary</h2><p>total realised, % over/under estimate.</p>
<p>Closing thanks + invitation to consign again.</p>
Output: HTML. 250–400 words.`,

  year_in_review: `Write a "year in review" retrospective article covering the lots/results below.
Identify themes, breakout categories, record-setters, and overall trends.
Structure: <h1>Year in Review headline</h1>
<p>Intro paragraph.</p>
<h2>Standout Sales</h2><h2>Record Results</h2><h2>Categories on the Rise</h2><h2>Looking Ahead</h2>
<p>Closing CTA.</p>
Output: HTML. 600–900 words.`,
}

function buildPrompt(lots: Lot[], articleType: string): string {
  // Strip basic HTML tags from cataloguer descriptions (they often contain <p>, <br>, <ul> etc.)
  const stripHtml = (s: string | null | undefined) =>
    !s ? "" : s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(p|ul|ol|li|strong|em|h[1-6])[^>]*>/gi, "").replace(/<[^>]+>/g, "").trim()

  // Pre-compute performance vs estimate so the model can quote it directly
  const performance = (l: Lot): string => {
    if (!l.hammerPrice || !l.lowEstimate || !l.highEstimate) return ""
    const mid = (l.lowEstimate + l.highEstimate) / 2
    const pct = Math.round((l.hammerPrice / mid) * 100)
    if (l.hammerPrice >= l.highEstimate * 1.5) return `, smashing the high estimate (${pct}% of mid)`
    if (l.hammerPrice >  l.highEstimate)       return `, exceeding the high estimate (${pct}% of mid)`
    if (l.hammerPrice >= l.lowEstimate)        return `, within estimate (${pct}% of mid)`
    return `, below the low estimate (${pct}% of mid)`
  }

  const lotBlocks = lots.map((l, i) => {
    const headline   = l.catTitle ?? l.description ?? "Unnamed lot"
    const lotRef     = (l.currentLotNo ?? l.lotNo) ? `Lot ${l.currentLotNo ?? l.lotNo}` : ""
    const sale       = l.auctionName ?? l.auctionCode ?? "Unknown Sale"
    const date       = fmtDate(l.auctionDate)
    const saleLine   = [sale, date].filter(Boolean).join(" · ")

    const priceLine  = l.hammerPrice
      ? `Hammer: ${fmtPrice(l.hammerPrice)}${performance(l)}`
      : "Status: unsold / upcoming"
    const estLine    = (l.lowEstimate && l.highEstimate)
      ? `Estimate: ${fmtPrice(l.lowEstimate)}–${fmtPrice(l.highEstimate)}`
      : ""

    // Build a richer description block from whatever cataloguer data we have
    const descParts: string[] = []
    const fullDesc = stripHtml(l.catDescription)
    if (fullDesc && fullDesc.length > (l.description?.length ?? 0)) {
      descParts.push(`Description: ${fullDesc}`)
    } else if (l.description) {
      descParts.push(`Description: ${l.description}`)
    }
    const keyPts = stripHtml(l.catKeyPoints)
    if (keyPts) descParts.push(`Key points: ${keyPts}`)
    if (l.catCondition)   descParts.push(`Condition: ${l.catCondition}`)
    if (l.catBrand)       descParts.push(`Manufacturer/brand: ${l.catBrand}`)
    if (l.catSubCategory) descParts.push(`Subcategory: ${l.catSubCategory}`)
    if (l.category)       descParts.push(`Category: ${l.category}`)
    const extra = stripHtml(l.catExtraDetails)
    if (extra) descParts.push(`Extra details: ${extra}`)

    const lines = [
      `### ${i + 1}. ${headline}${lotRef ? ` (${lotRef})` : ""}`,
      `Sale: ${saleLine}`,
      estLine,
      priceLine,
      ...descParts,
    ].filter(Boolean)
    return lines.join("\n")
  }).join("\n\n")

  const saleNames   = [...new Set(lots.map(l => l.auctionName ?? l.auctionCode).filter(Boolean))].join(", ")
  const categories  = [...new Set(lots.map(l => l.category).filter(Boolean))].join(", ")
  const totalValue  = lots.reduce((s, l) => s + (l.hammerPrice ?? 0), 0)

  // Extract distinct years actually present in the auction dates
  const years = [...new Set(
    lots.map(l => (l.auctionDate ?? "").slice(0, 4)).filter(y => /^\d{4}$/.test(y))
  )].sort()
  const yearLine = years.length === 0
    ? "Year(s) covered: unknown"
    : years.length === 1
      ? `Year covered: ${years[0]} — use this exact year, do not invent a range`
      : `Years covered: ${years.join(", ")} — use these exact years, do not invent a range`

  const instruction = TYPE_INSTRUCTIONS[articleType] ?? TYPE_INSTRUCTIONS.sale_highlight

  return `You are a professional copywriter for Vectis Auctions, a specialist toy and collectables auction house based at Thornaby on Teesside in the North East of England.

${instruction}

═══════════════════════════════════════════════════════════════════
BRAND VOICE — STRICT RULES (read carefully)
═══════════════════════════════════════════════════════════════════

ABOUT VECTIS AUCTIONS — REFERENCE ONLY.

This block exists so you don't INVENT facts about Vectis. It is NOT a
checklist to include in every article.

⚠ DEFAULT BEHAVIOUR: do NOT mention any of these facts unless they are
genuinely relevant to the specific article type and topic. Most articles
(sale highlights, news stories, social posts, market reports, headlines)
should focus entirely on the LOTS and the RESULTS — not on the company.

When facts ARE relevant:
  - Founding year, owner, history → only "About Us"-style content,
    formal press releases, or year-in-review pieces if explicitly framed
    as a retrospective on Vectis itself.
  - Location (Thornaby/Teesside) → only when location is genuinely useful
    (e.g. a press release dateline, or "viewing at our Thornaby saleroom").
    Most sale highlights and social posts should not mention a location at all.
  - Turnover/staff/site size → almost never. Only if the article is
    explicitly about Vectis as a business.
  - Auction format / buyer's premium / bidding methods → only "How to bid"
    or sell-with-us content. NOT in result-focused articles.

If you find yourself padding an article with company history because you
"have nothing else to say", you have not engaged with the lot data deeply
enough. Go back and lead with a specific lot, a specific result, a
specific manufacturer, a specific era — never with a company bio.

Do NOT invent or guess anything beyond what is in this block.

Identity:
- Trading name: "Vectis Auctions" (or simply "Vectis").
- Established: 1988 by Roger and Jill Mazillius on the Isle of Wight.
- Acquired: 1996 by Bryan Goodall, current owner.
- Self-description: "a professional, reliable and friendly service".

Location (only place name you may use):
- Head Office: Thornaby, Teesside, North East England.
- Premises: a 30,000 sq ft auction site.
- Phrases that work naturally: "at our Thornaby saleroom",
  "from the Vectis saleroom in Thornaby", "our Teesside auction site",
  or simply "Vectis" / "the saleroom".
- DO NOT say Isle of Wight, Shanklin, Yorkshire, or anywhere else.
  Vectis was FOUNDED on the Isle of Wight in 1988 but moved long ago — the
  Isle of Wight is only relevant to historical "About Us" content, never to
  describing where Vectis operates today.

Scale & format:
- Around 70+ auctions per year, ~70,000 lots, £7m+ turnover (2021 figures).
- All sales are held live online with worldwide bidder reach.
- Bidding is available online, by telephone, and by post.
- Buyer's premium 22.5% + VAT (27% total). Reserves at 60% of low estimate.

Specialism / departments — name only departments that actually exist:
Star Wars, Star Wars Lego, Music & Memorabilia, TV & Film, TV/Film Props
& Collectables, Dolls, Military Toy Figures, Trains & Model Railway,
Retro Toys, Vintage Diecast, Vintage Toys, Teddy Bears, Lego, Retro Gaming,
Matchbox, Sports Memorabilia, Trading Cards, Corgi, Dinky, Action Man,
Comics, Tinplate, Action Figures, Airfix and Model Kits, Militaria
Memorabilia, Transformers, Barbie. Plus catch-all: lead, plastic, games,
constructional toys, railwayana, books, annuals.

Web & contact:
- Website: vectis.co.uk — the ONLY URL allowed in any output.
- General enquiries email: admin@vectis.co.uk
- Consigning: collections@vectis.co.uk
(Use these only when an email is genuinely useful in the content.)

DO NOT under any circumstances:
- Invent staff names, quotes, founder details, or company history beyond
  Bryan Goodall (owner since 1996) and Roger & Jill Mazillius (founders, 1988).
- Reference URLs other than vectis.co.uk.
- Invent dates, years, or sale names not present in the data below.
- Claim "world's largest", "world's leading", award wins, or similar
  superlatives unless the user-supplied data explicitly says so.
- Use the word "CRM".

ALWAYS:
- British English: "realised", "colour", "specialise", "catalogue".
- Use the EXACT sale names, lot numbers, prices, and dates from the data.
- Use the EXACT year(s) shown in "Year(s) covered" below — never expand
  to a range like "2024–2026" if the data only contains one year.
- Output valid HTML only — no DOCTYPE, html, head, or body tags.
- Tone: professional, reliable, friendly. Knowledgeable enthusiast voice,
  not bombastic auction-house cliché.

═══════════════════════════════════════════════════════════════════
AUCTION DATA
═══════════════════════════════════════════════════════════════════
${yearLine}
Sales covered: ${saleNames || "Various"}
Categories: ${categories || "Various"}
Total hammer value: ${fmtPrice(totalValue)}
Number of lots: ${lots.length}

═══════════════════════════════════════════════════════════════════
LOT DETAIL — use this material to write specifically and richly.
Each lot block contains: headline, sale, estimate, hammer + performance,
description, key points, condition, manufacturer, subcategory.
Lift specific manufacturers, model numbers, condition grades, eras and
distinguishing features into the article. AVOID generic phrasing —
"a beautiful piece", "an iconic toy" — when concrete details are below.
═══════════════════════════════════════════════════════════════════

${lotBlocks}`
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { lots, articleType, modelId } = await req.json() as { lots: Lot[]; articleType: string; modelId?: string }

    if (!lots?.length) return NextResponse.json({ error: "No lots provided" }, { status: 422 })
    if (lots.length > 100) return NextResponse.json({ error: "Too many lots (max 100)" }, { status: 422 })

    const prompt = buildPrompt(lots, articleType ?? "sale_highlight")

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: modelId || "gemini-2.5-flash-preview-04-17" })

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
    console.error("marketing/article error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
