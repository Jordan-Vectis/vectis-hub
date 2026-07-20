import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { isJordan } from "@/lib/jordan-auth"
import { withGeminiRetry, friendlyGeminiError } from "@/lib/gemini-retry"
import { normChampName } from "@/lib/mcoc"

export const maxDuration = 90

// POST /api/jordan/mcoc/scan-bgs — identify which of the player's OWNED champs
// appear in a Battlegrounds deck screenshot. FormData: image, roster (JSON array
// of names), model. Locked to jordan.orange.
//
// Why this differs from scan-roster: a roster grid has champ NAMES printed under
// each portrait (easy to read), but a BGS deck screen is mostly portraits with
// little/no text — so free-form name reading misfires and can return champs the
// player doesn't own. Constraining the answer to the known roster turns it into
// recognition-against-a-list, which is far more reliable.

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const form = await req.formData()
    const file = form.get("image")
    if (!(file instanceof File)) return NextResponse.json({ error: "No photo received" }, { status: 400 })

    let roster: string[] = []
    try { const r = JSON.parse((form.get("roster") as string) ?? "[]"); if (Array.isArray(r)) roster = r.filter((x) => typeof x === "string" && x.trim()) } catch {}
    if (!roster.length) return NextResponse.json({ error: "Your roster is empty — add champions first, then a deck photo can match them." }, { status: 400 })

    // Downscale big screenshots a touch so the model sees the whole deck clearly.
    let buffer: Buffer = Buffer.from(await file.arrayBuffer())
    try { buffer = Buffer.from(await sharp(buffer).resize({ width: 1400, withoutEnlargement: true }).toBuffer()) } catch {}
    const imagePart = { inlineData: { data: buffer.toString("base64"), mimeType: "image/jpeg" } }

    const prompt = `This is a screenshot from Marvel Contest of Champions showing a set / deck of the player's champions (mostly portraits).

The player OWNS these champions:
${roster.map((n) => `- ${n}`).join("\n")}

Identify which champions FROM THAT LIST appear in the image, matching by their portrait artwork. Return STRICT JSON only (no prose):
{ "matched": [ string ] }

Rules: every name in "matched" MUST be copied exactly from the owned list above. Do NOT include any champion that isn't in the list. Do NOT invent champions. If you're unsure about a portrait, leave it out.`

    const modelId = await getToolModel("jordan_fun", form.get("model") as string | null)
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: modelId, generationConfig: { responseMimeType: "application/json" } })

    const result = await withGeminiRetry(() => model.generateContent([imagePart, { text: prompt }]))
    const response = result.response
    const block = response.promptFeedback?.blockReason
    if (block) return NextResponse.json({ error: `Blocked by Gemini: ${block}` }, { status: 422 })
    const finish = response.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") return NextResponse.json({ error: `Blocked by Gemini (${finish})` }, { status: 422 })

    const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(raw)
    // Keep only names that really are in the roster (guard against any drift).
    const rosterNorm = new Set(roster.map(normChampName))
    const seen = new Set<string>()
    const matched: string[] = (Array.isArray(parsed?.matched) ? parsed.matched : [])
      .map((n: any) => (typeof n === "string" ? n : ""))
      .filter((n: string) => {
        const k = normChampName(n)
        if (!k || !rosterNorm.has(k) || seen.has(k)) return false
        seen.add(k); return true
      })

    return NextResponse.json({ matched })
  } catch (e: any) {
    console.error("jordan/mcoc/scan-bgs error:", e)
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
