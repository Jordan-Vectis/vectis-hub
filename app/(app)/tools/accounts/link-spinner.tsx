"use client"

import { useLinkStatus } from "next/link"

// Instant on-tap feedback for <Link> navigations to slow/dynamic pages (the
// Reconcile page signs R2 URLs + loads statements, so there's a real delay on a
// tablet). Must be rendered as a descendant of a <Link>. Reserves a fixed-size
// box (no layout shift) and shows a spinner only while the navigation is pending.
export default function LinkSpinner({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus()
  return (
    <span className={`inline-block w-4 h-4 shrink-0 ${className}`} aria-hidden>
      {pending && <span className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
    </span>
  )
}
