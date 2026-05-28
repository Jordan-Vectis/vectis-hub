"use client"

import { useState, useRef, useEffect } from "react"

export default function AuctionNotesButton({ notes }: { notes: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs px-2 py-1 rounded border border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors font-medium"
      >
        📝 Notes
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 right-0 w-72 bg-white dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-600 rounded-xl shadow-xl p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Auction Notes</p>
          <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{notes}</p>
        </div>
      )}
    </div>
  )
}
