"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"

const STEPS = ["Customer", "Receipt", "Containers", "Locate"]

function StepHeader({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            i < step ? "bg-green-500 text-white" : i === step ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-500"
          }`}>{i < step ? "✓" : i + 1}</div>
          <span className={`text-sm font-medium ${i === step ? "text-blue-700" : "text-gray-400"}`}>{s}</span>
          {i < STEPS.length - 1 && <div className="w-8 h-0.5 bg-gray-200 dark:bg-gray-700 mx-1" />}
        </div>
      ))}
    </div>
  )
}

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

    if (e.key === "Enter") {
      if (value.trim()) {
        onScan(value.trim())
        buffer.current = ""
      }
      e.preventDefault()
      return
    }

    if (delta < 30 && e.key.length === 1) {
      buffer.current += e.key
    } else {
      buffer.current = e.key.length === 1 ? e.key : ""
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onKeyDown={handleKeyDown}
      className={`wh-input font-mono ${className}`}
    />
  )
}

// Step 1 — Customer
function CustomerStep({ onNext }: { onNext: (c: any) => void }) {
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ salutation: "", name: "", email: "", phone: "", addressLine1: "", addressLine2: "", postcode: "", notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function doSearch() {
    if (!search.trim()) return
    const res = await fetch(`/api/warehouse/customers?search=${encodeURIComponent(search)}`)
    const data = await res.json()
    setResults(data)
    if (data.length === 0) setShowCreate(true)
  }

  async function doCreate() {
    if (!form.name.trim()) { setError("Name is required"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/warehouse/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Error"); return }
      onNext(data)
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Step 1 — Find or Create Customer</h2>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="flex gap-2">
        <input className="wh-input flex-1" placeholder="Search by name, phone, email, postcode, or ID…" value={search}
          onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} />
        <button className="wh-btn-primary" onClick={doSearch}>Search</button>
        <button className="wh-btn-secondary" onClick={() => setShowCreate(true)}>+ New</button>
      </div>
      {results.length > 0 && (
        <div className="wh-card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr>
              <th className="wh-table-header">ID</th>
              <th className="wh-table-header">Name</th>
              <th className="wh-table-header">Phone</th>
              <th className="wh-table-header">Email</th>
              <th className="wh-table-header"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {results.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="wh-table-cell font-mono text-xs">{c.id}</td>
                  <td className="wh-table-cell font-medium">{c.name}</td>
                  <td className="wh-table-cell">{c.phone}</td>
                  <td className="wh-table-cell">{c.email}</td>
                  <td className="wh-table-cell"><button className="wh-btn-primary wh-btn-sm" onClick={() => onNext(c)}>Select</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showCreate && (
        <div className="wh-card space-y-3">
          <p className="font-semibold text-gray-800 dark:text-gray-100">New Customer</p>
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
          <button className="wh-btn-primary" onClick={doCreate} disabled={loading}>Create Customer</button>
        </div>
      )}
    </div>
  )
}

// Step 2 — Receipt
function ReceiptStep({ customer, onNext, onBack }: { customer: any; onNext: (r: any) => void; onBack: () => void }) {
  const [form, setForm] = useState({ commission_rate: "", notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function doCreate() {
    setLoading(true)
    try {
      const res = await fetch("/api/warehouse/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customer.id, commission_rate: form.commission_rate, notes: form.notes }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Error"); setLoading(false); return }
      onNext(data)
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Step 2 — Create Receipt</h2>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="wh-card space-y-1" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
        <p className="text-sm" style={{ color: "#1d4ed8" }}>Customer: <strong>{customer.name}</strong> <span className="font-mono text-xs">({customer.id})</span></p>
      </div>
      <div className="wh-card space-y-4">
        <div>
          <label className="wh-label">Commission Rate (%)</label>
          <input className="wh-input" type="number" step="0.1" min="0" max="100"
            value={form.commission_rate} onChange={e => setForm({...form, commission_rate: e.target.value})} placeholder="e.g. 15" />
        </div>
        <div>
          <label className="wh-label">Notes</label>
          <textarea className="wh-input" rows={3} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
        </div>
        <div className="flex gap-3">
          <button className="wh-btn-secondary" onClick={onBack}>← Back</button>
          <button className="wh-btn-primary" onClick={doCreate} disabled={loading}>Create Receipt →</button>
        </div>
      </div>
    </div>
  )
}

// Step 3 — Containers
function PrintLabel({ container, receipt, customer }: { container: any; receipt: any; customer: any }) {
  return (
    <div>
      <button onClick={() => window.print()} className="wh-btn-secondary wh-btn-sm">🖨 Print</button>
      <div id="print-label" className="hidden" style={{ padding: "1rem", border: "4px solid black", width: "20rem" }}>
        <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
          <p style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280" }}>Warehouse Management System</p>
        </div>
        <div style={{ textAlign: "center", margin: "0.75rem 0" }}>
          <p style={{ fontSize: "2.5rem", fontWeight: "bold", fontFamily: "monospace", letterSpacing: "0.1em" }}>{container?.id}</p>
          <p style={{ fontSize: "0.875rem", color: "#4b5563", textTransform: "capitalize", marginTop: "0.25rem" }}>{container?.type}</p>
        </div>
        <hr style={{ borderColor: "black", margin: "0.5rem 0" }} />
        <div style={{ fontSize: "0.875rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>Receipt:</span><span style={{ fontFamily: "monospace" }}>{receipt?.id}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>Customer:</span><span>{customer?.name}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>Cust ID:</span><span style={{ fontFamily: "monospace" }}>{customer?.id}</span></div>
        </div>
        {container?.description && (
          <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f3f4f6", fontSize: "0.875rem" }}>
            <span style={{ fontWeight: 600 }}>Desc: </span>{container.description}
          </div>
        )}
        <div style={{ textAlign: "center", marginTop: "0.75rem", fontSize: "0.75rem", color: "#9ca3af" }}>
          {new Date().toLocaleDateString()}
        </div>
      </div>
    </div>
  )
}

function ContainersStep({ receipt, customer, onNext, onBack }: { receipt: any; customer: any; onNext: (c: any[]) => void; onBack: () => void }) {
  const [rows, setRows] = useState([{ type: "tote", description: "", category: "", subcategory: "", manualId: "" }])
  const [created, setCreated] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  function addRow() { setRows([...rows, { type: "tote", description: "", category: "", subcategory: "", manualId: "" }]) }
  function removeRow(i: number) { setRows(rows.filter((_, idx) => idx !== i)) }
  function updateRow(i: number, field: string, val: string) {
    setRows(rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  async function fillNextId(i: number) {
    const type = rows[i].type
    const res = await fetch(`/api/warehouse/containers/next?type=${type}`)
    const data = await res.json()
    updateRow(i, "manualId", data.id)
  }

  async function doCreate() {
    if (rows.some(r => !r.description.trim())) { setError("All containers need a description"); return }
    setLoading(true)
    try {
      const results = []
      for (const row of rows) {
        const body: any = { type: row.type, receipt_id: receipt.id, description: row.description, category: row.category || null, subcategory: row.subcategory || null }
        if (row.manualId.trim()) body.id = row.manualId.trim()
        const res = await fetch("/api/warehouse/containers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error || "Error"); setLoading(false); return }
        results.push(data)
      }
      setCreated(results)
    } finally { setLoading(false) }
  }

  if (created.length > 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Containers Created</h2>
        <div className="wh-card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr>
              <th className="wh-table-header">ID</th>
              <th className="wh-table-header">Type</th>
              <th className="wh-table-header">Description</th>
              <th className="wh-table-header">Print</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {created.map((c: any) => (
                <tr key={c.id}>
                  <td className="wh-table-cell font-mono font-bold">{c.id}</td>
                  <td className="wh-table-cell capitalize">{c.type}</td>
                  <td className="wh-table-cell">{c.description}</td>
                  <td className="wh-table-cell"><PrintLabel container={c} receipt={receipt} customer={customer} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-3">
          <button className="wh-btn-secondary" onClick={() => { setCreated([]); setRows([{ type: "tote", description: "", category: "", subcategory: "", manualId: "" }]) }}>+ Add More</button>
          <button className="wh-btn-primary" onClick={() => onNext(created)}>Next: Locate →</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Step 3 — Add Containers</h2>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="wh-card space-y-1" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
        <p className="text-sm" style={{ color: "#1d4ed8" }}>
          Receipt: <strong className="font-mono">{receipt.id}</strong> · Customer: <strong>{customer.name}</strong> · Commission: <strong>{receipt.commission_rate}%</strong>
        </p>
      </div>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="wh-card space-y-2 p-3">
            <div className="flex gap-2 items-end">
              <div>
                <label className="wh-label">Type</label>
                <select className="wh-input" style={{ width: "7rem" }} value={row.type} onChange={e => updateRow(i, "type", e.target.value)}>
                  <option value="tote">Tote</option>
                  <option value="pallet">Pallet</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="wh-label">Description</label>
                <input className="wh-input" value={row.description} onChange={e => updateRow(i, "description", e.target.value)} placeholder="e.g. Mixed clothing, Electronics…" />
              </div>
              {rows.length > 1 && <button className="wh-btn-danger wh-btn-sm" style={{ marginBottom: "0.125rem" }} onClick={() => removeRow(i)}>✕</button>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="wh-label">Category</label>
                <input className="wh-input" value={row.category} onChange={e => updateRow(i, "category", e.target.value)} placeholder="e.g. TV_FILM" />
              </div>
              <div>
                <label className="wh-label">Subcategory</label>
                <input className="wh-input" value={row.subcategory} onChange={e => updateRow(i, "subcategory", e.target.value)} placeholder="e.g. DVD" />
              </div>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="wh-label">ID <span className="text-gray-400 font-normal">(leave blank to auto-assign)</span></label>
                <input className="wh-input font-mono" value={row.manualId} onChange={e => updateRow(i, "manualId", e.target.value)} placeholder="e.g. t000042" />
              </div>
              <button className="wh-btn-secondary wh-btn-sm" style={{ marginBottom: "0.125rem" }} onClick={() => fillNextId(i)}>Next {row.type === "pallet" ? "Pallet" : "Tote"} No.</button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button className="wh-btn-secondary" onClick={addRow}>+ Add Row</button>
        <button className="wh-btn-secondary" onClick={onBack}>← Back</button>
        <button className="wh-btn-primary" onClick={doCreate} disabled={loading}>Create Containers →</button>
      </div>
    </div>
  )
}

// Step 4 — Locate
function LocateStep({ containers, onDone }: { containers: any[]; onDone: () => void }) {
  const [locations, setLocations] = useState<Record<string, string>>({})
  const [located, setLocated] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState("")

  async function locate(containerId: string) {
    const loc = (locations[containerId] || "").trim().toUpperCase()
    if (!loc) { setError("Enter a location code"); return }
    setLoading(l => ({ ...l, [containerId]: true }))
    try {
      const res = await fetch(`/api/warehouse/locations/${loc}/place/${containerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "" }),
      })
      if (!res.ok) { setError("Error placing container"); return }
      setLocated(l => ({ ...l, [containerId]: loc }))
    } finally {
      setLoading(l => ({ ...l, [containerId]: false }))
    }
  }

  const allDone = containers.every(c => located[c.id])

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Step 4 — Locate in Warehouse</h2>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="wh-card p-0 overflow-hidden">
        <table className="w-full">
          <thead><tr>
            <th className="wh-table-header">Container</th>
            <th className="wh-table-header">Description</th>
            <th className="wh-table-header">Location</th>
            <th className="wh-table-header"></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {containers.map(c => (
              <tr key={c.id} style={located[c.id] ? { background: "#f0fdf4" } : {}}>
                <td className="wh-table-cell font-mono font-bold">{c.id}</td>
                <td className="wh-table-cell">{c.description}</td>
                <td className="wh-table-cell">
                  {located[c.id]
                    ? <span className="wh-badge wh-badge-green">{located[c.id]}</span>
                    : <input className="wh-input font-mono uppercase" style={{ width: "7rem" }} placeholder="A1A1"
                        value={locations[c.id] || ""}
                        onChange={e => setLocations(l => ({ ...l, [c.id]: e.target.value.toUpperCase() }))}
                        onKeyDown={e => e.key === "Enter" && locate(c.id)}
                      />
                  }
                </td>
                <td className="wh-table-cell">
                  {located[c.id]
                    ? <span className="text-green-600 text-sm">✓ Located</span>
                    : <button className="wh-btn-primary wh-btn-sm" onClick={() => locate(c.id)} disabled={loading[c.id]}>Locate</button>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3">
        <button className="wh-btn-secondary" onClick={onDone}>Skip &amp; Finish</button>
        {allDone && <button className="wh-btn-primary" onClick={onDone}>Finish ✓</button>}
      </div>
    </div>
  )
}

export default function InboundPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [customer, setCustomer] = useState<any>(null)
  const [receipt, setReceipt] = useState<any>(null)
  const [containers, setContainers] = useState<any[]>([])

  function done() {
    router.push("/tools/warehouse")
  }

  return (
    <div className="p-6 max-w-3xl" style={{ fontFamily: "Arial, sans-serif" }}>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">New Inbound</h1>
      <StepHeader step={step} />
      <div className="wh-card">
        {step === 0 && <CustomerStep onNext={c => { setCustomer(c); setStep(1) }} />}
        {step === 1 && <ReceiptStep customer={customer} onNext={r => { setReceipt(r); setStep(2) }} onBack={() => setStep(0)} />}
        {step === 2 && <ContainersStep receipt={receipt} customer={customer} onNext={c => { setContainers(c); setStep(3) }} onBack={() => setStep(1)} />}
        {step === 3 && <LocateStep containers={containers} onDone={done} />}
      </div>
    </div>
  )
}
