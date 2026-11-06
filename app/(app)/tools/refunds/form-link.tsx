"use client"

import { useState } from "react"
import { btn, card, cardTitle } from "./ui"

// The Microsoft Form's address, to copy or open — customers fill that in, not a Hub page (Jack,
// 2026-11-06: "i want to use my original microsoft form for safety"). What they send goes to the
// SharePoint refund log, so this card says plainly that it doesn't arrive on this list by itself.

export default function FormLink({ url }: { url: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied("yes")
    } catch {
      // No clipboard (an old browser, or not allowed): say so — the address is there to select.
      setCopied("no")
    }
    setTimeout(() => setCopied(null), 4000)
  }

  return (
    <section className={`${card} p-4 sm:p-5 mt-5`} aria-labelledby="form-link-title">
      <h2 id="form-link-title" className={cardTitle}>The refund form (Microsoft Form)</h2>
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 select-all">
          {url}
        </code>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={copy} className={btn}>{copied === "yes" ? "✓ Copied" : "📋 Copy"}</button>
          <a href={url} target="_blank" rel="noopener noreferrer" className={btn}>Open it ↗</a>
        </div>
      </div>
      <p role="status" className="text-xs mt-2 text-gray-500 dark:text-gray-400">
        {copied === "no"
          ? "Couldn't copy it here — select the address above and copy it by hand."
          : <>Customers use this form: the website links to it, and the Hub&apos;s old <b>/refund</b> address forwards to it. What they send goes to the SharePoint refund log, <b>not straight to this list</b> — import a fresh copy of the log below to bring new ones in.</>}
      </p>
    </section>
  )
}
