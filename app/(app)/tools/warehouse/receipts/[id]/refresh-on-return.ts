"use client"

import { useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

// The receipt PDF, the labels and the email record themselves on the server when they're made
// (printedAt, labelPrintedAt, emailedAt). They open in a NEW tab, so this page can't know when that
// has happened — instead, when someone comes back to this tab (or after a few seconds if they never
// left it), the page fetches its fresh copy, and "Printed …" / "Label printed …" are up to date.

export function useRefreshOnReturn() {
  const router = useRouter()
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  return useCallback(() => {
    cleanup.current?.()
    const go = () => {
      cleanup.current?.()
      router.refresh()
    }
    const onFocus = () => go()
    const onVisible = () => { if (document.visibilityState === "visible") go() }
    // For a tab opened in the background (this page never lost focus): refresh once the PDF has
    // had time to be made, and keep listening for a return a while longer.
    const timer = window.setTimeout(() => router.refresh(), 4000)
    const expire = window.setTimeout(() => cleanup.current?.(), 120_000)
    // Listen only after this click's own focus changes have settled.
    const arm = window.setTimeout(() => {
      window.addEventListener("focus", onFocus)
      document.addEventListener("visibilitychange", onVisible)
    }, 300)
    cleanup.current = () => {
      window.clearTimeout(timer)
      window.clearTimeout(expire)
      window.clearTimeout(arm)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
      cleanup.current = null
    }
  }, [router])
}
