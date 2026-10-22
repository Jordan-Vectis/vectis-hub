import { createHmac, timingSafeEqual } from "crypto"

// The Auto Clerk bid feed's key (security review, 2026-10-22). Made from AUTH_SECRET, so there is no
// new variable to set — and each environment has its own. Signed-in staff fetch it from
// /api/gap-relay/key; the console script and the Saleroom page send it with every call.
export function gapRelayKey(): string | null {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  return secret ? createHmac("sha256", secret).update("gap-relay").digest("hex").slice(0, 32) : null
}

export function isGapRelayKey(given: unknown): boolean {
  const key = gapRelayKey()
  if (!key || typeof given !== "string" || given.length !== key.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(key))
}
