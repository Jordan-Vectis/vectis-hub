"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteSubmission } from "@/lib/actions/submissions"

export default function DeleteSubmissionButton({ id, reference }: { id: string; reference: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete submission ${reference}? This cannot be undone.`)) return
    startTransition(async () => {
      await deleteSubmission(id)
      router.refresh()
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="text-red-400 hover:text-red-600 disabled:opacity-50 text-sm"
    >
      {isPending ? "Deleting..." : "Delete"}
    </button>
  )
}
