"use client"

import { useEffect, type RefObject } from "react"

// A scanner "types" into whatever has focus. Once someone has tapped a button, a link or the page,
// the next scan's characters would go nowhere — and the scanner's Enter would press whichever
// button was last tapped (on a bench, "Not finished after all"). So the first printable key of a
// scan, typed while no box has the cursor, pulls the cursor back into the screen's scan box.
// The same rule as Move's (move-screen.tsx); a key typed into any other box is left alone.

/** Inputs that take no typing — a tick box keeps focus after a tap, but a scan typed "into" it is lost. */
const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"])

export function useScanFocus(box: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === " ") return
      const el = document.activeElement as HTMLElement | null
      const typedInto = !!el && (
        (el.tagName === "INPUT" && !NOT_TYPED.has((el as HTMLInputElement).type)) ||
        el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable
      )
      if (typedInto) return
      const target = box.current
      if (!target || target.disabled) return
      target.focus()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [box])
}
