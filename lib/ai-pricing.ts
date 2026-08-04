// What an AI run costs, worked out BEFORE it is run.
//
// Prices are USD per 1,000,000 tokens — the unit both Anthropic and Google bill
// in, and the unit their consoles show, so a figure here can be checked against
// a real bill without converting anything.
//
// ⚠ Two different levels of confidence live in this table, and the UI shows
// which is which. Anthropic publish a short, stable price list and those rows
// are taken from it. Google's model ids drift (`gemini-3-flash-preview` and
// friends) and their price list names models differently, so those rows are a
// best match rather than a quote — an admin can correct any row in
// Admin → AI Models, which is stored in `AiModelRate` and wins over these.
//
// A model with NO row and no override is reported as "price not set" rather
// than being guessed at — an invented number is worse than no number.

export type ModelRate = { inputPerM: number; outputPerM: number }

export type RateRow = ModelRate & {
  /** Matched against the START of the model id, most specific first. */
  match:     string
  label:     string
  /** True when taken from the provider's published list; false = best match. */
  confident: boolean
}

// Most specific first — the first prefix that matches wins.
export const DEFAULT_RATES: RateRow[] = [
  // ── Anthropic (published) ──
  { match: "claude-opus-5",     label: "Claude Opus 5",     inputPerM: 5,    outputPerM: 25,   confident: true },
  { match: "claude-sonnet-5",   label: "Claude Sonnet 5",   inputPerM: 3,    outputPerM: 15,   confident: true },
  { match: "claude-haiku-4-5",  label: "Claude Haiku 4.5",  inputPerM: 1,    outputPerM: 5,    confident: true },
  // Any future Claude id we haven't listed — price it as the dearest tier so an
  // estimate is never an under-quote.
  { match: "claude-",           label: "Claude (unlisted)", inputPerM: 5,    outputPerM: 25,   confident: false },

  // ── Google (best match to their published list) ──
  // ⚠ Ordering matters: "lite" and "pro" must be tested before plain "flash".
  { match: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", inputPerM: 0.10, outputPerM: 0.40, confident: true },
  { match: "gemini-2.5-pro",        label: "Gemini 2.5 Pro",        inputPerM: 1.25, outputPerM: 10,   confident: true },
  { match: "gemini-2.5-flash",      label: "Gemini 2.5 Flash",      inputPerM: 0.30, outputPerM: 2.50, confident: true },
  { match: "gemini-2.0-flash",      label: "Gemini 2.0 Flash",      inputPerM: 0.10, outputPerM: 0.40, confident: true },
  { match: "gemini-3-pro",          label: "Gemini 3 Pro",          inputPerM: 2,    outputPerM: 18,   confident: false },
  { match: "gemini-3-flash",        label: "Gemini 3 Flash",        inputPerM: 1.50, outputPerM: 9,    confident: false },
  { match: "gemini-3",              label: "Gemini 3",              inputPerM: 2,    outputPerM: 18,   confident: false },
]

export function defaultRateFor(modelId: string): RateRow | null {
  const id = (modelId ?? "").trim().toLowerCase()
  if (!id) return null
  return DEFAULT_RATES.find(r => id.startsWith(r.match)) ?? null
}

/** Merge admin overrides (keyed by exact model id) over the defaults. */
export function rateFor(modelId: string, overrides: Record<string, ModelRate>): (ModelRate & { source: "override" | "published" | "assumed" }) | null {
  const id = (modelId ?? "").trim()
  const o = overrides[id] ?? overrides[id.toLowerCase()]
  if (o) return { ...o, source: "override" }
  const d = defaultRateFor(id)
  return d ? { inputPerM: d.inputPerM, outputPerM: d.outputPerM, source: d.confident ? "published" : "assumed" } : null
}

// ── Token estimation ─────────────────────────────────────────────────────────
// Rough by design. ~4 characters per token is the usual rule of thumb for
// English prose; both providers tokenise a bit differently but not enough to
// change a "will this cost pennies or pounds" decision.
export const CHARS_PER_TOKEN = 4

export const tokensOfText = (text: string): number => Math.ceil((text ?? "").length / CHARS_PER_TOKEN)

// Cost of ONE photo, in tokens.
// Google: an image is cut into 768px-ish tiles at 258 tokens each; a typical
// 4:3 camera photo works out at 4 tiles. Anthropic: a photo resized to their
// standard resolution lands around 1,600 tokens.
export const TOKENS_PER_PHOTO = { gemini: 1032, anthropic: 1600 } as const

export function tokensOfPhotos(modelId: string, count: number): number {
  const per = (modelId ?? "").toLowerCase().startsWith("claude-")
    ? TOKENS_PER_PHOTO.anthropic
    : TOKENS_PER_PHOTO.gemini
  return per * Math.max(0, count)
}

export type RunEstimate = {
  items:        number
  inputTokens:  number
  outputTokens: number
  /** null when no price is known for the model — show "price not set", not £0. */
  usd:          number | null
  source:       "override" | "published" | "assumed" | "unknown"
}

/**
 * Estimate a whole run. `perItem` describes ONE unit of work (one lot):
 * the text sent, the photos attached, and roughly how much text comes back.
 */
export function estimateRun(opts: {
  model:     string
  items:     number
  perItemInputTokens:  number
  perItemOutputTokens: number
  overrides: Record<string, ModelRate>
}): RunEstimate {
  const items = Math.max(0, Math.round(opts.items))
  const inputTokens  = items * Math.max(0, Math.round(opts.perItemInputTokens))
  const outputTokens = items * Math.max(0, Math.round(opts.perItemOutputTokens))
  const rate = rateFor(opts.model, opts.overrides)
  const usd = rate
    ? (inputTokens / 1_000_000) * rate.inputPerM + (outputTokens / 1_000_000) * rate.outputPerM
    : null
  return { items, inputTokens, outputTokens, usd, source: rate?.source ?? "unknown" }
}

/** "$0.42" / "less than $0.01" / "—". Never rounds a real cost down to $0.00. */
export function formatUsd(usd: number | null): string {
  if (usd == null) return "—"
  if (usd === 0) return "$0.00"
  if (usd < 0.01) return "less than $0.01"
  return `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(usd < 1000 ? 2 : 0)}`
}

export const formatTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n)
