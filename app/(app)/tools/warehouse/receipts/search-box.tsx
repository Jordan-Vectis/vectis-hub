"use client"

import { input } from "../_components/ui"

// The receipts search box. A barcode scanner types the code and presses Enter, which submits the
// form — so on focus the whole of the last search is selected, and a scan REPLACES it rather than
// being glued onto the end of it.

export default function SearchBox({ defaultValue }: { defaultValue: string }) {
  return (
    <input
      id="rq"
      name="q"
      defaultValue={defaultValue}
      autoFocus
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      enterKeyHint="search"
      onFocus={e => e.currentTarget.select()}
      placeholder="Receipt no., customer name, vendor no. or scan a label"
      className={input}
    />
  )
}
