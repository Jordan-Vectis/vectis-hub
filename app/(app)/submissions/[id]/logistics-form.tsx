"use client"

import { useState, useTransition } from "react"
import { setLogistics } from "@/lib/actions/logistics"

export default function LogisticsForm({ submissionId }: { submissionId: string }) {
  const [type, setType] = useState("SENT_IN")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      await setLogistics(submissionId, formData)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">Type</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <label className="flex items-center gap-2 text-base text-gray-800 dark:text-gray-200">
            <input
              type="radio"
              name="type"
              value="SENT_IN"
              checked={type === "SENT_IN"}
              onChange={() => setType("SENT_IN")}
              className="w-5 h-5"
            />
            Customer sending items in
          </label>
          <label className="flex items-center gap-2 text-base text-gray-800 dark:text-gray-200">
            <input
              type="radio"
              name="type"
              value="COLLECTION"
              checked={type === "COLLECTION"}
              onChange={() => setType("COLLECTION")}
              className="w-5 h-5"
            />
            We are collecting
          </label>
        </div>
      </div>

      {type === "COLLECTION" && (
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-1">Contact name</label>
              <input
                name="collectionName"
                required
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-1">Contact phone</label>
              <input
                name="collectionPhone"
                required
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-1">Collection address</label>
            <textarea
              name="collectionAddress"
              required
              rows={3}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-1">Contact email (optional)</label>
            <input
              name="collectionEmail"
              type="email"
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-1">Description of items (optional)</label>
            <textarea
              name="collectionNotes"
              rows={2}
              placeholder="Brief description of what is being collected..."
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-5 py-3 rounded-xl transition-colors disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save Logistics"}
      </button>
    </form>
  )
}
