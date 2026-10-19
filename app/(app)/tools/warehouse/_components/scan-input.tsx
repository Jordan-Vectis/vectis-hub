"use client"

import { forwardRef, useState } from "react"
import { input } from "./ui"

// The scan box used everywhere in Goods In. A USB or Bluetooth barcode scanner "types" the code and
// presses Enter, so Enter submits; the box clears itself and keeps the cursor ready for the next
// scan. Typing works the same way. Codes are sent as typed — the server normalises them
// (upper case, spaces removed). Big enough to hit standing at a counter iPad.

type Props = {
  placeholder: string
  onScan: (code: string) => void | Promise<void>
  disabled?: boolean
  autoFocus?: boolean
  /** Keep what was typed after Enter (for search boxes) rather than clearing it (for scanning). */
  keep?: boolean
  label?: string
  id?: string
}

const ScanInput = forwardRef<HTMLInputElement, Props>(function ScanInput({ placeholder, onScan, disabled, autoFocus, keep, label, id }, ref) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const code = value.trim()
    if (!code || busy) return
    setBusy(true)
    try { await onScan(code) } finally {
      setBusy(false)
      if (!keep) setValue("")
    }
  }
  return (
    <div>
      {label && <label htmlFor={id} className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">{label}</label>}
      <div className="flex gap-2">
        <input
          ref={ref}
          id={id}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void submit() } }}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          className={`${input} !min-h-14 !text-lg font-mono tracking-wide`}
        />
        <button type="button" onClick={() => void submit()} disabled={disabled || busy || !value.trim()} className="min-h-14 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40">
          {busy ? "…" : "Go"}
        </button>
      </div>
    </div>
  )
})

export default ScanInput
