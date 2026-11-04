"use client"

import { useEffect, useState, useTransition } from "react"
import { toggleAuctionFavourite } from "@/lib/actions/catalogue"

/** The same ⭐ as the desktop Auction Manager (same table, so a star set on one shows on the other).
 *  Flips at once; the server action revalidates and the page re-sorts into Currently working on. */
export default function FavouriteStar({ auctionId, initial }: { auctionId: string; initial: boolean }) {
  const [on, setOn] = useState(initial)
  useEffect(() => { setOn(initial) }, [initial])
  const [, start] = useTransition()

  function toggle() {
    setOn(v => !v)
    start(async () => {
      const res = await toggleAuctionFavourite(auctionId)
      // Put it back if the save didn't happen — never leave a star disagreeing with what is saved.
      if (!res?.ok) setOn(v => !v)
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={on ? "Remove from Currently working on" : "Add to Currently working on"}
      className={`w-12 h-12 flex items-center justify-center text-3xl leading-none rounded-xl transition-colors ${
        on ? "text-amber-400" : "text-gray-400 dark:text-gray-600"
      }`}
    >
      {on ? "★" : "☆"}
    </button>
  )
}
