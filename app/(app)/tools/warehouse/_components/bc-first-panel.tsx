"use client"

import { useState } from "react"
import { pullRecentCustomersFromBc } from "@/lib/actions/customers-pull"
import { btn, btnGo, ErrorBox, OkBox } from "./ui"

// "Not on the system?" — until switch day a customer is made in Business Central first, then fetched
// here. This panel says so in three steps and has the Fetch button. Shown by the check-in's customer
// picker, the Customers list and the old New customer page.

export default function BcFirstPanel({ onFetched, onClose, compact }: { onFetched?: () => void; onClose?: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchNow() {
    setBusy(true); setError(null); setResult(null); setWarn(null)
    const r = await pullRecentCustomersFromBc()
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    const bits = [r.created && `${r.created} new ${r.created === 1 ? "person" : "people"}`, r.updated && `${r.updated} updated`].filter(Boolean)
    setResult(bits.length ? `Fetched ${bits.join(" and ")} from BC.` : "Nothing new in BC since the last copy.")
    if (r.stoppedEarly) setWarn(r.stoppedEarly)
    if (r.created || r.updated) onFetched?.()
  }

  return (
    <section aria-label="Adding a customer" className={`rounded-xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 ${compact ? "p-4" : "p-5"} space-y-3`}>
      <h3 className="text-base font-bold text-gray-900 dark:text-white">Not on the system yet?</h3>
      <p className="text-sm text-gray-700 dark:text-gray-200">
        Customers are kept in <b>Business Central</b> until the Hub takes over, so a new person is added there first.
      </p>
      <ol className="list-decimal pl-5 text-sm text-gray-700 dark:text-gray-200 space-y-1">
        <li>Add them as a contact in BC the usual way (they get their C-number there).</li>
        <li>Press <b>Fetch new customers from BC</b> below — it takes a few seconds.</li>
        <li>Search for them again.</li>
      </ol>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className={`${btnGo} !min-h-12`} onClick={fetchNow} disabled={busy} aria-busy={busy}>
          {busy ? "Fetching from BC…" : "Fetch new customers from BC"}
        </button>
        {onClose && <button type="button" className={btn} onClick={onClose}>Back to search</button>}
      </div>
      {result && <OkBox>{result}</OkBox>}
      {warn && <p className="text-sm text-amber-800 dark:text-amber-200">{warn}</p>}
      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
      <p className="text-xs text-gray-500 dark:text-gray-400">Someone already in BC but not found here? The nightly copy may not have run yet — Fetch brings in anyone added or changed in BC in the last three days.</p>
    </section>
  )
}
