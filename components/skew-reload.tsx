"use client"

import { useEffect } from "react"
import { maybeReloadForSkew } from "@/lib/skew-reload"

// Catches stale-deploy server action misses from the calls the error boundary
// can't see. app/error.tsx only covers actions dispatched through a transition
// (useActionState, the login form); most of the Hub awaits actions directly in
// a click handler, where a rejection surfaces as an unhandled rejection and the
// button would otherwise just do nothing. Renders nothing.
export default function SkewReload() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      // preventDefault only when we're actually reloading — if the loop guard
      // declined, let it log so the failure is still diagnosable.
      if (maybeReloadForSkew(e.reason)) e.preventDefault()
    }
    window.addEventListener("unhandledrejection", onRejection)
    return () => window.removeEventListener("unhandledrejection", onRejection)
  }, [])
  return null
}
