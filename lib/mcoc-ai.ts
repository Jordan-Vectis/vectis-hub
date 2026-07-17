// Shared Gemini helper for the Champion DB build routes. Grounded (Google
// Search) so the champion catalog + profiles reflect the current game, with a
// loose JSON parse (grounding can't be combined with JSON response-mime on
// Gemini) and an ungrounded fallback if a model doesn't support search.

import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { withGeminiRetry } from "@/lib/gemini-retry"

export function parseLooseJson(text: string): any {
  const clean = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim()
  // Try the whole thing, then the outermost {...} and [...] slices; each with a
  // trailing-comma repair. Never throws the raw V8 SyntaxError (callers key their
  // grounded→ungrounded fallback off this message).
  const candidates = [clean]
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}")
  if (s >= 0 && e > s) candidates.push(clean.slice(s, e + 1))
  const a = clean.indexOf("["), b = clean.lastIndexOf("]")
  if (a >= 0 && b > a) candidates.push(clean.slice(a, b + 1))
  for (const c of candidates) {
    try { return JSON.parse(c) } catch {}
    try { return JSON.parse(c.replace(/,\s*([}\]])/g, "$1")) } catch {}
  }
  throw new Error("Couldn't read the AI's answer")
}

// Run a prompt (optionally grounded) and return parsed JSON. Accepts a plain
// prompt string OR a parts array (e.g. [imagePart, {text}]) for vision calls.
// Throws on Gemini block; on a grounding-unsupported error it retries once
// without search.
export type GeminiParts = string | any[]
// onFallback fires when the grounded call failed and we answered from the
// model's own (stale) knowledge instead — the MCOC meta shifts monthly, so a
// caller that cares can tell the user the answer may be out of date. Optional so
// the existing callers are unaffected.
export async function groundedJson(
  input: GeminiParts,
  clientModel?: string | null,
  onFallback?: () => void,
): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured")
  const modelId = await getToolModel("jordan_fun", clientModel ?? null)
  const genai = new GoogleGenerativeAI(apiKey)

  async function run(useSearch: boolean) {
    const model = genai.getGenerativeModel({
      model: modelId,
      ...(useSearch ? { tools: [{ googleSearch: {} } as any] } : { generationConfig: { responseMimeType: "application/json" } }),
    })
    const resp = (await withGeminiRetry(() => model.generateContent(input as any))).response
    const block = resp.promptFeedback?.blockReason
    if (block) throw new Error(`Blocked by Gemini: ${block}`)
    const finish = resp.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") throw new Error(`Blocked by Gemini (${finish})`)
    return parseLooseJson(resp.text())
  }

  // Grounded (live meta) first. Fall back to an ungrounded strict-JSON call if
  // the model can't ground OR the grounded reply won't parse — grounding forbids
  // JSON response-mime, so the model sometimes leaks prose into the JSON.
  try {
    return await run(true)
  } catch (e: any) {
    const msg = String(e?.message ?? e).toLowerCase()
    const groundingUnsupported = msg.includes("tool") || msg.includes("grounding") || msg.includes("400")
    const unparseable = msg.includes("couldn't read") || msg.includes("not valid json") || msg.includes("unexpected token")
    if (groundingUnsupported || unparseable) { onFallback?.(); return run(false) }
    throw e
  }
}
