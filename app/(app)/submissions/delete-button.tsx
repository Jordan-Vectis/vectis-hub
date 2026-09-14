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
      // ⚠ Always say when it didn't work — this button used to do nothing at all when the delete was
      // refused (2026-09-14).
      try {
        const res = await deleteSubmission(id)
        if (!res.ok) {
          alert(`Couldn't delete ${reference}: ${res.error}`)
          return
        }
      } catch {
        alert(`Couldn't delete ${reference} — refresh the page and try again.`)
        return
      }
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
