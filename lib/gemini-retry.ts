// Small retry wrapper for one-shot Gemini calls. 503 / overloaded errors are
// transient (per RULES: retry, never surface as permanent failure) — retry a
// couple of times with a short wait before giving up with a friendly message.

export function isTransientGeminiError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e ?? "")
  return /\b503\b|service unavailable|overloaded|try again later|deadline exceeded/i.test(msg)
}

// 429 / quota exhaustion — a distinct failure that needs a longer back-off than
// a transient 503 (rate-limit windows are per-minute, not per-second).
export function isRateLimitError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e ?? "")
  return /\b429\b|resource[ _]?exhausted|rate[ _]?limit|too many requests|\bquota\b/i.test(msg)
}

// Map a Gemini failure to something a person can act on, or null to let the
// caller surface its own message. Google's own text is unusable in a UI — a
// quota failure arrives as a wall of "generativelanguage.googleapis.com …
// GenerateRequestsPerMinutePerProjectPerUser …", which is what was leaking into
// the chat. Only the two noisy, expected classes are translated; anything else
// keeps its real message so genuine bugs stay diagnosable.
export function friendlyGeminiError(e: unknown): { error: string; status: number } | null {
  if (isRateLimitError(e)) {
    return {
      error: "Google's AI is rate-limited right now (too many requests in a short time) — wait a minute and try again, or switch model.",
      status: 429,
    }
  }
  if (isTransientGeminiError(e)) {
    return { error: "That model is overloaded right now — try again in a minute, or switch model.", status: 503 }
  }
  return null
}

export async function withGeminiRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const rate = isRateLimitError(e)
      if ((!isTransientGeminiError(e) && !rate) || attempt === attempts) throw e
      // Rate limits get a longer wait than transient 503s.
      await new Promise((r) => setTimeout(r, rate ? Math.min(8000 * attempt, 24000) : 1500 * attempt))
    }
  }
  throw lastErr
}
