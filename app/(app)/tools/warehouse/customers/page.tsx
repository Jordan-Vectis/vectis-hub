"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

export default function CustomersPage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<any[]>([])
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<any>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ salutation: "", name: "", email: "", phone: "", addressLine1: "", addressLine2: "", postcode: "", notes: "" })
  const [editForm, setEditForm] = useState<any>(null)
  const [receipts, setReceipts] = useState<any[]>([])
  const [auctions, setAuctions] = useState<any[]>([])
  const [selectedAuctionId, setSelectedAuctionId] = useState("")
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState("")

  async function load(q = "") {
    const res = await fetch(`/api/warehouse/customers?search=${encodeURIComponent(q)}`)
    setCustomers(await res.json())
  }

  useEffect(() => { load() }, [])

  async function selectCustomer(c: any) {
    setSelected(c)
    setEditForm({ salutation: c.salutation || "", name: c.name, email: c.email || "", phone: c.phone || "", addressLine1: c.addressLine1 || "", addressLine2: c.addressLine2 || "", postcode: c.postcode || "", notes: c.notes || "" })
    setSelectedAuctionId("")
    const [receiptsRes, auctionsRes] = await Promise.all([
      fetch(`/api/warehouse/receipts?customer_id=${c.id}`),
      fetch(`/api/warehouse/customers/${c.id}/auctions`),
    ])
    setReceipts(await receiptsRes.json())
    setAuctions(await auctionsRes.json())
  }

  async function doCreate() {
    if (!form.name.trim()) { setMsg("Name required"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/warehouse/customers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      })
      if (res.ok) {
        setShowCreate(false)
        setForm({ salutation: "", name: "", email: "", phone: "", addressLine1: "", addressLine2: "", postcode: "", notes: "" })
        setMsg("")
        load()
      } else { setMsg("Error creating customer") }
    } finally { setLoading(false) }
  }

  async function doSave() {
    setLoading(true)
    try {
      const res = await fetch(`/api/warehouse/customers/${selected.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm),
      })
      if (res.ok) {
        const data = await res.json()
        setSelected(data)
        setMsg("Saved")
        setTimeout(() => setMsg(""), 2000)
        load(search)
      }
    } finally { setLoading(false) }
  }

  function openDoc(url: string) {
    window.open(url, "_blank")
  }

  const fmtDate = (d: string | null) => d
    ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : ""

  return (
    <div className="p-6 space-y-4" style={{ fontFamily: "Arial, sans-serif" }}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Customers</h1>
        <button className="wh-btn-primary" onClick={() => setShowCreate(true)}>+ New Customer</button>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      <div className="flex gap-2">
        <input className="wh-input flex-1" placeholder="Search name, phone, email, postcode, address…" value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") load(search) }} />
        <button className="wh-btn-primary" onClick={() => load(search)}>Search</button>
        <button className="wh-btn-secondary" onClick={() => { setSearch(""); load("") }}>Clear</button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="wh-card w-full max-w-md space-y-4">
            <h2 className="font-semibold text-lg">New Customer</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="wh-label">Salutation</label>
                <select className="wh-input" value={form.salutation} onChange={e => setForm({...form, salutation: e.target.value})}>
                  <option value="">—</option>
                  <option>Mr</option><option>Mrs</option><option>Ms</option><option>Miss</option><option>Dr</option><option>Prof</option>
                </select>
              </div>
              <div><label className="wh-label">Name *</label><input className="wh-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
              <div><label className="wh-label">Phone</label><input className="wh-input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
              <div><label className="wh-label">Email</label><input className="wh-input" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              <div className="col-span-2"><label className="wh-label">Address Line 1</label><input className="wh-input" value={form.addressLine1} onChange={e => setForm({...form, addressLine1: e.target.value})} /></div>
              <div className="col-span-2"><label className="wh-label">Address Line 2</label><input className="wh-input" value={form.addressLine2} onChange={e => setForm({...form, addressLine2: e.target.value})} /></div>
              <div><label className="wh-label">Postcode</label><input className="wh-input" value={form.postcode} onChange={e => setForm({...form, postcode: e.target.value})} /></div>
              <div className="col-span-2"><label className="wh-label">Notes</label><textarea className="wh-input" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
            </div>
            <div className="flex gap-2">
              <button className="wh-btn-secondary flex-1" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="wh-btn-primary flex-1" onClick={doCreate} disabled={loading}>Create</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        <div className="wh-card p-0 overflow-hidden flex-1">
          <table className="w-full">
            <thead><tr>
              <th className="wh-table-header">ID</th>
              <th className="wh-table-header">Name</th>
              <th className="wh-table-header">Phone</th>
              <th className="wh-table-header">Email</th>
              <th className="wh-table-header">Postcode</th>
              <th className="wh-table-header">Address</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {customers.map(c => (
                <tr key={c.id} onClick={() => selectCustomer(c)}
                  className="cursor-pointer hover:bg-gray-50"
                  style={selected?.id === c.id ? { background: "#eff6ff" } : {}}>
                  <td className="wh-table-cell font-mono text-xs">{c.id}</td>
                  <td className="wh-table-cell font-medium">{c.name}</td>
                  <td className="wh-table-cell text-gray-500">{c.phone}</td>
                  <td className="wh-table-cell text-gray-500">{c.email}</td>
                  <td className="wh-table-cell text-gray-500">{c.postcode}</td>
                  <td className="wh-table-cell text-gray-500">{c.addressLine1}</td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={6} className="wh-table-cell text-center text-gray-400 py-8">No customers found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && editForm && (
          <div style={{ width: "22rem" }} className="space-y-4 flex-shrink-0">
            {/* Details */}
            <div className="wh-card space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-900 dark:text-white">{selected.name}</p>
                <span className="wh-badge wh-badge-blue font-mono">{selected.id}</span>
              </div>
              <div className="space-y-2">
                <div><label className="wh-label">Salutation</label>
                  <select className="wh-input" value={editForm.salutation} onChange={e => setEditForm({...editForm, salutation: e.target.value})}>
                    <option value="">—</option>
                    <option>Mr</option><option>Mrs</option><option>Ms</option><option>Miss</option><option>Dr</option><option>Prof</option>
                  </select>
                </div>
                <div><label className="wh-label">Name</label><input className="wh-input" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} /></div>
                <div><label className="wh-label">Phone</label><input className="wh-input" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} /></div>
                <div><label className="wh-label">Email</label><input className="wh-input" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} /></div>
                <div><label className="wh-label">Address Line 1</label><input className="wh-input" value={editForm.addressLine1} onChange={e => setEditForm({...editForm, addressLine1: e.target.value})} /></div>
                <div><label className="wh-label">Address Line 2</label><input className="wh-input" value={editForm.addressLine2} onChange={e => setEditForm({...editForm, addressLine2: e.target.value})} /></div>
                <div><label className="wh-label">Postcode</label><input className="wh-input" value={editForm.postcode} onChange={e => setEditForm({...editForm, postcode: e.target.value})} /></div>
                <div><label className="wh-label">Notes</label><textarea className="wh-input" rows={2} value={editForm.notes} onChange={e => setEditForm({...editForm, notes: e.target.value})} /></div>
              </div>
              <button className="wh-btn-primary w-full justify-center" onClick={doSave} disabled={loading}>Save Changes</button>
            </div>

            {/* Receipts */}
            {receipts.length > 0 && (
              <div className="wh-card p-0 overflow-hidden">
                <p className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-50 dark:bg-[#141416]">Receipts ({receipts.length})</p>
                <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                  {receipts.map((r: any) => (
                    <div key={r.id} className="px-4 py-2 flex items-center justify-between">
                      <span className="font-mono text-sm">{r.id}</span>
                      <div className="flex items-center gap-2">
                        <span className={`wh-badge ${r.status === "open" ? "wh-badge-green" : "wh-badge-gray"}`}>{r.status}</span>
                        <button className="wh-btn-secondary wh-btn-sm" onClick={() => router.push(`/tools/warehouse/receipts?id=${r.id}`)}>View</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Documents */}
            <div className="wh-card space-y-3">
              <p className="font-semibold text-gray-700 dark:text-gray-300 text-sm">📄 Documents</p>

              {/* Receipt documents — one per receipt */}
              {receipts.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Receipts</p>
                  <div className="space-y-1">
                    {receipts.map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between py-1 px-2 rounded bg-gray-50 dark:bg-[#141416]">
                        <span className="font-mono text-xs text-gray-600">{r.id}</span>
                        <button
                          className="wh-btn-secondary wh-btn-sm"
                          onClick={() => openDoc(`/api/warehouse/documents/receipt?receiptId=${r.id}`)}
                        >
                          Print Receipt
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auction documents */}
              {auctions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Auction Documents</p>
                  <div className="mb-2">
                    <select
                      className="wh-input text-sm"
                      value={selectedAuctionId}
                      onChange={e => setSelectedAuctionId(e.target.value)}
                    >
                      <option value="">Select auction…</option>
                      {auctions.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}{a.auctionDate ? ` (${fmtDate(a.auctionDate)})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedAuctionId && (
                    <div className="grid grid-cols-1 gap-1">
                      <button
                        className="wh-btn-secondary text-sm justify-start"
                        onClick={() => openDoc(`/api/warehouse/documents/pre-sale?customerId=${selected.id}&auctionId=${selectedAuctionId}`)}
                      >
                        📋 Pre-Sale Advice
                      </button>
                      <button
                        className="wh-btn-secondary text-sm justify-start"
                        onClick={() => openDoc(`/api/warehouse/documents/post-sale?customerId=${selected.id}&auctionId=${selectedAuctionId}`)}
                      >
                        📋 Post-Sale Advice
                      </button>
                      <button
                        className="wh-btn-secondary text-sm justify-start"
                        onClick={() => openDoc(`/api/warehouse/documents/vendor-statement?customerId=${selected.id}&auctionId=${selectedAuctionId}`)}
                      >
                        💰 Vendor Statement
                      </button>
                    </div>
                  )}
                </div>
              )}

              {receipts.length === 0 && auctions.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">No receipts or auction history yet</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
