"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createAccountingMonth } from "@/lib/actions/accounting"

export default function NewMonthForm() {
  const router = useRouter()
  const [label, setLabel] = useState("")
  const [pending, start] = useTransition()

  function create() {
    const v = label.trim()
    if (!v) return
    start(async () => {
      const { id } = await createAccountingMonth(v)
      router.push(`/tools/accounts/${id}`)
    })
  }

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") create() }}
        placeholder="e.g. April 26"
        className="flex-1 px-3 py-2 rounded-xl text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
      <button
        onClick={create}
        disabled={pending || !label.trim()}
        className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50 whitespace-nowrap"
      >
        {pending ? "Creating…" : "Create month"}
      </button>
    </div>
  )
}
