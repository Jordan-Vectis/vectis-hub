"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import ScanInput from "../_components/scan-input"
import { useScanFocus } from "../_components/use-scan-focus"

// The one box on the Find screen. Scan or type anything — the page works out what it is on the
// server. The box clears after each scan (a scanner typing onto the last code would glue the two
// together) and keeps the cursor, so the next scan can follow straight away.

export default function FindBox({ current }: { current: string | null }) {
  const router = useRouter()
  const ref = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [looking, setLooking] = useState<string | null>(null)
  // After a tap on a link or button, the next scan still lands in the box (not on that button).
  useScanFocus(ref)

  // When the result for a scan has arrived, put the cursor back for the next one.
  useEffect(() => {
    if (!pending) ref.current?.focus()
  }, [pending, current])

  return (
    <div className="space-y-2">
      <ScanInput
        ref={ref}
        id="find-box"
        label="Scan or type a code"
        placeholder="Tote, pallet, lot barcode, receipt, location or vendor no."
        autoFocus
        onScan={code => {
          setLooking(code.trim())
          start(() => router.push(`/tools/warehouse/find?q=${encodeURIComponent(code.trim())}`))
        }}
      />
      <p className="min-h-5 text-xs font-medium text-gray-500 dark:text-gray-400" aria-live="polite">
        {pending && looking ? `Looking up ${looking.toUpperCase()}…` : ""}
      </p>
    </div>
  )
}
