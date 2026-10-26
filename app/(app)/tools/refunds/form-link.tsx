"use client"

import { useState } from "react"
import { btn, card, cardTitle } from "./ui"

// The public refund form's full address, to copy into the website's "request a refund" link — the
// Hub's own form replaces the Microsoft Form (Jack, 2026-10-26: "the form link will need to come out
// of the hub instead of using the Microsoft form"). The address is this Hub's own (the request's host),
// so staging shows staging's and the live Hub the live one.

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
      <h2 id="form-link-title" className={cardTitle}>The public refund form</h2>
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
          : <>Anyone can open it without logging in. The website&apos;s <b>&ldquo;request a refund&rdquo;</b> link should point here instead of the Microsoft Form — each request it sends arrives on this list as <b>New</b>.</>}
      </p>
    </section>
  )
}
