"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toggleMonthFavourite } from "@/lib/actions/accounting"

// Star toggle to mark the month currently being worked on. Used on the Accounts
// index list (sits beside the month Link, not inside it, to avoid nested clicks).
export default function MonthStar({ id, favourite, size = "lg" }: { id: string; favourite: boolean; size?: "lg" | "sm" }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const cls = size === "lg" ? "text-2xl" : "text-lg"
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); start(async () => { await toggleMonthFavourite(id, !favourite); router.refresh() }) }}
      title={favourite ? "Currently working on this month — click to unmark" : "Mark as the month you're working on"}
      className={`${cls} leading-none ${favourite ? "text-amber-400" : "text-gray-300 dark:text-gray-600 hover:text-amber-400"} disabled:opacity-50`}
    >
      {favourite ? "★" : "☆"}
    </button>
  )
}
