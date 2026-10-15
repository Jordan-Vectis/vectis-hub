"use client"

import { useEffect, useRef, useState } from "react"
import { searchCustomers, type CustomerRow } from "@/lib/actions/goods-in"
import CustomerForm from "./customer-form"
import { btn, ErrorBox, input } from "./ui"

// Find the customer at the counter — by name, postcode, email, phone or vendor number (a scanned
// vendor-number card matches exactly) — or add them. Search runs as you type, after a short pause.
// Enter (which a scanner sends after the code) picks the customer straight away when there's only
// one it can mean: the exact vendor number, or the only match.

/** The one customer Enter means, or null when it's for the clerk to choose. */
function onlyChoice(term: string, list: CustomerRow[]): CustomerRow | null {
  const code = term.replace(/\s+/g, "").toUpperCase()
  const exact = list.filter(r => r.vendorNo && r.vendorNo.toUpperCase() === code)
  if (exact.length === 1) return exact[0]
  return list.length === 1 ? list[0] : null
}

export default function CustomerPicker({ onPick }: { onPick: (c: CustomerRow) => void }) {
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<CustomerRow[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const term = q.trim()
    // Too short to search: anything still on its way back is for text that has since been cleared.
    if (term.length < 2) { seq.current++; setSearching(false); setRows([]); setSearched(""); return }
    const mine = ++seq.current
    const t = setTimeout(async () => {
      if (mine !== seq.current) return // Enter has already searched for it
      setSearching(true)
      const res = await searchCustomers(term)
      if (mine !== seq.current) return // a newer search has started
      setSearching(false)
      if (!res.ok) { setError(res.error); return }
      setError(null)
      setRows(res.data)
      setSearched(term)
    }, 250)
    timer.current = t
    return () => clearTimeout(t)
  }, [q])

  // Enter: a scan arrives faster than the search-as-you-type pause, so search now rather than wait.
  const enter = async () => {
    const term = q.trim()
    if (term.length < 2) return
    if (searched === term && !searching) {
      const c = onlyChoice(term, rows)
      if (c) onPick(c)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    const mine = ++seq.current
    setSearching(true)
    try {
      const res = await searchCustomers(term)
      if (mine !== seq.current) return
      if (!res.ok) { setError(res.error); return }
      setError(null)
      setRows(res.data)
      setSearched(term)
      const c = onlyChoice(term, res.data)
      if (c) onPick(c)
    } catch {
      if (mine === seq.current) setError("The Hub didn't answer — check the connection and press Enter again.")
    } finally {
      if (mine === seq.current) setSearching(false)
    }
  }

  if (adding) {
    return <CustomerForm compact initial={null} onSaved={c => { setAdding(false); onPick(c) }} onCancel={() => setAdding(false)} />
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          autoFocus
          className={`${input} !min-h-14 !text-lg`}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return
            e.preventDefault()
            void enter()
          }}
          enterKeyHint="search"
          placeholder="Name, postcode, email, phone or vendor number"
          aria-label="Find a customer"
        />
        <button type="button" className={`${btn} !min-h-14 whitespace-nowrap`} onClick={() => setAdding(true)}>+ New customer</button>
      </div>
      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
      {searching && <p className="text-sm text-gray-500 dark:text-gray-400">Searching…</p>}
      {!searching && searched && rows.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-300">No customer matches &ldquo;{searched}&rdquo;. Check the spelling, try their postcode, or add them as a new customer.</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          {rows.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)} className="w-full text-left px-4 py-3 min-h-14 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-semibold text-gray-900 dark:text-white">{[c.salutation, c.name].filter(Boolean).join(" ")}</span>
                {c.vendorNo && <span className="font-mono text-xs text-indigo-700 dark:text-indigo-300">{c.vendorNo}</span>}
                <span className="text-sm text-gray-500 dark:text-gray-400">{[c.addressLine1, c.town, c.postcode].filter(Boolean).join(", ")}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">{c.email ?? c.mobile ?? c.phone ?? ""}</span>
                <span className="ml-auto text-xs text-gray-400">{c.receipts} {c.receipts === 1 ? "receipt" : "receipts"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
