"use client"

import { useEffect, useRef, useState } from "react"

export default function LocatePage() {
  const [containerId, setContainerId]       = useState("")
  const [container, setContainer]           = useState<any>(null)
  const [locationCode, setLocationCode]     = useState("")
  const [locationPinned, setLocationPinned] = useState(false)
  const [notes, setNotes]                   = useState("")
  const [loading, setLoading]               = useState(false)
  const [results, setResults]               = useState<{ container: string; location: string }[]>([])
  const [error, setError]                   = useState("")
  const [knownLocations, setKnownLocations] = useState<string[]>([])

  const containerRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch("/api/warehouse/locations")
      .then(r => r.ok ? r.json() : [])
      .then(data => setKnownLocations(Array.isArray(data) ? data.map((l: any) => l.code ?? l).filter(Boolean) : []))
      .catch(() => {})
  }, [])

  async function lookupContainer(id: string) {
    const val = (id || containerId).trim()
    if (!val) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/warehouse/containers/${val}`)
      if (!res.ok) { setError(`Container "${val}" not found`); setContainer(null); return }
      setContainer(await res.json())
      setContainerId(val)
    } finally { setLoading(false) }
  }

  async function doLocate() {
    const loc = locationCode.trim().toUpperCase()
    if (!loc)      { setError("Enter a location code"); return }
    if (!container){ setError("Scan a container first"); return }
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/warehouse/locations/${loc}/place/${container.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) { setError("Error placing container"); return }
      setResults(prev => [{ container: container.id, location: loc }, ...prev].slice(0, 30))
      setContainer(null)
      setContainerId("")
      setNotes("")
      if (!locationPinned) setLocationCode("")
      setTimeout(() => containerRef.current?.focus(), 50)
    } finally { setLoading(false) }
  }

  function handleContainerKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && containerId.trim()) { lookupContainer(containerId); e.preventDefault() }
  }
  function handleLocationKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && locationCode.trim() && container) { doLocate(); e.preventDefault() }
  }

  return (
    <div className="p-6 max-w-lg space-y-6" style={{ fontFamily: "Arial, sans-serif" }}>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Locate Container</h1>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="wh-card space-y-4">

        {/* ── Container ── */}
        <div>
          <label className="wh-label">Container ID (scan or type)</label>
          <div className="flex gap-2">
            <input
              ref={containerRef}
              type="text"
              value={containerId}
              onChange={e => setContainerId(e.target.value)}
              onKeyDown={handleContainerKey}
              placeholder="t000001 or p00001…"
              autoFocus
              className="wh-input font-mono flex-1"
            />
            <button className="wh-btn-primary" onClick={() => lookupContainer(containerId)} disabled={loading}>
              Look up
            </button>
          </div>
        </div>

        {/* ── Container info ── */}
        {container && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "0.5rem", padding: "1rem" }} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold" style={{ color: "#1e3a8a" }}>{container.id}</span>
              <span className="wh-badge wh-badge-blue capitalize">{container.type}</span>
            </div>
            <p className="text-sm" style={{ color: "#1e40af" }}>{container.description}</p>
            <p className="text-xs" style={{ color: "#2563eb" }}>Receipt: {container.receipt_id}</p>
            {container.current_location
              ? <p className="text-xs" style={{ color: "#2563eb" }}>Currently at: <strong>{container.current_location}</strong></p>
              : <p className="text-xs" style={{ color: "#ca8a04" }}>Currently unlocated</p>
            }
          </div>
        )}

        {/* ── Location + pin ── */}
        <div>
          <label className="wh-label">Location Code</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={locationCode}
              onChange={e => setLocationCode(e.target.value.toUpperCase())}
              onKeyDown={handleLocationKey}
              placeholder="e.g. A1A1, B32C4…"
              list="loc-list"
              className="wh-input font-mono flex-1 uppercase"
            />
            <datalist id="loc-list">
              {knownLocations.map(l => <option key={l} value={l} />)}
            </datalist>
            <button
              onClick={() => setLocationPinned(p => !p)}
              title={locationPinned ? "Unpin — location clears after each confirm" : "Pin — location stays set for next scan"}
              style={{
                padding: "0 0.75rem",
                borderRadius: "0.375rem",
                border: "1px solid",
                borderColor: locationPinned ? "#7c3aed" : "#d1d5db",
                background:  locationPinned ? "#7c3aed" : "#f9fafb",
                color:       locationPinned ? "#fff"    : "#6b7280",
                fontSize: "1rem",
                transition: "all 0.15s",
                cursor: "pointer",
              }}
            >
              📌
            </button>
          </div>
          {locationPinned && locationCode && (
            <p className="text-xs mt-1.5" style={{ color: "#7c3aed", fontWeight: 500 }}>
              📌 Pinned to {locationCode} — scans multiple containers here
            </p>
          )}
        </div>

        {/* ── Notes ── */}
        <div>
          <label className="wh-label">Notes (optional)</label>
          <input className="wh-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes…" />
        </div>

        <button
          className="wh-btn-primary w-full justify-center"
          onClick={doLocate}
          disabled={loading || !container || !locationCode.trim()}
        >
          {loading ? "Locating…" : "Confirm Location"}
        </button>
      </div>

      {/* ── Session log ── */}
      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            This session — {results.length} placed
          </p>
          {results.map((r, i) => (
            <div key={i} style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "0.5rem", padding: "0.625rem 1rem" }}>
              <p style={{ color: "#166534", fontWeight: 500 }}>
                ✓ <span className="font-mono">{r.container}</span>{" "}
                → <span className="font-mono font-bold">{r.location}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
