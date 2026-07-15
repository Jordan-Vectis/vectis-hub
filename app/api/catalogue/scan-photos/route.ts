import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 120

// POST /api/catalogue/scan-photos — AI fallback for the Upload Photos smart scan.
// Receives a small batch of photos the in-browser barcode scanner could NOT
// decode and asks Gemini, per photo: is this a barcode LABEL photo or an ITEM
// photo, and if a label, what is the printed code? The client uses "label but
// unreadable" answers to break the photo grouping (so a missed label can't
// silently merge two lots) and readable codes as extra matches.
//
// The client downscales readable images before sending; unreadable-in-browser
// files (HEIC on Windows) arrive as originals — Gemini reads HEIC natively.

const MAX_FILES = 10

// Same acceptance rule as the client scanner: Vectis formats only.
function isVectisBarcode(s: string): boolean {
  return /^[A-Za-z]\d{6,7}$/.test(s) || /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(s)
}

function mimeFor(file: File): string {
  if (file.type) return file.type
  const n = file.name.toLowerCase()
  if (n.endsWith(".png")) return "image/png"
  if (n.endsWith(".webp")) return "image/webp"
  if (n.endsWith(".gif")) return "image/gif"
  if (n.endsWith(".heic") || n.endsWith(".heif")) return "image/heic"
  return "image/jpeg"
}

function buildPrompt(n: number): string {
  return `You are given ${n} photo${n !== 1 ? "s" : ""}, in order, from an auction house photography session. The photographer photographs a printed barcode LABEL first, then several photos of that lot's item(s), then the next lot's label, and so on.

For EACH photo, in the same order, decide:
- LABEL photo: the photo's main subject is a printed barcode label or ticket — typically a small white label showing a barcode with a printed code such as "F090550" or "R000016-413". A small label sticker visible on or near an item in an otherwise normal photo of the item does NOT count as a label photo.
- ITEM photo: anything else — the auction item(s), boxes, packaging, general shots.

If a photo IS a label photo, read the printed code EXACTLY as printed: a letter followed by digits, optionally with a dash and more digits (e.g. F090550, R000016-413). Do NOT guess — if the code is not clearly readable, return null for it.

Return STRICT JSON only (no prose, no markdown):
{ "photos": [ { "label": boolean, "code": string|null } ] }
Exactly ${n} entr${n !== 1 ? "ies" : "y"}, one per photo, in the same order as the photos.`
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const fd = await req.formData()
    const files: File[] = []
    for (let i = 0; i < MAX_FILES; i++) {
      const f = fd.get(`photo_${i}`)
      if (!f) break
      // An empty file must FAIL the batch, not silently truncate it — photos
      // after it would get no AI check while the client believes they did.
      if (!(f instanceof File) || f.size === 0) {
        return NextResponse.json({ error: `Empty or invalid file at photo_${i}` }, { status: 400 })
      }
      files.push(f)
    }
    if (files.length === 0) return NextResponse.json({ error: "No photos provided" }, { status: 400 })

    const imageParts = await Promise.all(files.map(async f => ({
      inlineData: {
        data: Buffer.from(await f.arrayBuffer()).toString("base64"),
        mimeType: mimeFor(f),
      },
    })))

    // The tab's model picker sends its choice in a header (the body is
    // multipart photo data). getToolModel ignores a blank or retired name and
    // falls back to the admin-configured default for this slot.
    const clientModel = req.headers.get("x-ai-model")
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: await getToolModel("catalogue_smart_scan", clientModel),
      generationConfig: { responseMimeType: "application/json" },
    })

    const result = await model.generateContent([...imageParts, { text: buildPrompt(files.length) }])
    const response = result.response
    const block = response.promptFeedback?.blockReason
    if (block) return NextResponse.json({ error: `Blocked (prompt): ${block}` }, { status: 422 })
    const finish = response.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Blocked (${finish})` }, { status: 422 })
    }

    const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(raw)
    const answers: any[] = Array.isArray(parsed?.photos) ? parsed.photos : []

    // Answers map to photos purely by position, so a miscount (the model
    // skipping or merging an entry) would shift every later answer onto the
    // WRONG photo — silent mis-grouping. Reject the whole batch instead; the
    // client retries and falls back to scanner-only grouping with a warning.
    if (answers.length !== files.length) {
      return NextResponse.json(
        { error: `AI returned ${answers.length} answers for ${files.length} photos` },
        { status: 500 }
      )
    }

    const photos = files.map((_, i) => {
      const a = answers[i]
      const label = a?.label === true
      let code: string | null = null
      if (label && typeof a?.code === "string") {
        const cleaned = a.code.replace(/[^\x20-\x7E]/g, "").trim().toUpperCase()
        if (isVectisBarcode(cleaned)) code = cleaned
      }
      return { label, code }
    })

    return NextResponse.json({ photos })
  } catch (e: any) {
    const msg: string = e?.message ?? "Unknown error"
    console.error("catalogue/scan-photos error:", e)
    // Let the client apply a proper backoff on rate limits.
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 429 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
