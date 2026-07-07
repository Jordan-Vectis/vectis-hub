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
