"use client"

import { useState } from "react"
import TermsGate from "@/components/terms-gate"

// Admin → Terms & Signatures: opens the real acceptance popup in read-only
// preview mode so an admin can see exactly what staff are shown. Nothing is saved.
export default function TermsPreviewButton({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold border border-emerald-500 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600 hover:text-white transition-colors"
      >
        👁 Preview the popup
      </button>
      {open && <TermsGate preview userName={userName} onClose={() => setOpen(false)} />}
    </>
  )
}
