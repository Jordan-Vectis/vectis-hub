"use client"

import { useState } from "react"

// Postcode → every address on it (Ideal Postcodes via /api/address-lookup). A house number or name,
// if typed, picks the match straight away; otherwise (or if it matches none/several) a list to pick from.
// Used by the customer form and Packing's New Parcel — each passes its own input/label/button classes.

export type LookupAddress = { line1: string; line2: string; town: string; county: string; postcode: string }

export default function AddressLookup({ postcode, onPostcode, onPick, inputClass, labelClass, buttonClass, idPrefix }: {
  postcode: string
  onPostcode: (v: string) => void
  onPick: (a: LookupAddress) => void
  inputClass: string
  labelClass: string
  buttonClass: string
  idPrefix: string
}) {
  const [house, setHouse] = useState("")
  const [finding, setFinding] = useState(false)
  const [found, setFound] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [choices, setChoices] = useState<LookupAddress[]>([])

  const pick = (a: LookupAddress) => {
    onPick(a)
    setChoices([])
    setFound("✓ Address filled in — check it.")
  }

  const find = async () => {
    setFinding(true)
    setFound(null)
    setChoices([])
    setError(null)
    try {
      const res = await fetch(`/api/address-lookup?postcode=${encodeURIComponent(postcode)}`)
      const j = await res.json()
      if (!res.ok) { setError(j.error ?? "The address lookup failed."); return }
      const list: LookupAddress[] = j.addresses
      const h = house.trim().toLowerCase()
      const hits = h ? list.filter(a => { const l = a.line1.toLowerCase(); return l === h || l.startsWith(h + " ") || l.startsWith(h + ",") || (h.length > 2 && l.includes(h)) }) : []
      if (hits.length === 1) pick(hits[0])
      else {
        setChoices(hits.length ? hits : list)
        setFound(h && !hits.length ? `No "${house.trim()}" at that postcode — pick from the list.` : `${(hits.length ? hits : list).length} addresses — pick one.`)
      }
    } catch {
      setError("The address lookup didn't answer — type the address in.")
    } finally {
      setFinding(false)
    }
  }

  return (
    <div className="sm:col-span-2 col-span-2 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-4 items-end rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-house`}>House number or name (optional)</label>
        <input id={`${idPrefix}-house`} className={inputClass} value={house} onChange={e => setHouse(e.target.value)} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-postcode`}>Postcode</label>
        <input id={`${idPrefix}-postcode`} className={inputClass} value={postcode} onChange={e => onPostcode(e.target.value)} autoComplete="postal-code" />
      </div>
      <button type="button" className={buttonClass} onClick={find} disabled={finding || !postcode.trim()}>
        {finding ? "Finding…" : "🔎 Find address"}
      </button>
      {error && <p className="sm:col-span-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {found && <p className="sm:col-span-3 text-sm text-gray-600 dark:text-gray-300">{found}</p>}
      {choices.length > 0 && (
        <select aria-label="Pick the address" className={`${inputClass} sm:col-span-3`} value="" onChange={e => pick(choices[Number(e.target.value)])}>
          <option value="" disabled>Pick the address…</option>
          {choices.map((a, i) => <option key={i} value={i}>{[a.line1, a.line2, a.town].filter(Boolean).join(", ")}</option>)}
        </select>
      )}
    </div>
  )
}
