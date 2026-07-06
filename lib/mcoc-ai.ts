// Shared Gemini helper for the Champion DB build routes. Grounded (Google
// Search) so the champion catalog + profiles reflect the current game, with a
// loose JSON parse (grounding can't be combined with JSON response-mime on
// Gemini) and an ungrounded fallback if a model doesn't support search.

import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { withGeminiRetry } from "@/lib/gemini-retry"

export function parseLooseJson(text: string): any {
  const clean = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim()
  try { return JSON.parse(clean) } catch {}
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}")
  if (s >= 0 && e > s) return JSON.parse(clean.slice(s, e + 1))
  const a = clean.indexOf("["), b = clean.lastIndexOf("]")
  if (a >= 0 && b > a) return JSON.parse(clean.slice(a, b + 1))
  throw new Error("Couldn't read the AI's answer")
}

// Run a prompt (optionally grounded) and return parsed JSON. Throws on Gemini
// block; on a grounding-unsupported error it retries once without search.
export async function groundedJson(prompt: string, clientModel?: string | null): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured")
  const modelId = await getToolModel("jordan_fun", clientModel ?? null)
  const genai = new GoogleGenerativeAI(apiKey)

  async function run(useSearch: boolean) {
    const model = genai.getGenerativeModel({
      model: modelId,
      ...(useSearch ? { tools: [{ googleSearch: {} } as any] } : { generationConfig: { responseMimeType: "application/json" } }),
    })
    return withGeminiRetry(() => model.generateContent(prompt))
  }

  let result
  try {
    result = await run(true)
  } catch (e: any) {
    const msg = String(e?.message ?? e).toLowerCase()
    if (msg.includes("tool") || msg.includes("grounding") || msg.includes("400")) result = await run(false)
    else throw e
  }

  const resp = result.response
  const block = resp.promptFeedback?.blockReason
  if (block) throw new Error(`Blocked by Gemini: ${block}`)
  const finish = resp.candidates?.[0]?.finishReason
  if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") throw new Error(`Blocked by Gemini (${finish})`)
  return parseLooseJson(resp.text())
}
