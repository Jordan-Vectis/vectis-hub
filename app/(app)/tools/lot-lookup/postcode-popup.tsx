"use client"

// Admin Centre → 📮 Postcode lookup (Jordan, 2026-10-29): a small button top right that opens a popup —
// find the address from a postcode, then copy each line on its own (or all of it) to paste into BC.

import { useState } from "react"
import AddressLookup, { type LookupAddress } from "@/components/address-lookup"
import { INPUT, BTN_PRIMARY } from "./ui"

export default function PostcodePopup() {
  const [open, setOpen] = useState(false)
  const [postcode, setPostcode] = useState("")
  const [picked, setPicked] = useState<LookupAddress | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key) } catch { setCopied(null) }
  }

  const lines = picked ? ([
    ["Address line 1", picked.line1], ["Address line 2", picked.line2], ["Town / city", picked.town],
    ["County", picked.county], ["Postcode", picked.postcode],
  ] as const).filter(([, v]) => v) : []

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-[44px] px-4 rounded-xl border border-gray-300 dark:border-gray-700 text-base font-medium text-gray-700 dark:text-gray-200 hover:border-indigo-500 hover:text-indigo-500">
        📮 Postcode lookup
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">📮 Postcode lookup</h2>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="min-h-[44px] min-w-[44px] text-3xl leading-none text-gray-400 hover:text-gray-200">×</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <AddressLookup idPrefix="pl" inputClass={INPUT} labelClass="block text-sm text-gray-500 dark:text-gray-400 mb-1" buttonClass={BTN_PRIMARY}
                postcode={postcode} onPostcode={v => setPostcode(v.toUpperCase())}
                onPick={a => { setPicked(a); setCopied(null) }} />
            </div>
            {lines.length > 0 && (
              <div className="space-y-2">
                {lines.map(([name, value]) => (
                  <div key={name} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500 dark:text-gray-400">{name}</p>
                      <p className="text-lg text-gray-900 dark:text-white truncate">{value}</p>
                    </div>
                    <button type="button" onClick={() => copy(name, value)}
                      className="min-h-[44px] px-4 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-indigo-600 hover:text-white">
                      {copied === name ? "✓ Copied" : "📋 Copy"}
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => copy("all", lines.map(([, v]) => v).join("\n"))}
                  className="w-full min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-indigo-500">
                  {copied === "all" ? "✓ Copied the whole address" : "📋 Copy the whole address"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
