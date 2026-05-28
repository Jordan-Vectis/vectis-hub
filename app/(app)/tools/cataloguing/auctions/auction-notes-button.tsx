"use client"

import { useState } from "react"

export default function AuctionNotesButton({ notes, auctionName }: { notes: string; auctionName: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded border border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors font-medium"
      >
        📝 Notes
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div
            className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Auction Notes</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{auctionName}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{notes}</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
