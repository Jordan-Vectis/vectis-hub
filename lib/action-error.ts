"use client"

// Turns whatever a server action threw into something a cataloguer can act on.
//
// Why this exists: in a production build Next.js strips the real message off any
// error thrown while running a server action, and the browser gets
//   "An error occurred in the Server Components render. The specific message is
//    omitted in production builds to avoid leaking sensitive details…"
// — four lines of boilerplate that say nothing about what went wrong. Jordan hit
// exactly that on a photo upload: 859 of 860 photos saved, and the one failure
// was reported as that paragraph.
//
// RULES already says an action whose failure a user must understand should
// RETURN its error rather than throw. This is the other half: for the failures
// that reach the browser as a THROW anyway — a stale deploy, a dropped
// connection, a framework-level error before the action's own try/catch runs —
// say which of those it was, and surface the digest so it can be matched to the
// server log line.

import { isSkewError } from "@/lib/skew-reload"

/** The exact production placeholder. Matching on the distinctive phrase rather
 *  than the whole sentence, which Next has reworded between versions. */
function isRedacted(message: string): boolean {
  return /omitted in production/i.test(message)
}

export type ActionErrorInfo = {
  /** One line, safe to show anywhere. */
  message: string
  /** The server-log reference, when Next gave us one. */
  digest?: string
  /** The app was replaced mid-action — a reload fixes it. */
  staleDeploy: boolean
}

export function describeActionError(e: unknown): ActionErrorInfo {
  const err = e as (Error & { digest?: string }) | undefined
  const raw = err?.message ?? String(e ?? "")
  const digest = typeof err?.digest === "string" ? err.digest : undefined

  // ⚠ Do NOT alias isSkewError's result — it is a type predicate, and assigning
  // it narrows `err` to `never` in the branches below, which hides .digest.
  if (isSkewError(e)) {
    return {
      message: "the app was updated while this was running — reload the page and run it again",
      digest,
      staleDeploy: true,
    }
  }

  if (isRedacted(raw)) {
    return {
      message: digest
        ? `the server hit an error it won't spell out on a live build. Reference ${digest} — IT can look that up in the logs`
        : "the server hit an error it won't spell out on a live build — IT can find it in the logs",
      digest,
      staleDeploy: false,
    }
  }

  return { message: raw || "unknown error", digest, staleDeploy: false }
}

/** The same thing as a single string, for a log line or a list item. */
export function actionErrorText(e: unknown): string {
  return describeActionError(e).message
}
