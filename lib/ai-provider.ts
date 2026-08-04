// One place that actually TALKS to an AI provider.
//
// Every AI tool slot is configured in Admin → AI Models with a model id. That id
// now decides the PROVIDER too: anything starting with "claude-" goes to
// Anthropic, everything else to Google Gemini. Routes call generateAiText() and
// don't care which — so switching a tool between providers is a dropdown change,
// not a code change.
//
// ⚠ Both providers' quirks are handled HERE so the ~30 call sites don't each
// re-implement them: Gemini's block/finishReason checks (RULES: never call
// .text() before checking promptFeedback.blockReason and finishReason) and
// Claude's refusal stop_reason + empty-answer guard.

import { GoogleGenerativeAI } from "@google/generative-ai"
import Anthropic from "@anthropic-ai/sdk"

export type AiProvider = "gemini" | "anthropic"

/** Which provider serves a model id. Claude ids are `claude-…`; everything else
 *  is Gemini. Keep this the ONLY place that decides. */
export function providerOf(modelId: string): AiProvider {
  return (modelId ?? "").trim().toLowerCase().startsWith("claude-") ? "anthropic" : "gemini"
}

/** Is the provider behind this model actually configured on this environment? */
export function providerConfigured(p: AiProvider): boolean {
  return p === "anthropic" ? !!process.env.ANTHROPIC_API_KEY : !!process.env.GEMINI_API_KEY
}

export type AiImage = { mimeType: string; data: string }   // data = base64, no prefix

/** Prior turns. `model` is the assistant side — the name Gemini uses; it maps to
 *  Anthropic's "assistant". ⚠ Blank turns are dropped and a leading assistant
 *  turn trimmed: Anthropic rejects both outright, and Gemini is happier without
 *  them either. */
export type AiTurn = { role: "user" | "model"; text: string }

export type AiRequest = {
  model:             string
  prompt:            string
  system?:           string
  images?:           AiImage[]
  history?:          AiTurn[]
  maxOutputTokens?:  number
  /** Ask for raw JSON back. Gemini uses responseMimeType; Claude is instructed. */
  json?:             boolean
}

function cleanHistory(history?: AiTurn[]): AiTurn[] {
  const turns = (history ?? []).filter(h => h && typeof h.text === "string" && h.text.trim().length > 0)
  while (turns.length > 0 && turns[0].role !== "user") turns.shift()
  return turns
}

/** Thrown for a content block / refusal — the caller should surface it, not retry. */
export class AiBlockedError extends Error {
  constructor(message: string) { super(message); this.name = "AiBlockedError" }
}

/** Thrown when the provider isn't configured on this environment. */
export class AiNotConfiguredError extends Error {
  constructor(message: string) { super(message); this.name = "AiNotConfiguredError" }
}

// ── Gemini ───────────────────────────────────────────────────────────────────

async function generateGemini(req: AiRequest): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new AiNotConfiguredError("GEMINI_API_KEY not configured")

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    model: req.model,
    ...(req.system ? { systemInstruction: req.system } : {}),
    generationConfig: {
      ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
      ...(req.json ? { responseMimeType: "application/json" } : {}),
    },
  })

  const parts: any[] = [{ text: req.prompt }]
  for (const img of req.images ?? []) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
  }

  const turns = cleanHistory(req.history)
  const result = turns.length > 0
    ? await model.startChat({ history: turns.map(t => ({ role: t.role, parts: [{ text: t.text }] })) }).sendMessage(parts)
    : await model.generateContent(parts)
  const response = result.response

  // ⚠ RULES: check BOTH of these before calling .text() — calling it on a
  // blocked response throws and loses the reason.
  const blocked = response.promptFeedback?.blockReason
  if (blocked) throw new AiBlockedError(`Gemini blocked the request: ${blocked}`)
  const finish = response.candidates?.[0]?.finishReason
  if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
    throw new AiBlockedError(`Gemini stopped: ${finish}`)
  }

  return response.text().trim()
}

// ── Anthropic (Claude) ───────────────────────────────────────────────────────

async function generateAnthropic(req: AiRequest): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new AiNotConfiguredError("ANTHROPIC_API_KEY not configured")

  const client = new Anthropic({ apiKey })

  const content: Anthropic.ContentBlockParam[] = []
  for (const img of req.images ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mimeType as any, data: img.data },
    })
  }
  content.push({
    type: "text",
    // Claude has no responseMimeType — ask for raw JSON in the prompt instead.
    text: req.json
      ? `${req.prompt}\n\nReply with raw JSON only — no prose, no markdown code fences.`
      : req.prompt,
  })

  // ⚠ Big outputs must STREAM: a non-streaming request with a high max_tokens
  // hits the SDK's HTTP timeout. .finalMessage() gives the assembled message.
  const maxTokens = req.maxOutputTokens ?? 8192
  const messages: Anthropic.MessageParam[] = [
    ...cleanHistory(req.history).map(t => ({
      role: (t.role === "model" ? "assistant" : "user") as "assistant" | "user",
      content: t.text,
    })),
    { role: "user" as const, content },
  ]

  const stream = client.messages.stream({
    model:      req.model,
    max_tokens: maxTokens,
    ...(req.system ? { system: req.system } : {}),
    messages,
  })
  const message = await stream.finalMessage()

  // Claude's safety classifiers can decline: a normal 200 with stop_reason
  // "refusal" and possibly empty content. Check BEFORE reading content.
  if (message.stop_reason === "refusal") {
    const cat = (message as any).stop_details?.category
    throw new AiBlockedError(`Claude declined the request${cat ? ` (${cat})` : ""}.`)
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim()

  if (!text) {
    throw new AiBlockedError(
      message.stop_reason === "max_tokens"
        ? "Claude ran out of room before writing an answer — ask for less at once."
        : "Claude returned an empty response — try again.",
    )
  }
  // Strip a ```json fence if the model added one despite the instruction.
  return req.json ? text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim() : text
}

// ── The one call every route makes ───────────────────────────────────────────

export async function generateAiText(req: AiRequest): Promise<string> {
  return providerOf(req.model) === "anthropic"
    ? generateAnthropic(req)
    : generateGemini(req)
}
