"use client"

import { unstable_isUnrecognizedActionError } from "next/navigation"

// A deploy replaces the running build, and Next hashes server action IDs per
// build — so any tab left open across a deploy (the shared iPads, a login page
// someone left sitting there) calls IDs the new server has never heard of. It
// answers 404 and the call rejects. Reloading pulls the current bundle and the
// action resolves, so we do it for them rather than showing an error.

const RELOAD_KEY  = "vectis_skew_reload_at"
// A fresh build recognises the action on the next attempt, so landing back here
// within seconds means the reload didn't help — reloading again would trap the
// user in a loop. Anything longer is a genuine second deploy, so allow it.
const LOOP_WINDOW = 10_000

export function isSkewError(error: unknown): boolean {
  return unstable_isUnrecognizedActionError(error)
}

function reloadedRecently(): boolean {
  if (typeof window === "undefined") return false
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0 } catch { /* Safari private mode */ }
  return Date.now() - last < LOOP_WINDOW
}

/** Whether `error` is a stale-deploy miss we're going to reload for. Lets a
 *  caller decide what to render without waiting for the reload to happen. */
export function willReloadForSkew(error: unknown): boolean {
  return isSkewError(error) && !reloadedRecently()
}

/** Reloads onto the current build if `error` is a stale-deploy action miss.
 *  Returns whether a reload was triggered. */
export function maybeReloadForSkew(error: unknown): boolean {
  if (!willReloadForSkew(error)) return false
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* Safari private mode */ }
  window.location.reload()
  return true
}
