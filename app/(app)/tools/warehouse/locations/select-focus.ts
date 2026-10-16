"use client"

import { useRef, type PointerEvent } from "react"

// A <select> picked with the MOUSE lets go of the cursor afterwards. Otherwise it keeps focus, and
// useScanFocus (rightly) leaves a focused select alone — so the next scanned label's letters went
// into the select's type-ahead instead ("A" picked "All" in "Switched on or off") and its Enter
// ticked nothing. Filter first, then scan labels, is exactly how the Locations list is used.
// Keyboard and touch users keep focus where it is: arrow keys keep working, and an iPad's picker
// isn't closed under a finger.

export function useLetGoAfterMouse() {
  const how = useRef("")
  return {
    onPointerDown: (e: PointerEvent<HTMLSelectElement>) => { how.current = e.pointerType },
    onKeyDown: () => { how.current = "key" },
    /** Call from onChange with the select. */
    letGo: (el: HTMLSelectElement) => { if (how.current === "mouse") el.blur() },
  }
}
