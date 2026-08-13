import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 300

// ── Types ─────────────────────────────────────────────────────────────────────

export type LotItem = {
  uid:       string   // stable id so the page can move items between lots
  name:      string
  qty:       number
  valueLow:  number
  valueHigh: number
  photo:     number   // 0-based index of the photo this item is in
  bounds:    { y: number; h: number }   // % of that photo's height
  /** Empty when the model is confident. Otherwise what it is unsure about. */
  uncertain: string
}

export type LotKind = "single" | "grouped" | "joblot"

export type LotGroup = {
  gid:          string   // stable across edits/renumbering — tracks "already added to a sale"
  id:           number
  title:        string
  kind:         LotKind
  items:        LotItem[]
  estimateLow:  number
  estimateHigh: number
  notes:        string
  colour:       string
}

export type LottingUpResult = {
  targetLow:         number
  targetHigh:        number
  photoCount:        number
  sceneNotes:        string
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

export const DEFAULT_TARGET_LOW  = 60
export const DEFAULT_TARGET_HIGH = 80
export const MAX_PHOTOS          = 10

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPrompt(lo: number, hi: number, photoCount: number) {
  const multi = photoCount > 1

  const photoRules = multi
    ? `════════════════════════════════════════════════════════════════
YOU HAVE ${photoCount} PHOTOS OF THE SAME LAYOUT
════════════════════════════════════════════════════════════════
These are ${photoCount} photos of ONE lot of stock — the same bench, shelving or table,
photographed in sections because it does not fit in a single frame.

• Treat them as ONE pile of stock, not ${photoCount} separate jobs.
• A lot MAY combine items from different photos — that is expected and often correct.
  Four cheap Star Wars sets spread across photos 1 and 3 are still one £${lo}–£${hi} lot.
• Watch for the SAME item appearing in two photos where they overlap. Count it ONCE.
  If you are not certain whether two things are the same item, say so in "uncertain".
• Every item entry must say which photo it is in, with "photo": 1 to ${photoCount}.`
    : `Every item entry must set "photo": 1.`

  return `You are a senior auction cataloguer at Vectis, a specialist toy and collectible auction house.

You are looking at ${multi ? `${photoCount} photographs` : "a photograph"} of stock laid out for cataloguing —
usually shelving, a bench, a table, or totes. Your job is to split EVERYTHING you can see into
saleable auction lots.

════════════════════════════════════════════════════════════════
THE RULE THAT MATTERS — THE LOT VALUE BAND: £${lo}–£${hi}
════════════════════════════════════════════════════════════════
A lot is only worth putting into a sale if it is worth roughly £${lo}–£${hi}.
Work VALUE FIRST: price each item in your head, THEN decide what goes with what.
Do not group by tidiness or by shelf — group by value.

1. HIGH-VALUE SINGLES ("kind": "single")
   Any single item worth £${hi} or more on its own IS a lot on its own. A £120 item, a £400 item —
   each stands alone, and that is completely correct. It is already past the band.
   • NEVER pad a high-value single with cheap filler to "make up a lot".
   • NEVER merge two high-value singles into one lot — that is two lots, and two lots sell better.

2. GROUP UP ("kind": "grouped") — THIS IS THE MAIN JOB
   Items worth less than £${lo} on their own are almost never sold on their own. Combine similar
   items until the group reaches £${lo}–£${hi}. A £15 item is not a lot. Four of them together is.
   Keep adding items to a lot until its low estimate reaches £${lo}, then stop and start the next lot.

3. DO NOT OVER-GROUP
   A pile of small items adding up to £300 is a mistake — that is four lots, not one.
   As soon as a lot reaches roughly £${hi}, close it and begin the next one.
   The ONLY reason to exceed £${hi} with multiple items is a genuine matched set or collection that
   collectors want kept intact (a complete boxed series, a full train set, a run of the same range).
   If you do that, say why in "notes".

4. WHAT GOES WITH WHAT
   Group items a bidder would want to buy together, in this order of preference:
     a) same manufacturer AND same range
     b) same theme or subject
     c) same scale / era / type
     d) same broad category
   A mixed "job lot" is a LAST resort, not a first move.

5. LEFTOVERS ("kind": "joblot")
   If what remains cannot reach £${lo} even when combined, put ALL of it into one final job lot and
   title it as such (e.g. "Mixed job lot of playworn diecast"). Never leave a £15 item sitting as its
   own lot when it could have joined something.

6. COVER EVERYTHING
   Every visible item must appear in exactly ONE lot. Do not skip items. Do not invent items you
   cannot actually see. If a shelf holds twelve near-identical cars, that is one entry with qty 12.

${photoRules}

════════════════════════════════════════════════════════════════
SAY WHEN YOU ARE NOT SURE — this matters as much as the grouping
════════════════════════════════════════════════════════════════
Every item has an "uncertain" field.

• Confident about what it is and roughly what it is worth → "uncertain": ""
• ANY real doubt → put the doubt in "uncertain", in one short plain sentence.

Do NOT quietly guess. A cataloguer would far rather be told "I think this is a Corgi Batmobile but
the box number isn't readable" than be handed a confident wrong answer. Flag it when:
  • the item is blurred, in shadow, behind something, or only part-visible
  • you can read the maker but not the model, or the model but not the variant
  • it could be a reproduction, a repaint, or an empty box
  • you cannot tell whether it is boxed, complete, or in playworn condition
  • the value could reasonably be double or half what you have put

Keep valuing it anyway — give your best estimate AND the doubt. An uncertain item is still placed
in a lot; the cataloguer will check it in the hand.

════════════════════════════════════════════════════════════════
VALUES
════════════════════════════════════════════════════════════════
• All values are GBP whole numbers, based on typical Vectis hammer results — realistic, not hopeful.
• Each item entry carries its own valueLow / valueHigh. If qty is 12, those values cover all 12.
• The item values in a lot MUST add up to that lot's estimateLow / estimateHigh. If the lot is worth
  more together than the pieces are apart, spread that premium across the items so the sums match.

════════════════════════════════════════════════════════════════
VERTICAL POSITION — per item, so the photo can be marked up
════════════════════════════════════════════════════════════════
Every item carries yTop and yBottom: where that item sits vertically in ITS OWN photo.
  • 0 = the very top of that photo, 100 = the very bottom
  • yBottom must always be greater than yTop
  • For shelving: count the visible shelves from the top. With 12 shelves, an item on shelf 4 sits at
    roughly yTop=25, yBottom=33.
  • Keep these tight to the actual item — do not use 0–100 unless the item really does span the photo.

════════════════════════════════════════════════════════════════
OUTPUT
════════════════════════════════════════════════════════════════
Return ONLY valid JSON — no markdown, no commentary:

{
  "sceneNotes": "<one short line on what this stock is>",
  "groups": [
    {
      "id": 1,
      "title": "<lot title, under 60 characters>",
      "kind": "single" | "grouped" | "joblot",
      "items": [
        {
          "name": "<item>", "qty": 1,
          "valueLow": 20, "valueHigh": 30,
          "photo": 1, "yTop": 10, "yBottom": 22,
          "uncertain": ""
        }
      ],
      "estimateLow": 60,
      "estimateHigh": 80,
      "notes": "<condition notes, or why this lot breaks the band>"
    }
  ]
}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""))
  return Number.isFinite(n) ? n : fallback
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v))

type RawItem = {
  name?: string; qty?: number; valueLow?: number; valueHigh?: number
  photo?: number; yTop?: number; yBottom?: number; uncertain?: string
}
type RawGroup = {
  id?: number; title?: string; kind?: string; notes?: string
  items?: (RawItem | string)[]
  estimateLow?: number; estimateHigh?: number
}

/**
 * Turn whatever the model returned into a clean result. Item values are the
 * source of truth for a lot's estimate — the page recalculates the same way as
 * the cataloguer moves items about, so the two can never disagree.
 */
function normalise(
  parsed: { sceneNotes?: string; groups?: RawGroup[] },
  lo: number,
  hi: number,
  photoCount: number,
): LottingUpResult {
  let uid = 0

  const groups: LotGroup[] = (parsed.groups ?? []).map((g, gi) => {
    const items: LotItem[] = (g.items ?? []).map(raw => {
      const it: RawItem = typeof raw === "string" ? { name: raw } : (raw ?? {})
      const yTop    = clampPct(num(it.yTop, 0))
      const yBottom = Math.max(yTop + 1, clampPct(num(it.yBottom, 100)))
      const vLow    = Math.max(0, Math.round(num(it.valueLow)))
      const vHigh   = Math.max(vLow, Math.round(num(it.valueHigh, vLow)))
      // Model counts photos from 1; clamp into range so a bad index can never
      // point the overlay at a photo that isn't there.
      const photo   = Math.max(0, Math.min(photoCount - 1, Math.round(num(it.photo, 1)) - 1))
      return {
        uid:       `i${uid++}`,
        name:      String(it.name ?? "Unidentified item").trim() || "Unidentified item",
        qty:       Math.max(1, Math.round(num(it.qty, 1))),
        valueLow:  vLow,
        valueHigh: vHigh,
        photo,
        bounds:    { y: yTop, h: yBottom - yTop },
        uncertain: String(it.uncertain ?? "").trim(),
      }
    }).filter(it => it.name)

    // If the model gave a lot estimate but no per-item values, spread it evenly
    // so the card still adds up and stays editable.
    const sumLow = items.reduce((s, i) => s + i.valueLow, 0)
    if (sumLow === 0 && items.length && num(g.estimateLow) > 0) {
      const low  = Math.round(num(g.estimateLow)  / items.length)
      const high = Math.round(num(g.estimateHigh, num(g.estimateLow)) / items.length)
      items.forEach(i => { i.valueLow = low; i.valueHigh = Math.max(low, high) })
    }

    const kind: LotKind =
      g.kind === "single" || g.kind === "joblot" || g.kind === "grouped"
        ? g.kind
        : items.length === 1 ? "single" : "grouped"

    return {
      gid:          crypto.randomUUID(),
      id:           gi + 1,
      title:        String(g.title ?? `Lot ${gi + 1}`).trim().slice(0, 60) || `Lot ${gi + 1}`,
      kind,
      items,
      estimateLow:  items.reduce((s, i) => s + i.valueLow,  0),
      estimateHigh: items.reduce((s, i) => s + i.valueHigh, 0),
      notes:        String(g.notes ?? "").trim(),
      colour:       "",
    }
  }).filter(g => g.items.length > 0)

  // Photo order, then top of the photo down — the order a cataloguer works a bench.
  const firstOf = (g: LotGroup) => Math.min(...g.items.map(i => i.photo))
  const topOf   = (g: LotGroup) => Math.min(...g.items.filter(i => i.photo === firstOf(g)).map(i => i.bounds.y))
  groups.sort((a, b) => (firstOf(a) - firstOf(b)) || (topOf(a) - topOf(b)))
  groups.forEach((g, i) => { g.id = i + 1; g.colour = COLOURS[i % COLOURS.length] })

  return {
    targetLow:         lo,
    targetHigh:        hi,
    photoCount,
    sceneNotes:        String(parsed.sceneNotes ?? "").trim(),
    totalEstimateLow:  groups.reduce((s, g) => s + g.estimateLow,  0),
    totalEstimateHigh: groups.reduce((s, g) => s + g.estimateHigh, 0),
    groups,
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const formData = await req.formData()
    const files = (formData.getAll("photo") as File[]).filter(f => f && f.size > 0).slice(0, MAX_PHOTOS)
    if (!files.length) return NextResponse.json({ error: "No photo provided" }, { status: 400 })

    const clientModel = (formData.get("model") as string | null) ?? null

    let lo = Math.max(1, Math.round(num(formData.get("targetLow"),  DEFAULT_TARGET_LOW)))
    let hi = Math.max(1, Math.round(num(formData.get("targetHigh"), DEFAULT_TARGET_HIGH)))
    if (hi < lo) [lo, hi] = [hi, lo]

    const parts = await Promise.all(files.map(async f => ({
      inlineData: {
        data:     Buffer.from(await f.arrayBuffer()).toString("base64"),
        mimeType: f.type || "image/jpeg",
      },
    })))

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: await getToolModel("catalogue_lotting_up", clientModel),
      generationConfig: { responseMimeType: "application/json" },
    })

    const result = await model.generateContent([buildPrompt(lo, hi, files.length), ...parts])

    // Never call .text() before checking — it throws and loses the block reason.
    const response = result.response
    const blockReason = response.promptFeedback?.blockReason
    if (blockReason) {
      return NextResponse.json({ error: `Photos blocked by Gemini (${blockReason})` }, { status: 422 })
    }
    const finish = response.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Gemini stopped early (${finish})` }, { status: 422 })
    }

    const raw  = response.text().trim()
    const json = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim()

    let parsed: { sceneNotes?: string; groups?: RawGroup[] }
    try {
      parsed = JSON.parse(json)
    } catch {
      console.error("[lotting-up] unparseable response:", raw.slice(0, 500))
      return NextResponse.json({ error: "The model did not return usable JSON — try again." }, { status: 502 })
    }

    const out = normalise(parsed, lo, hi, files.length)
    if (!out.groups.length) {
      return NextResponse.json({ error: "No items could be identified in those photos." }, { status: 422 })
    }

    return NextResponse.json(out)
  } catch (e: any) {
    console.error("[lotting-up]", e)
    return NextResponse.json({ error: e?.message ?? "Analysis failed" }, { status: 500 })
  }
}
