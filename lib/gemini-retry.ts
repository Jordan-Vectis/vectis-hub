// Small retry wrapper for one-shot Gemini calls. 503 / overloaded errors are
// transient (per RULES: retry, never surface as permanent failure) — retry a
// couple of times with a short wait before giving up with a friendly message.

export function isTransientGeminiError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e ?? "")
  return /\b503\b|service unavailable|overloaded|try again later|deadline exceeded/i.test(msg)
}

export async function withGeminiRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isTransientGeminiError(e) || attempt === attempts) throw e
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  throw lastErr
}
