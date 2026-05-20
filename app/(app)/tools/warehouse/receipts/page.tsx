"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

function PrintLabel({ container, receipt, customer }: { container: any; receipt: any; customer: any }) {
  return (
    <div>
      <button onClick={() => window.print()} className="wh-btn-secondary wh-btn-sm">🖨 Print</button>
      <div id="print-label" className="hidden" style={{ padding: "1rem", border: "4px solid black", width: "20rem" }}>
        <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
          <p style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280" }}>Warehouse</p>
        </div>
        <div style={{ textAlign: "center", margin: "0.75rem 0" }}>
          <p style={{ fontSize: "2.5rem", fontWeight: "bold", fontFamily: "monospace" }}>{container?.id}</p>
          <p style={{ fontSize: "0.875rem", color: "#4b5563", textTransform: "capitalize" }}>{container?.type}</p>
        </div>
        <hr style={{ borderColor: "black", margin: "0.5rem 0" }} />
        <div style={{ fontSize: "0.875rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>Receipt:</span><span style={{ fontFamily: "monospace" }}>{receipt?.id}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>Customer:</span><span>{customer?.name}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>Cust ID:</span><span style={{ fontFamily: "monospace" }}>{customer?.id}</span></div>
        </div>
        {container?.description && <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f3f4f6", fontSize: "0.875rem" }}><span style={{ fontWeight: 600 }}>Desc: </span>{container.description}</div>}
        <div style={{ textAlign: "center", marginTop: "0.75rem", fontSize: "0.75rem", color: "#9ca3af" }}>{new Date().toLocaleDateString()}</div>
      </div>
    </div>
  )
}

function ContainerRow({ container, receipt, customer, onUpdated }: { container: any; receipt: any; customer: any; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ type: container.type, description: container.description, category: container.category || "", subcategory: container.subcategory || "" })
  const [locationInput, setLocationInput] = useState("")
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState("")
  const [saving, setSaving] = useState(false)

  async function locate() {
    const code = locationInput.trim().toUpperCase()
    if (!code) { setLocateError("Enter a location code"); return }
    setLocating(true)
    setLocateError("")
    try {
      const res = await fetch(`/api/warehouse/locations/${code}/place/${container.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: "" }),
      })
      if (!res.ok) { setLocateError("Error setting location"); return }
      setLocationInput("")
      onUpdated()
    } finally { setLocating(false) }
  }

  async function save() {
    setSaving(true)
    try {
      await fetch(`/api/warehouse/containers/${container.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      })
      setEditing(false)
      onUpdated()
    } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <div className="px-4 py-3 space-y-2 bg-blue-50">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="wh-label">Type</label>
            <select className="wh-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="tote">Tote</option>
              <option value="pallet">Pallet</option>
            </select>
          </div>
          <div>
            <label className="wh-label">Category</label>
            <input className="wh-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. TV_FILM" />
          </div>
          <div className="col-span-2">
            <label className="wh-label">Description</label>
            <input className="wh-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="wh-label">Subcategory</label>
            <input className="wh-input" value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} placeholder="e.g. DVD" />
          </div>
        </div>
        <div className="flex gap-2">
          <button className="wh-btn-primary wh-btn-sm" onClick={save} disabled={saving}>Save</button>
          <button className="wh-btn-secondary wh-btn-sm" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold text-sm">{container.id}</span>
        <div className="flex items-center gap-1">
          <span className="wh-badge wh-badge-blue capitalize">{container.type}</span>
          {container.lot_count > 0 && (
            <span className="wh-badge wh-badge-green">{container.lot_count} lot{container.lot_count !== 1 ? "s" : ""}</span>
          )}
          <button className="wh-btn-secondary wh-btn-sm" onClick={() => setEditing(true)}>Edit</button>
          <PrintLabel container={container} receipt={receipt} customer={customer} />
        </div>
      </div>
      <p className="text-xs text-gray-700 dark:text-gray-300">{container.description}</p>
      {(container.category || container.subcategory) && (
        <p className="text-xs text-gray-500">
          {container.category}{container.subcategory ? ` / ${container.subcategory}` : ""}
        </p>
      )}
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-xs text-gray-500 shrink-0">Location:</span>
        {container.current_location
          ? <span className="wh-badge wh-badge-green">{container.current_location}</span>
          : <span className="text-xs text-gray-400">Unlocated</span>}
      </div>
      <div className="flex gap-2 items-center">
        <input className="wh-input font-mono uppercase text-sm" style={{ width: "6rem" }}
          placeholder="A1A1" value={locationInput}
          onChange={e => setLocationInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && locate()} />
        <button className="wh-btn-secondary wh-btn-sm" onClick={locate} disabled={locating}>
          {container.current_location ? "Move" : "Locate"}
        </button>
        {locateError && <span className="text-xs text-red-500">{locateError}</span>}
      </div>
    </div>
  )
}

function AddContainerForm({ receiptId, onAdded }: { receiptId: string; onAdded: () => void }) {
  const [form, setForm] = useState({ type: "tote", description: "", category: "", subcategory: "", manualId: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function fillNextId() {
    const res = await fetch(`/api/warehouse/containers/next?type=${form.type}`)
    const data = await res.json()
    setForm(f => ({ ...f, manualId: data.id }))
  }

  async function save() {
    if (!form.description.trim()) { setError("Description required"); return }
    setSaving(true)
    try {
      const body: any = { type: form.type, description: form.description, category: form.category, subcategory: form.subcategory, receipt_id: receiptId }
      if (form.manualId.trim()) body.id = form.manualId.trim()
      const res = await fetch("/api/warehouse/containers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Error adding container"); return }
      setForm({ type: "tote", description: "", category: "", subcategory: "", manualId: "" })
      setError("")
      onAdded()
    } finally { setSaving(false) }
  }

  return (
    <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 dark:bg-[#141416] space-y-2">
      <p className="text-xs font-semibold text-gray-600">Add Container</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="wh-label">Type</label>
          <select className="wh-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="tote">Tote</option>
            <option value="pallet">Pallet</option>
          </select>
        </div>
        <div>
          <label className="wh-label">Category</label>
          <input className="wh-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. TV_FILM" />
        </div>
        <div className="col-span-2">
          <label className="wh-label">Description *</label>
          <input className="wh-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Mixed clothing" />
        </div>
        <div className="col-span-2">
          <label className="wh-label">Subcategory</label>
          <input className="wh-input" value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} placeholder="e.g. DVD" />
        </div>
        <div className="col-span-2">
          <label className="wh-label">ID <span className="text-gray-400 font-normal">(leave blank to auto-assign)</span></label>
          <div className="flex gap-2">
            <input className="wh-input font-mono flex-1" value={form.manualId} onChange={e => setForm({ ...form, manualId: e.target.value })} placeholder="e.g. t000042" />
            <button className="wh-btn-secondary wh-btn-sm whitespace-nowrap" onClick={fillNextId}>Next {form.type === "pallet" ? "Pallet" : "Tote"} No.</button>
          </div>
        </div>
      </div>
      <button className="wh-btn-primary wh-btn-sm" onClick={save} disabled={saving}>Add</button>
    </div>
  )
}

function ReassignModal({ receiptId, currentCustomerId, onDone, onClose }: { receiptId: string; currentCustomerId: string; onDone: () => void; onClose: () => void }) {
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function doSearch() {
    if (!search.trim()) return
    const res = await fetch(`/api/warehouse/customers?search=${encodeURIComponent(search)}`)
    setResults((await res.json()).filter((c: any) => c.id !== currentCustomerId))
  }

  async function reassign(customerId: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/warehouse/receipts/${receiptId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: customerId }),
      })
      if (!res.ok) { setError("Error reassigning receipt"); return }
      onDone()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="wh-card w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Reassign Receipt</h2>
          <button className="wh-btn-secondary wh-btn-sm" onClick={onClose}>✕</button>
        </div>
        <p className="text-sm text-gray-500">Search for the customer you want to move this receipt to.</p>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <input className="wh-input flex-1" placeholder="Search by name, phone, ID…" value={search}
            onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} />
          <button className="wh-btn-primary" onClick={doSearch}>Search</button>
        </div>
        {results.length > 0 && (
          <div className="border border-gray-200 dark:border-gray-700 rounded divide-y divide-gray-100 max-h-60 overflow-y-auto">
            {results.map(c => (
              <div key={c.id} className="px-3 py-2 flex items-center justify-between hover:bg-gray-50">
                <div>
                  <p className="font-medium text-sm">{c.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{c.id} {c.phone && `· ${c.phone}`}</p>
                </div>
                <button className="wh-btn-primary wh-btn-sm" onClick={() => reassign(c.id)} disabled={saving}>Move</button>
              </div>
            ))}
          </div>
        )}
        {results.length === 0 && search && <p className="text-sm text-gray-400">No customers found.</p>}
      </div>
    </div>
  )
}

