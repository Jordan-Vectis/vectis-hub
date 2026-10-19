"use client"

import Link from "next/link"
import { useEffect } from "react"

// A page that throws (a database that isn't answering, a sale whose tables aren't there yet) shows
// this instead of Next's grey box, inside the site's own header and footer. The message is kept
// plain: in production the real error is redacted anyway, so the digest is the thing to quote.
export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("site page error:", error) }, [error])
  return (
    <div className="vs-container text-center py-24 sm:py-32">
      <h1 className="vs-h2 mb-6">Something went wrong</h1>
      <p className="vs-lead max-w-[720px] mx-auto mb-8">
        That page couldn&apos;t be shown just now. Please try again in a moment — if it keeps happening, let us know
        at <a href="mailto:admin@vectis.co.uk" className="vs-text-link">admin@vectis.co.uk</a>.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="vs-btn">Try again</button>
        <Link href="/" className="vs-btn vs-btn-outline">Go to homepage</Link>
      </div>
      {error.digest && <p className="text-xs text-[var(--vs-muted)] mt-8">Reference: {error.digest}</p>}
    </div>
  )
}
