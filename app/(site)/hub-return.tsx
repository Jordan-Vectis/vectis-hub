"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

// A small floating "back to the Hub" for staff looking at the test website while signed in to the
// Hub (Jordan, 2026-09-24: "when you are logged in as an admin on the website can we have a small
// popup that takes you back to the main hub"). Only rendered for admins — the layout decides.
// The × hides it for the rest of the browser tab's life; a fresh tab shows it again.
export default function HubReturn() {
  const [hidden, setHidden] = useState(true)
  useEffect(() => {
    try { setHidden(sessionStorage.getItem("hub-return-hidden") === "1") } catch { setHidden(false) }
  }, [])
  if (hidden) return null
  return (
    <div className="fixed bottom-4 left-4 z-[60] flex items-center gap-1 rounded-full bg-[#1C1C1E] text-white shadow-lg border border-white/10 pl-4 pr-1 py-1">
      <Link href="/hub" className="text-xs font-bold tracking-wide hover:text-[#2AB4A6] transition-colors py-1.5">
        ← Back to the Hub
      </Link>
      <button
        type="button"
        onClick={() => { try { sessionStorage.setItem("hub-return-hidden", "1") } catch {} setHidden(true) }}
        aria-label="Hide for now"
        title="Hide for now"
        className="w-8 h-8 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
      >
        ×
      </button>
    </div>
  )
}
