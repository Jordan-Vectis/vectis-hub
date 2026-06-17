"use client"

import { useState, useTransition } from "react"
import { setNeedsFollowUp } from "@/lib/actions/submissions"

export default function FollowUpToggle({
  submissionId,
  initial,
}: {
  submissionId: string
  initial: boolean
}) {
  const [checked, setChecked] = useState(initial)
  const [isPending, startTransition] = useTransition()

  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        disabled={isPending}
        onChange={(e) => {
          const v = e.target.checked
          setChecked(v)
          startTransition(async () => {
            await setNeedsFollowUp(submissionId, v)
          })
        }}
        className="w-5 h-5 rounded accent-orange-500 cursor-pointer"
      />
      <span className="text-base font-semibold text-gray-800 dark:text-gray-200">
        Needs follow-up
      </span>
    </label>
  )
}
