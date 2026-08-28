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
import { GEMINI_SAFETY_SETTINGS } from "@/lib/ai-safety"

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
  /** Big, repeated context that comes BEFORE the prompt — source files, a long
   *  instruction, a document. On Claude this is sent as its own cached block
   *  (see prompt caching below); on Gemini it is simply glued in front of the
   *  prompt. Put the varying bit (the question) in `prompt`, never in here. */
  cachePrefix?:      string
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

/**
 * Which filter actually objected, in words.
 *
 * ⚠ Gemini returns a coarse reason (SAFETY / RECITATION / OTHER) AND a
 * `safetyRatings` array naming the CATEGORY and how strongly it fired. Every
 * route used to report the first and throw away the second, so a blocked lot
 * said "SAFETY" and nobody could tell whether it objected to the picture, a
 * word, or nothing in particular (Jordan, 2026-08-28, on a comics sale).
 *
 * RECITATION carries no ratings — it means the reply was reproducing
 * copyrighted material — so it is named in plain words instead.
 */
export function safetyDetail(response: any): string {
  const tidy = (c: string) => c.replace(/^HARM_CATEGORY_/, "").replace(/_/g, " ").toLowerCase()
  const ratings: any[] = [
    ...(response?.promptFeedback?.safetyRatings ?? []),
    ...(response?.candidates?.[0]?.safetyRatings ?? []),
  ]
  const fired = ratings
    .filter(r => r?.blocked || (r?.probability && !["NEGLIGIBLE", "LOW"].includes(r.probability)))
    .map(r => `${tidy(String(r.category ?? "unknown"))} ${String(r.probability ?? "").toLowerCase()}`.trim())
  const unique = [...new Set(fired)]
  return unique.length ? ` — ${unique.join(", ")}` : ""
}

/** Plain-English gloss for the reasons that carry no safety ratings. */
export function blockMeaning(reason: string): string {
  if (/RECITATION/i.test(reason)) return " — the answer was reproducing copyrighted material"
  if (/PROHIBITED/i.test(reason))  return " — the content is on Google's prohibited list"
  if (/BLOCKLIST/i.test(reason))   return " — a term on Google's blocklist"
  return ""
}

// ── Gemini ───────────────────────────────────────────────────────────────────

async function generateGemini(req: AiRequest): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new AiNotConfiguredError("GEMINI_API_KEY not configured")

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    model: req.model,
    // Same relaxed thresholds as the cataloguing routes — see lib/ai-safety.ts.
    // ⚠ Does nothing for RECITATION; that one has no threshold to relax.
    safetySettings: GEMINI_SAFETY_SETTINGS,
    ...(req.system ? { systemInstruction: req.system } : {}),
    generationConfig: {
      ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
      ...(req.json ? { responseMimeType: "application/json" } : {}),
    },
  })

  // Gemini has its own (separate, explicit) caching product we don't use, so the
  // prefix is just text in front of the prompt here.
  const parts: any[] = [{ text: req.cachePrefix ? `${req.cachePrefix}\n\n${req.prompt}` : req.prompt }]
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
  if (blocked) throw new AiBlockedError(`Gemini blocked the request: ${blocked}${blockMeaning(blocked)}${safetyDetail(response)}`)
  const finish = response.candidates?.[0]?.finishReason
  if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
    throw new AiBlockedError(`Gemini stopped: ${finish}${blockMeaning(finish)}${safetyDetail(response)}`)
  }

  return response.text().trim()
}

// ── Anthropic (Claude) ───────────────────────────────────────────────────────

async function generateAnthropic(req: AiRequest): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new AiNotConfiguredError("ANTHROPIC_API_KEY not configured")

  const client = new Anthropic({ apiKey })

  const content: Anthropic.ContentBlockParam[] = []

  // ── Prompt caching ─────────────────────────────────────────────────────────
  // Anthropic caches on an exact PREFIX match: the stable text has to come
  // first, and the varying text after it. So the order here is deliberate —
  // system prompt, then cachePrefix, then the images and the actual question.
  // A cached block re-read costs ~10% of the normal input price; writing it
  // costs 25% more, so it pays for itself from the second call that reuses the
  // same prefix (a batch run over 300 lots reuses the same instruction 300
  // times). A prefix under the model's minimum simply isn't cached — no error
  // and no write charge — so marking a short one is harmless.
  // ⚠ Never move anything that changes per call ABOVE a cache_control marker:
  // that invalidates the cache on every request and you pay the write premium
  // for nothing.
  if (req.cachePrefix?.trim()) {
    content.push({
      type: "text",
      text: req.cachePrefix,
      cache_control: { type: "ephemeral" },
    })
  }

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
    // Block form (not a bare string) so the system prompt can carry a cache
    // marker — it is the same on every call a tool makes, so it is the single
    // best thing to cache.
    ...(req.system ? { system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }] } : {}),
    messages,
  })
  const message = await stream.finalMessage()

  // Cache effectiveness is invisible unless you look — log it so a silent
  // invalidator (a timestamp or an id creeping into the prefix) shows up as
  // "read 0" on every call instead of quietly costing full price.
  const wrote = message.usage?.cache_creation_input_tokens ?? 0
  const read  = message.usage?.cache_read_input_tokens ?? 0
  if (wrote || read) {
    console.log(`[ai-provider] ${req.model} cache: wrote ${wrote}, read ${read}, uncached ${message.usage?.input_tokens ?? 0}`)
  }

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
