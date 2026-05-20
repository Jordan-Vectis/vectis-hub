"use client"

import { useRef, useState } from "react"

function BarcodeInput({ value, onChange, onScan, placeholder = "Scan or type…", autoFocus = false, className = "" }: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onScan: (val: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  const lastKeyTime = useRef(0)
  const buffer = useRef("")
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const now = Date.now()
    const delta = now - lastKeyTime.current
    lastKeyTime.current = now
    if (e.key === "Enter") { if (value.trim()) { onScan(value.trim()); buffer.current = "" } e.preventDefault(); return }
    if (delta < 30 && e.key.length === 1) buffer.current += e.key
    else buffer.current = e.key.length === 1 ? e.key : ""
  }
  return <input type="text" value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus} onKeyDown={handleKeyDown} className={`wh-input font-mono ${className}`} />
}

export default function WarehouseLookupPage() {
  const [locationCode, setLocationCode] = useState("")
  const [contents, setContents] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function lookup(code?: string) {
    const loc = (code || locationCode).trim().toUpperCase()
    if (!loc) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/warehouse/locations/${loc}/contents`)
      if (!res.ok) { setError("Error looking up location"); return }
      const data = await res.json()
      setContents({ code: loc, items: data })
    } finally { setLoading(false) }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6" style={{ fontFamily: "Arial, sans-serif" }}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Warehouse Lookup</h1>
        <p className="text-gray-500 text-sm">Scan or type a location code to see what containers are there.</p>
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="wh-card space-y-4">
        <div>
          <label className="wh-label">Location Code</label>
          <div className="flex gap-2">
            <BarcodeInput value={locationCode} onChange={e => setLocationCode(e.target.value.toUpperCase())}
              onScan={lookup} placeholder="e.g. A1A1…" autoFocus className="flex-1 uppercase" />
            <button className="wh-btn-primary" onClick={() => lookup()} disabled={loading}>Look up</button>
          </div>
        </div>

        {contents && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-gray-800 dark:text-gray-100">
                Location <span className="font-mono text-blue-700">{contents.code}</span>
              </p>
              <span className="wh-badge wh-badge-blue">{contents.items.length} container{contents.items.length !== 1 ? "s" : ""}</span>
            </div>
            {contents.items.length === 0 ? (
              <p className="text-gray-400 text-sm py-4 text-center">This location is empty.</p>
            ) : (
              <div className="divide-y divide-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                {contents.items.map((item: any) => (
                  <div key={item.container_id} className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50">
                    <span className="font-mono font-bold text-sm w-24">{item.container_id}</span>
                    <span className={`wh-badge capitalize ${item.type === "tote" ? "wh-badge-blue" : "wh-badge-yellow"}`}>{item.type}</span>
                    <span className="text-sm text-gray-600 flex-1">{item.description}</span>
                    <span className="text-xs text-gray-400 font-mono">{item.receipt_id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
