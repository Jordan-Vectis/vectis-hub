"use client"

import { useState, useTransition } from "react"
import { saveValuation } from "@/lib/actions/valuations"

interface Props {
  item: { id: string; name: string }
  submissionId: string
}

export default function ValuationSection({ item, submissionId }: Props) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [comments, setComments] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = parseFloat(value)
    if (isNaN(num)) return
    startTransition(async () => {
      await saveValuation(item.id, submissionId, num, comments)
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-base text-blue-600 hover:text-blue-800 font-semibold"
      >
        + Add valuation
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Estimated value (&pound;)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Comments</label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={2}
          className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="text-base bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 font-semibold"
        >
          {isPending ? "Saving..." : "Save Valuation"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-base text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-4 py-2.5"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
