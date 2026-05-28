"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"

const RM_SERVICES: Record<string, string> = {
  TPNN: "Tracked 24 — No Signature",
  TPNS: "Tracked 24 — Signature",
  TPSN: "Tracked 48 — No Signature",
  TPSS: "Tracked 48 — Signature",
  FEO:  "express48",
  FEM:  "express48 Large",
  NDA:  "express24",
  SD1:  "Special Delivery by 1pm (£750)",
  SD2:  "Special Delivery by 1pm (£1000)",
  SD3:  "Special Delivery by 1pm (£2500)",
  SDV:  "Special Delivery Next Day AGE (£750)",
  SDW:  "Special Delivery Next Day AGE (£1000)",
  SDX:  "Special Delivery Next Day AGE (£2500)",
  SDY:  "Special Delivery Next Day ID (£750)",
  SDZ:  "Special Delivery Next Day ID (£1000)",
  SEA:  "Special Delivery Next Day ID (£2500)",
  SEB:  "Special Delivery Next Day (£750)",
  SEC:  "Special Delivery Next Day (£1000)",
  SED:  "Special Delivery Next Day (£2500)",
}

const RM_FORMATS: Record<string, string> = {
  Letter:       "Letter",
  LargeLetter:  "Large Letter",
  SmallParcel:  "Small Parcel",
  MediumParcel: "Medium Parcel",
}

const STATUS_COLOURS: Record<string, string> = {
  PENDING:       "bg-yellow-100 text-yellow-800",
  LABEL_CREATED: "bg-blue-100 text-blue-800",
  DISPATCHED:    "bg-green-100 text-green-800",
  CANCELLED:     "bg-gray-100 dark:bg-gray-800 text-gray-500",
}

const EMPTY_FORM = {
  recipientName:      "",
  recipientCompany:   "",
  recipientLine1:     "",
  recipientLine2:     "",
  recipientCity:      "",
  recipientCounty:    "",
  recipientPostcode:  "",
  recipientEmail:     "",
  recipientPhone:     "",
  weightInGrams:      "500",
  packageFormat:      "SmallParcel",
  serviceCode:        "TPSN",
  specialInstructions:"",
  notes:              "",
}

