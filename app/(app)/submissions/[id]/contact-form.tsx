"use client"

import { useState, useTransition } from "react"
import { logContact } from "@/lib/actions/submissions"

export default function ContactForm({ submissionId }: { submissionId: string }) {
  const [method, setMethod] = useState("phone")
  const [outcome, setOutcome] = useState("")
  const [notes, setNotes] = useState("")
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!outcome) return
    startTransition(async () => {
      await logContact(submissionId, method, notes, outcome)
      setNotes("")
      setOutcome("")
      setDone(true)
      setTimeout(() => setDone(false), 3000)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contact method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outcome</label>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select outcome...</option>
            <option value="approved">Approved — happy to proceed</option>
            <option value="declined">Declined — not happy with valuation</option>
            <option value="no_answer">No answer</option>
            <option value="follow_up">Needs follow-up</option>
            <option value="pending">Customer thinking it over</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any notes from the conversation..."
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !outcome}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "Logging..." : "Log Contact"}
        </button>
        {done && <span className="text-sm text-green-600">Logged successfully.</span>}
      </div>
    </form>
  )
}
