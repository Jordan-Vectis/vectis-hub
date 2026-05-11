"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

type Packer = {
  id:         string
  name:       string
  staffGroup: "FULL_TIME" | "AGENCY"
  active:     boolean
  sortOrder:  number
  createdAt:  string
  updatedAt:  string
}

const GROUPS: { key: "FULL_TIME" | "AGENCY"; label: string; description: string }[] = [
  { key: "FULL_TIME", label: "Full Time", description: "Permanent packing staff" },
  { key: "AGENCY",    label: "Agency",    description: "Agency / temporary packers" },
]

export default function PackersPage() {
  const [packers, setPackers] = useState<Packer[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // New packer form
  const [newName,  setNewName]  = useState("")
  const [newGroup, setNewGroup] = useState<"FULL_TIME" | "AGENCY">("FULL_TIME")
  const [adding,   setAdding]   = useState(false)

  // PDF download
  const [downloading,    setDownloading]    = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const res = await fetch("/api/packers")
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to load"); return }
      setPackers(data.packers as Packer[])
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function addPacker() {
    if (!newName.trim() || adding) return
    setAdding(true)
    try {
      const res = await fetch("/api/packers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ name: newName.trim(), staffGroup: newGroup }),
      })
      const data = await res.json()
      if (res.ok) {
        setPackers(prev => [...prev, data.packer].sort(byOrder))
        setNewName("")
      } else {
        alert(data.error ?? "Failed to add")
      }
    } finally {
      setAdding(false)
    }
  }

  async function patchPacker(id: string, patch: Partial<Packer>) {
    const res = await fetch(`/api/packers/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(patch),
    })
    if (res.ok) {
      const data = await res.json()
      setPackers(prev => prev.map(p => p.id === id ? data.packer : p))
    }
  }

  async function deletePacker(id: string, name: string) {
    if (!confirm(`Remove "${name}"? They'll no longer appear on the barcode sheet.`)) return
    const res = await fetch(`/api/packers/${id}`, { method: "DELETE" })
    if (res.ok) setPackers(prev => prev.filter(p => p.id !== id))
  }

  async function downloadBarcodeSheet(staffGroup: "FULL_TIME" | "AGENCY" | "ALL") {
    setDownloading(staffGroup)
    try {
      const url = `/api/packers/barcode-sheet?staffGroup=${staffGroup}`
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? "PDF generation failed")
        return
      }
      const blob = await res.blob()
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = `vectis-packers-${staffGroup.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(link.href)
    } catch {
      alert("Network error")
    } finally {
      setDownloading(null)
    }
  }

  const byGroup: Record<"FULL_TIME" | "AGENCY", Packer[]> = { FULL_TIME: [], AGENCY: [] }
  for (const p of packers) byGroup[p.staffGroup].push(p)

  return (
    <div className="p-6 max-w-5xl" style={{ fontFamily: "Arial, sans-serif" }}>
      <div className="mb-6">
        <Link href="/tools/packing" className="text-sm text-gray-500 hover:text-gray-700">← Packing &amp; Dispatch</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Packer Barcodes</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage the list of packing-floor staff. Print barcode sheets for the benches —
          each barcode is the packer's name in Code 128 so it scans straight into BC.
        </p>
      </div>

      {/* Add new */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Add packer</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPacker()}
            placeholder="Full name (e.g. Caitlain Ankers)"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={newGroup}
            onChange={e => setNewGroup(e.target.value as "FULL_TIME" | "AGENCY")}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="FULL_TIME">Full Time</option>
            <option value="AGENCY">Agency</option>
          </select>
          <button
            onClick={addPacker}
            disabled={adding || !newName.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
          >
            {adding ? "Adding…" : "+ Add"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm mb-4">{error}</div>
      )}

      {/* Group panels */}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && GROUPS.map(g => {
        const list = byGroup[g.key].sort(byOrder)
        const activeCount = list.filter(p => p.active).length
        return (
          <div key={g.key} className="bg-white rounded-xl border border-gray-200 mb-4">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-gray-800">{g.label}</h2>
                <p className="text-xs text-gray-500">{g.description} · {activeCount} active</p>
              </div>
              <button
                onClick={() => downloadBarcodeSheet(g.key)}
                disabled={downloading === g.key || activeCount === 0}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                title={activeCount === 0 ? "No active packers to print" : `Download PDF with ${activeCount} barcode${activeCount === 1 ? "" : "s"}`}
              >
                {downloading === g.key ? "Generating…" : `📄 Download ${g.label} sheet`}
              </button>
            </div>

            {list.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400 italic">
                No {g.label.toLowerCase()} packers yet — add one above.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {list.map(p => (
                  <li key={p.id} className={`px-4 py-2.5 flex items-center gap-3 ${p.active ? "" : "opacity-50"}`}>
                    <input
                      type="checkbox"
                      checked={p.active}
                      onChange={() => patchPacker(p.id, { active: !p.active })}
                      title="Active — included on the barcode sheet"
                      className="w-4 h-4 accent-blue-600"
                    />
                    <input
                      type="text"
                      value={p.name}
                      onChange={e => setPackers(prev => prev.map(x => x.id === p.id ? { ...x, name: e.target.value } : x))}
                      onBlur={e => { if (e.target.value.trim() && e.target.value !== p.name) patchPacker(p.id, { name: e.target.value.trim() }) }}
                      className="flex-1 bg-transparent text-sm text-gray-800 focus:outline-none focus:bg-white focus:border focus:border-blue-400 rounded px-1 py-0.5"
                    />
                    <select
                      value={p.staffGroup}
                      onChange={e => patchPacker(p.id, { staffGroup: e.target.value as any })}
                      className="text-xs rounded border border-gray-200 px-2 py-1 text-gray-600 focus:outline-none focus:border-blue-400"
                      title="Move to other group"
                    >
                      <option value="FULL_TIME">Full Time</option>
                      <option value="AGENCY">Agency</option>
                    </select>
                    <button
                      onClick={() => deletePacker(p.id, p.name)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}

      {/* All-packers sheet (both groups combined) */}
      {!loading && packers.filter(p => p.active).length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => downloadBarcodeSheet("ALL")}
            disabled={downloading === "ALL"}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {downloading === "ALL" ? "Generating…" : "📄 Download combined sheet (all packers)"}
          </button>
        </div>
      )}
    </div>
  )
}

function byOrder(a: Packer, b: Packer) {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  return a.name.localeCompare(b.name)
}
