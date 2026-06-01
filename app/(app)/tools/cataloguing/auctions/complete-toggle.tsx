"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toggleAuctionComplete } from "@/lib/actions/catalogue"

export default function CompleteToggle({ id, complete }: { id: string; complete: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [optimistic, setOptimistic] = useState(complete)

  function onToggle() {
    const next = !optimistic
    setOptimistic(next)
    start(async () => {
      try {
        await toggleAuctionComplete(id, next)
        router.refresh()
      } catch {
        setOptimistic(!next) // revert on failure
      }
    })
  }

  return (
    <button
      onClick={onToggle}
      disabled={pending}
      title={optimistic ? "Mark as not complete" : "Mark complete — moves to Completed"}
      className="transition-opacity hover:opacity-60 disabled:opacity-40"
    >
      {optimistic
        ? <span className="text-green-400 font-bold">✓</span>
        : <span className="text-gray-600">—</span>}
    </button>
  )
}
