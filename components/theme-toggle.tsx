"use client"

import { useEffect, useState } from "react"

// The Hub's one light/dark switch. The choice is saved per device ("theme" in localStorage) and
// applied before first paint by app/layout.tsx. Small in the top bar; big (size="lg", a 44px touch
// target with a word, not just a symbol) in the tablet cataloguing header and in Website Search,
// which both cover the top bar (Jordan, 2026-09-11).
export default function ThemeToggle({ size = "sm" }: { size?: "sm" | "lg" }) {
  const [dark, setDark] = useState(true)

  // Follow the PAGE, not just this button: another copy of the switch (the tablet header's, Website
  // Search's) can flip it, and each must show the right way round when it comes back into view.
  useEffect(() => {
    const el = document.documentElement
    const sync = () => setDark(el.classList.contains("dark"))
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => mo.disconnect()
  }, [])

  function toggle() {
    const isDark = document.documentElement.classList.toggle("dark")
    setDark(isDark)
    try { localStorage.setItem("theme", isDark ? "dark" : "light") } catch { /* storage blocked — it still switches for now */ }
  }

  const title = dark ? "Switch to light mode" : "Switch to dark mode"

  if (size === "lg") {
    return (
      <button
        type="button"
        onClick={toggle}
        title={title}
        aria-label={title}
        style={{ touchAction: "manipulation" }}
        className="min-h-[44px] flex-shrink-0 rounded-lg border border-gray-300 dark:border-gray-700 px-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors whitespace-nowrap"
      >
        {dark ? "☀ Light" : "🌙 Dark"}
      </button>
    )
  }

  return (
    <button
      onClick={toggle}
      title={title}
      className="text-gray-400 hover:text-white text-sm transition-colors"
    >
      {dark ? "☀" : "🌙"}
    </button>
  )
}
