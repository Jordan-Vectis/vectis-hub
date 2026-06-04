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
  async function generateWithRetry(contents: any[]): Promise<string> {
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

    return response.text()
  }

  const results: { lot: string; description: string; estimate: string; status: string; error?: string }[] = []
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
        userPrompt = `The following key points were recorded about this lot and contain specific details (sizes, quantities, measurements, condition notes, set contents, etc.) that MUST ALL be included in your description. Do not omit any factual detail from the key points. Write a single, natural catalogue description that weaves in every detail from the key points — do not copy them verbatim and do not list them separately, integrate them naturally. Do not repeat the same information twice.

Key points:
${existingContext}`
      } else {
        userPrompt = `Existing description: ${existingContext}\n\nImprove and enhance this description based on the photos. Keep the same output format. Do not repeat the same information twice.`
      }

      const text = await generateWithRetry([
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

      results.push({ lot, description, estimate: estimateLine.replace(/^Estimate:\s*/i, "").trim(), status: "OK" })

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