export default function PackingPage() {
  const [parcels, setParcels]         = useState<any[]>([])
  const [loading, setLoading]         = useState(false)
  const [search, setSearch]           = useState("")
  const [filterStatus, setFilterStatus] = useState("")
  const [showCreate, setShowCreate]   = useState(false)
  const [form, setForm]               = useState({ ...EMPTY_FORM })
  const [creating, setCreating]       = useState(false)
  const [createErr, setCreateErr]     = useState("")
  const [selected, setSelected]       = useState<any>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionErr, setActionErr]     = useState("")
  const [manifestMsg, setManifestMsg] = useState("")
  const [tab, setTab]                 = useState<"all" | "pending" | "ready" | "dispatched">("all")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (filterStatus) params.set("status", filterStatus)
      const res = await fetch(`/api/parcels?${params}`)
      setParcels(await res.json())
    } finally {
      setLoading(false)
    }
  }, [search, filterStatus])

  useEffect(() => { load() }, [load])

  const tabFiltered = parcels.filter(p => {
    if (tab === "pending")    return p.status === "PENDING"
    if (tab === "ready")      return p.status === "LABEL_CREATED"
    if (tab === "dispatched") return p.status === "DISPATCHED"
    return true
  })

  const readyCount = parcels.filter(p => p.status === "LABEL_CREATED").length

  async function doCreate() {
    if (!form.recipientName || !form.recipientLine1 || !form.recipientCity || !form.recipientPostcode) {
      setCreateErr("Name, address line 1, city and postcode are required"); return
    }
    setCreating(true); setCreateErr("")
    try {
      const res = await fetch("/api/parcels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, weightInGrams: parseInt(form.weightInGrams) || 500 }),
      })
      const data = await res.json()
      if (!res.ok) { setCreateErr(data.error || "Error creating parcel"); return }
      setShowCreate(false)
      setForm({ ...EMPTY_FORM })
      load()
      setSelected(data)
    } finally { setCreating(false) }
  }

  async function generateLabel(parcel: any) {
    setActionLoading(true); setActionErr("")
    try {
      const res = await fetch(`/api/parcels/${parcel.id}/label`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        console.error("[label] error response:", data)
        setActionErr(data.error || "Failed to generate label")
        return
      }
      load()
      setSelected({ ...selected, ...data, status: "LABEL_CREATED" })
    } finally { setActionLoading(false) }
  }

  function openLabel(parcel: any) {
    window.open(`/api/parcels/${parcel.id}/label`, "_blank")
  }

  async function cancelParcel(parcel: any) {
    if (!confirm("Cancel this parcel?")) return
    setActionLoading(true)
    try {
      await fetch(`/api/parcels/${parcel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      })
      load()
      if (selected?.id === parcel.id) setSelected(null)
    } finally { setActionLoading(false) }
  }

  async function deleteParcel(parcel: any) {
    if (!confirm("Permanently delete this parcel? This cannot be undone.")) return
    setActionLoading(true)
    try {
      await fetch(`/api/parcels/${parcel.id}`, { method: "DELETE" })
      load()
      if (selected?.id === parcel.id) setSelected(null)
    } finally { setActionLoading(false) }
  }

  async function doManifest() {
    if (!confirm(`Create end-of-day manifest for all ${readyCount} labelled parcel(s)? This will mark them as dispatched.`)) return
    setActionLoading(true); setManifestMsg("")
    try {
      const res = await fetch("/api/parcels/manifest", { method: "POST" })
      const data = await res.json()
      if (!res.ok) { setManifestMsg(data.error || "Manifest failed"); return }
      setManifestMsg(`✓ Manifest created — ${data.count} parcel(s) dispatched${data.manifestId ? ` (ID: ${data.manifestId})` : ""}`)
      load()
    } finally { setActionLoading(false) }
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })

  return (
    <div className="p-6 space-y-4" style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Packing & Dispatch</h1>
          <p className="text-sm text-gray-500 mt-0.5">Royal Mail Click &amp; Drop integration</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/tools/packing/packers"
            className="text-sm text-gray-600 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 hover:border-gray-400 px-3 py-2 rounded-lg transition-colors"
          >
            👥 Packer Barcodes
          </Link>
          {readyCount > 0 && (
            <button
              onClick={doManifest}
              disabled={actionLoading}
              className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2"
            >
              <span>📦</span> End of Day Manifest ({readyCount})
            </button>
          )}
          <button
            onClick={() => { setShowCreate(true); setCreateErr("") }}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + New Parcel
          </button>
        </div>
      </div>

      {manifestMsg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${manifestMsg.startsWith("✓") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {manifestMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 gap-6">
        {([
          ["all",        "All",         parcels.length],
          ["pending",    "Pending",     parcels.filter(p => p.status === "PENDING").length],
          ["ready",      "Label Ready", readyCount],
          ["dispatched", "Dispatched",  parcels.filter(p => p.status === "DISPATCHED").length],
        ] as [typeof tab, string, number][]).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              tab === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label} <span className="ml-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 px-1.5 py-0.5 rounded-full">{count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search recipient, postcode, reference, tracking…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load()}
        />
        <button className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg" onClick={load}>Search</button>
        <button className="border border-gray-300 dark:border-gray-600 text-sm px-4 py-2 rounded-lg text-gray-600" onClick={() => { setSearch(""); setFilterStatus("") }}>Clear</button>
      </div>

      <div className="flex gap-4">
        {/* Table */}
        <div className="flex-1 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-[#141416] border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Reference</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Recipient</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Postcode</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Service</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Weight</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
              ) : tabFiltered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">No parcels found</td></tr>
              ) : tabFiltered.map(p => (
                <tr
                  key={p.id}
                  onClick={() => { setSelected(p); setActionErr("") }}
                  className={`cursor-pointer hover:bg-gray-50 ${selected?.id === p.id ? "bg-blue-50" : ""}`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.reference.slice(0, 8).toUpperCase()}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{p.recipientName}</p>
                    {p.recipientCompany && <p className="text-xs text-gray-400">{p.recipientCompany}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{p.recipientPostcode}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{RM_SERVICES[p.serviceCode] ?? p.serviceCode}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{p.weightInGrams}g</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOURS[p.status] ?? "bg-gray-100 dark:bg-gray-800 text-gray-600"}`}>
                      {p.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">{fmtDate(p.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-blue-600 font-medium">View →</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 flex-shrink-0 space-y-3">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{selected.reference?.slice(0, 8).toUpperCase()}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOURS[selected.status] ?? ""}`}>
                  {selected.status?.replace("_", " ")}
                </span>
              </div>

              <div className="space-y-1 text-sm">
                <p className="font-semibold text-gray-900 dark:text-white">{selected.recipientName}</p>
                {selected.recipientCompany && <p className="text-gray-500">{selected.recipientCompany}</p>}
                <p className="text-gray-500">{selected.recipientLine1}</p>
                {selected.recipientLine2 && <p className="text-gray-500">{selected.recipientLine2}</p>}
                <p className="text-gray-500">{selected.recipientCity}{selected.recipientCounty ? `, ${selected.recipientCounty}` : ""}</p>
                <p className="text-gray-500">{selected.recipientPostcode}</p>
                {selected.recipientEmail && <p className="text-gray-400 text-xs">{selected.recipientEmail}</p>}
                {selected.recipientPhone && <p className="text-gray-400 text-xs">{selected.recipientPhone}</p>}
              </div>

              <div className="border-t pt-2 grid grid-cols-2 gap-2 text-xs text-gray-500">
                <div><span className="font-medium text-gray-700 dark:text-gray-300">Service</span><br />{RM_SERVICES[selected.serviceCode] ?? selected.serviceCode}</div>
                <div><span className="font-medium text-gray-700 dark:text-gray-300">Format</span><br />{selected.packageFormat}</div>
                <div><span className="font-medium text-gray-700 dark:text-gray-300">Weight</span><br />{selected.weightInGrams}g</div>
                {selected.trackingNumber && <div><span className="font-medium text-gray-700 dark:text-gray-300">Tracking</span><br /><span className="font-mono">{selected.trackingNumber}</span></div>}
              </div>

              {selected.lots?.length > 0 && (
                <div className="border-t pt-2">
                  <p className="text-xs font-semibold text-gray-500 mb-1">LOTS ({selected.lots.length})</p>
                  <div className="space-y-0.5">
                    {selected.lots.map((pl: any) => (
                      <p key={pl.id} className="text-xs text-gray-600">
                        <span className="font-mono text-gray-400">{pl.lot.auction?.code}{pl.lot.barcode || pl.lot.receiptUniqueId ? ` #${pl.lot.barcode ?? pl.lot.receiptUniqueId}` : ""}</span> — {pl.lot.title}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {selected.notes && (
                <div className="border-t pt-2">
                  <p className="text-xs font-semibold text-gray-500 mb-1">NOTES</p>
                  <p className="text-xs text-gray-600">{selected.notes}</p>
                </div>
              )}

              {actionErr && <p className="text-xs text-red-600">{actionErr}</p>}

              {/* Actions */}
              <div className="border-t pt-2 space-y-2">
                {selected.status === "PENDING" && (
                  <button
                    onClick={() => generateLabel(selected)}
                    disabled={actionLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-50"
                  >
                    {actionLoading ? "Creating label…" : "🏷 Generate RM Label"}
                  </button>
                )}
                {(selected.status === "LABEL_CREATED" || selected.labelPdf) && (
                  <button
                    onClick={() => openLabel(selected)}
                    className="w-full bg-white dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-900 text-white text-sm font-medium py-2 rounded-lg"
                  >
                    🖨 Print Label (PDF)
                  </button>
                )}
                {selected.trackingNumber && (
                  <a
                    href={`https://www.royalmail.com/track-your-item#/tracking-results/${selected.trackingNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full text-center border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium py-2 rounded-lg hover:bg-gray-50"
                  >
                    📍 Track on Royal Mail
                  </a>
                )}
                {(selected.status === "PENDING" || selected.status === "LABEL_CREATED") && (
                  <button
                    onClick={() => cancelParcel(selected)}
                    disabled={actionLoading}
                    className="w-full border border-red-200 text-red-600 text-sm font-medium py-2 rounded-lg hover:bg-red-50 disabled:opacity-50"
                  >
                    Cancel Parcel
                  </button>
                )}
                {selected.status === "CANCELLED" && (
                  <button
                    onClick={() => deleteParcel(selected)}
                    disabled={actionLoading}
                    className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-50"
                  >
                    🗑 Delete Permanently
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setShowCreate(false)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">New Parcel</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-5">
              {createErr && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{createErr}</p>}

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Recipient</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Full Name *</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" value={form.recipientName} onChange={e => setForm({...form, recipientName: e.target.value})} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Company</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" value={form.recipientCompany} onChange={e => setForm({...form, recipientCompany: e.target.value})} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Address Line 1 *</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" value={form.recipientLine1} onChange={e => setForm({...form, recipientLine1: e.target.value})} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Address Line 2</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" value={form.recipientLine2} onChange={e => setForm({...form, recipientLine2: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">City *</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" value={form.recipientCity} onChange={e => setForm({...form, recipientCity: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">County</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" value={form.recipientCounty} onChange={e => setForm({...form, recipientCounty: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Postcode *</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm uppercase" value={form.recipientPostcode} onChange={e => setForm({...form, recipientPostcode: e.target.value.toUpperCase()})} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Email</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" type="email" value={form.recipientEmail} onChange={e => setForm({...form, recipientEmail: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Phone</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" value={form.recipientPhone} onChange={e => setForm({...form, recipientPhone: e.target.value})} />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Package &amp; Service</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">RM Service</label>
                    <select
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
                      value={form.serviceCode}
                      onChange={e => setForm({ ...form, serviceCode: e.target.value })}
                    >
                      {Object.entries(RM_SERVICES).map(([code, label]) => (
                        <option key={code} value={code}>{label} ({code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Package Format</label>
                    <select className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" value={form.packageFormat} onChange={e => setForm({...form, packageFormat: e.target.value})}>
                      {Object.entries(RM_FORMATS).map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Weight (grams)</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" type="number" min="1" value={form.weightInGrams} onChange={e => setForm({...form, weightInGrams: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Special Instructions</label>
                    <input className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" value={form.specialInstructions} onChange={e => setForm({...form, specialInstructions: e.target.value})} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Internal Notes</label>
                    <textarea className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  className="flex-1 border border-gray-300 dark:border-gray-600 text-sm py-2.5 rounded-lg text-gray-600 hover:bg-gray-50"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-2.5 rounded-lg font-medium disabled:opacity-50"
                  onClick={doCreate}
                  disabled={creating}
                >
                  {creating ? "Creating…" : "Create Parcel"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
