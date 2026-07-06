"use client"

import { useEffect } from "react"

// Applies the retro CRT effect app-wide when it's been switched on from the
// secret /jordan menu. The flag lives in localStorage (per browser); this
// component just re-applies the class on load so the mode survives navigation
// and reloads. Renders nothing.
export const CRT_KEY = "jordan_crt_mode"

export default function CrtMode() {
  useEffect(() => {
    try {
      if (localStorage.getItem(CRT_KEY) === "1") {
        document.documentElement.classList.add("crt-mode")
      }
    } catch { /* localStorage unavailable */ }
  }, [])
  return null
}
