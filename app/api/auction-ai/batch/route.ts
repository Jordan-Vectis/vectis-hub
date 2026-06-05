import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  const formData = await req.formData()
  const systemInstruction = formData.get("systemInstruction") as string ?? ""
  const modelId           = formData.get("model") as string || "gemini-3-flash-preview"
  const grounded          = formData.get("grounded") === "true"

  // Each lot is submitted as: lot_{name}_image_{i} files
  // We reconstruct the lots from the file field names
  const lotMap: Record<string, File[]> = {}
  for (const [key, value] of formData.entries()) {
    const m = key.match(/^lot_(.+)_image_\d+$/)
    if (m && value instanceof File) {
      const lot = m[1]
      if (!lotMap[lot]) lotMap[lot] = []
      lotMap[lot].push(value as File)
    }
  }

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    model: modelId,
    systemInstruction: systemInstruction || undefined,
    // Google Search grounding lets Gemini look up catalogue numbers and product details
    // in real time. Only enabled when the client requests it — strict presets are unaffected.
    // Note: not all models support grounding; errors surface in the client log.
    ...(grounded ? { tools: [{ googleSearch: {} } as any] } : {}),
  })

  // No retries here — throw immediately so the real Gemini error surfaces in the
  // client log and the client's own backoff loop handles retrying.
  // Rate-limit errors are prefixed with RATE_LIMITED: so the client can apply
  // a longer backoff before retrying.
  async function generateWithRetry(contents: any[]): Promise<{ text: string; searchQueries: string[] }> {
    let result: any
    try {
      result = await model.generateContent(contents)
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (/429|resource.?exhausted|quota|rate.?limit/i.test(msg)) {
        throw new Error(`RATE_LIMITED: ${msg}`)
      }
      throw e
    }

    const response = result.response

    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) throw new Error(`Blocked (prompt): ${promptBlock}`)

    const candidate    = response.candidates?.[0]
    const finishReason = candidate?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`Blocked (${finishReason})`)
    }

    // Surface whether Google Search grounding actually fired
    const searchQueries: string[] = (candidate?.groundingMetadata as any)?.webSearchQueries ?? []

    return { text: response.text(), searchQueries }
  }

  const results: { lot: string; description: string; estimate: string; status: string; error?: string; debug?: { prompt: string; response: string; imageCount: number; searchQueries?: string[] } }[] = []
  const lotEntries = Object.entries(lotMap)

  for (let idx = 0; idx < lotEntries.length; idx++) {
    const [lot, files] = lotEntries[idx]
    try {
      const imageParts = await Promise.all(
        files.slice(0, 24).map(async (file) => {
          const buffer = await file.arrayBuffer()
          const base64 = Buffer.from(buffer).toString("base64")
          return { inlineData: { data: base64, mimeType: file.type || "image/jpeg" } }
        })
      )

      const existingContext = formData.get(`lot_${lot}_context`) as string | null
      const contextType    = formData.get(`lot_${lot}_contextType`) as string | null  // "keyPoints" | "description"

      let userPrompt: string
      if (!existingContext) {
        userPrompt = "Please describe this auction lot."
      } else if (contextType === "keyPoints") {
        userPrompt = `The following key points were recorded about this lot. ALL of them must appear in your description — do not omit a single one.

CRITICAL: Only use the information in the key points and what you can directly observe in the photos. Do NOT add product history, specifications, piece counts, features, or any other details from your training data that are not explicitly stated in the key points. If a detail is not in the key points and cannot be seen in the photos, leave it out entirely.

EXCEPTION: If a key point contains a set or catalogue number (e.g. a LEGO set number like #42110, a Playmobil set number, etc.), you MUST resolve it to its full product name and include both the name and number in the description. This is the only permitted use of training knowledge.

PRESERVE EXACT MEANING — do not soften or paraphrase factual key points. Short condition, completeness or packaging notes (e.g. "Sealed Mint", "Sealed", "Mint", "Boxed", "Unboxed", "Complete", measurements like "55\\"x39\\"") carry a precise meaning and MUST appear with that meaning intact, using the cataloguer's own wording. For example: "Sealed Mint" means factory sealed AND mint condition — do NOT weaken it to "in original boxes" or "remains sealed". If you cannot fit the exact term naturally, state it plainly rather than dropping or rewording it. Losing or softening any such key point is a failure.

Write a single, concise catalogue description that naturally incorporates every key point. Do not list them separately and do not repeat the same information twice — but keep the precise factual wording of condition/completeness/measurement key points exactly as given.

Key points:
${existingContext}`
      } else {
        userPrompt = `Existing description: ${existingContext}\n\nImprove and enhance this description based on the photos. Only use information present in the existing description or directly visible in the photos — do not add details from training data. Keep the same output format. Do not repeat the same information twice.`
      }

      const { text, searchQueries } = await generateWithRetry([
        ...imageParts,
        { text: userPrompt },
      ])

      // Occasionally Gemini returns a JSON object instead of plain text — extract description if so
      let rawText = text.trim()
      try {
        const parsed = JSON.parse(rawText)
        if (parsed && typeof parsed.description === "string") rawText = parsed.description.trim()
      } catch { /* not JSON — use as-is */ }

      // Split description and estimate — preserve newlines so list formatting is kept
      const lines = rawText.split("\n")
      const estimateLine = lines.find((l) => l.toLowerCase().startsWith("estimate:")) ?? ""
      const description  = lines.filter((l) => !l.toLowerCase().startsWith("estimate:")).join("\n").trim()

      results.push({ lot, description, estimate: estimateLine.replace(/^Estimate:\s*/i, "").trim(), status: "OK",
        debug: { prompt: userPrompt, response: text, imageCount: imageParts.length, searchQueries } })

      // 12-second delay between lots to stay well under Gemini rate limits
      if (idx < lotEntries.length - 1) {
        await new Promise((r) => setTimeout(r, 12000))
      }
    } catch (e: any) {
      results.push({ lot, description: "", estimate: "", status: "FAILED", error: e.message })
    }
  }

  return NextResponse.json({ results })
}
