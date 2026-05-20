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
        className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
      >
        + Add valuation
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-gray-100 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Estimated value (&pound;)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Comments</label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={2}
          className="w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save Valuation"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