export default function ReceiptsPage() {
  const searchParams = useSearchParams()
  const [receipts, setReceipts] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [containers, setContainers] = useState<any[]>([])
  const [customer, setCustomer] = useState<any>(null)
  const [filterStatus, setFilterStatus] = useState("")
  const [loading, setLoading] = useState(false)
  const [editNotes, setEditNotes] = useState("")
  const [editRate, setEditRate] = useState("")
  const [msg, setMsg] = useState("")
  const [showAddContainer, setShowAddContainer] = useState(false)
  const [showReassign, setShowReassign] = useState(false)
  const [lots, setLots] = useState<any[]>([])

  async function load() {
    const res = await fetch(`/api/warehouse/receipts?status=${filterStatus}`)
    return await res.json()
  }

  useEffect(() => {
    const idParam = searchParams.get("id")
    load().then(data => {
      setReceipts(data)
      if (idParam) {
        const match = data.find((r: any) => r.id === idParam)
        if (match) selectReceipt(match)
      }
    })
  }, [filterStatus])

  async function selectReceipt(r: any) {
    setSelected(r)
    setEditNotes(r.notes || "")
    setEditRate(String(r.commission_rate))
    setShowAddContainer(false)
    const [contRes, custRes, lotsRes] = await Promise.all([
      fetch(`/api/warehouse/receipts/${r.id}/containers`),
      fetch(`/api/warehouse/customers/${r.customer_id}`),
      fetch(`/api/warehouse/receipts/${r.id}/lots`),
    ])
    setContainers(await contRes.json())
    setCustomer(await custRes.json())
    setLots(await lotsRes.json())
  }

  async function reloadContainers() {
    if (!selected) return
    const res = await fetch(`/api/warehouse/receipts/${selected.id}/containers`)
    setContainers(await res.json())
  }

  async function doSave() {
    setLoading(true)
    try {
      const res = await fetch(`/api/warehouse/receipts/${selected.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commission_rate: editRate, notes: editNotes }),
      })
      if (res.ok) {
        const data = await res.json()
        setSelected(data)
        setMsg("Saved")
        setTimeout(() => setMsg(""), 2000)
        load().then(setReceipts)
      }
    } finally { setLoading(false) }
  }

  async function toggleStatus() {
    const newStatus = selected.status === "open" ? "closed" : "open"
    setLoading(true)
    try {
      const res = await fetch(`/api/warehouse/receipts/${selected.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) { const data = await res.json(); setSelected(data); load().then(setReceipts) }
    } finally { setLoading(false) }
  }

  async function onReassignDone() {
    setShowReassign(false)
    const updatedReceipt = await fetch(`/api/warehouse/receipts/${selected.id}`).then(r => r.json())
    const updatedCustomer = await fetch(`/api/warehouse/customers/${updatedReceipt.customer_id}`).then(r => r.json())
    setSelected(updatedReceipt)
    setCustomer(updatedCustomer)
    load().then(setReceipts)
  }

  return (
    <div className="p-6 space-y-4" style={{ fontFamily: "Arial, sans-serif" }}>
      {showReassign && selected && (
        <ReassignModal
          receiptId={selected.id}
          currentCustomerId={selected.customer_id}
          onDone={onReassignDone}
          onClose={() => setShowReassign(false)}
        />
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Receipts</h1>
        <select className="wh-input" style={{ width: "9rem" }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      <div className="flex gap-4">
        <div className="wh-card p-0 overflow-hidden flex-1">
          <table className="w-full">
            <thead><tr>
              <th className="wh-table-header">Receipt</th>
              <th className="wh-table-header">Customer</th>
              <th className="wh-table-header">Commission</th>
              <th className="wh-table-header">Status</th>
              <th className="wh-table-header">Date</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {receipts.map(r => (
                <tr key={r.id} onClick={() => selectReceipt(r)}
                  className="cursor-pointer hover:bg-gray-50"
                  style={selected?.id === r.id ? { background: "#eff6ff" } : {}}>
                  <td className="wh-table-cell font-mono font-bold">{r.id}</td>
                  <td className="wh-table-cell">
                    <span className="font-medium">{r.customer_name}</span>
                    <span className="text-xs text-gray-400 ml-1 font-mono">({r.customer_id})</span>
                  </td>
                  <td className="wh-table-cell">{r.commission_rate}%</td>
                  <td className="wh-table-cell">
                    <span className={`wh-badge ${r.status === "open" ? "wh-badge-green" : "wh-badge-gray"}`}>{r.status}</span>
                  </td>
                  <td className="wh-table-cell text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {receipts.length === 0 && (
                <tr><td colSpan={5} className="wh-table-cell text-center text-gray-400 py-8">No receipts</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ width: "22rem" }} className="space-y-4">
            <div className="wh-card space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-lg">{selected.id}</span>
                <span className={`wh-badge ${selected.status === "open" ? "wh-badge-green" : "wh-badge-gray"}`}>{selected.status}</span>
              </div>
              {customer && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    <span className="font-mono text-xs">{customer.id}</span> — {customer.name}
                  </p>
                  <button className="wh-btn-secondary wh-btn-sm" onClick={() => setShowReassign(true)}>Reassign</button>
                </div>
              )}
              <div>
                <label className="wh-label">Commission Rate (%)</label>
                <input className="wh-input" type="number" value={editRate} onChange={e => setEditRate(e.target.value)} />
              </div>
              <div>
                <label className="wh-label">Notes</label>
                <textarea className="wh-input" rows={3} value={editNotes} onChange={e => setEditNotes(e.target.value)} />
              </div>
              {msg && <p className="text-sm text-green-600">{msg}</p>}
              <div className="flex gap-2">
                <button className="wh-btn-primary flex-1" onClick={doSave} disabled={loading}>Save</button>
                <button className="wh-btn-secondary" onClick={toggleStatus} disabled={loading}>
                  {selected.status === "open" ? "Close" : "Reopen"}
                </button>
              </div>
            </div>

            <div className="wh-card p-0 overflow-hidden">
              <div className="px-4 py-2 flex items-center justify-between bg-gray-50 dark:bg-[#141416]">
                <p className="text-sm font-semibold text-gray-600">Containers ({containers.length})</p>
                <button className="wh-btn-primary wh-btn-sm" onClick={() => setShowAddContainer(v => !v)}>
                  {showAddContainer ? "Cancel" : "+ Add"}
                </button>
              </div>
              {showAddContainer && (
                <AddContainerForm receiptId={selected.id} onAdded={() => { reloadContainers(); setShowAddContainer(false) }} />
              )}
              <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                {containers.map((c: any) => (
                  <ContainerRow key={c.id} container={c} receipt={selected} customer={customer} onUpdated={reloadContainers} />
                ))}
                {containers.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">No containers</p>}
              </div>
            </div>

            {lots.length > 0 && (
              <div className="wh-card p-0 overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 dark:bg-[#141416]">
                  <p className="text-sm font-semibold text-gray-600">Catalogue Lots ({lots.length})</p>
                </div>
                <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                  {lots.map((lot: any) => (
                    <div key={lot.id} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="font-mono text-xs text-gray-400 w-20 shrink-0">{lot.receipt}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{lot.title || <span className="text-gray-400 italic">Untitled</span>}</p>
                        <p className="text-xs text-gray-400">
                          {lot.auction?.code} · Lot {lot.lotNumber}
                          {lot.estimateLow ? ` · £${lot.estimateLow}–£${lot.estimateHigh}` : ""}
                        </p>
                      </div>
                      <span className={`wh-badge shrink-0 ${lot.status === "SOLD" ? "wh-badge-green" : "wh-badge-gray"}`}>
                        {lot.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
