"use client"

import { useEffect, useState } from "react"

export default function HistoryPage() {
  const [movements, setMovements] = useState<any[]>([])
  const [filters, setFilters] = useState({ container_id: "", location: "", date_from: "", date_to: "" })
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
      const res = await fetch(`/api/warehouse/reports/movements/list?${params}`)
      setMovements(await res.json())
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function setFilter(key: string, val: string) { setFilters(f => ({ ...f, [key]: val })) }

  function buildExportUrl() {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
    return `/api/warehouse/reports/movements?${params}`
  }

  return (
    <div className="p-6 space-y-4" style={{ fontFamily: "Arial, sans-serif" }}>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Movement History</h1>

      <div className="wh-card">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="wh-label">Container ID</label>
            <input className="wh-input font-mono" placeholder="t000001…" value={filters.container_id}
              onChange={e => setFilter("container_id", e.target.value)} />
          </div>
          <div>
            <label className="wh-label">Location</label>
            <input className="wh-input font-mono uppercase" placeholder="A1A1…" value={filters.location}
              onChange={e => setFilter("location", e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="wh-label">From</label>
            <input type="date" className="wh-input" value={filters.date_from}
              onChange={e => setFilter("date_from", e.target.value)} />
          </div>
          <div>
            <label className="wh-label">To</label>
            <input type="date" className="wh-input" value={filters.date_to}
              onChange={e => setFilter("date_to", e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button className="wh-btn-primary" onClick={load} disabled={loading}>Search</button>
          <button className="wh-btn-secondary" onClick={() => { setFilters({ container_id: "", location: "", date_from: "", date_to: "" }); }}>Clear</button>
          <a href={buildExportUrl()} className="wh-btn-secondary ml-auto" download>⬇ Export Excel</a>
        </div>
      </div>

      <div className="wh-card p-0 overflow-hidden">
        <table className="w-full">
          <thead><tr>
            <th className="wh-table-header">Container</th>
            <th className="wh-table-header">Type</th>
            <th className="wh-table-header">Description</th>
            <th className="wh-table-header">Location</th>
            <th className="wh-table-header">Moved At</th>
            <th className="wh-table-header">By</th>
            <th className="wh-table-header">Notes</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {movements.map(m => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="wh-table-cell font-mono font-bold">{m.container_id}</td>
                <td className="wh-table-cell capitalize">{m.container_type || "—"}</td>
                <td className="wh-table-cell text-gray-600">{m.container_description}</td>
                <td className="wh-table-cell"><span className="wh-badge wh-badge-blue font-mono">{m.location_code || "—"}</span></td>
                <td className="wh-table-cell text-gray-500">{new Date(m.moved_at).toLocaleString()}</td>
                <td className="wh-table-cell">{m.moved_by}</td>
                <td className="wh-table-cell text-gray-400 text-xs">{m.notes}</td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr><td colSpan={7} className="wh-table-cell text-center text-gray-400 py-8">No movements found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
