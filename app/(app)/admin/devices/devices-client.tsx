"use client"

import { useState } from "react"

type User   = { id: string; name: string; email: string }
type Device = {
  id: string
  serialNumber: string
  name: string
  deviceType: string
  notes: string | null
  assignedToId: string | null
  assignedTo: User | null
  createdAt: Date | string
}

interface Props {
  devices: Device[]
  users: User[]
}

const EMPTY_FORM = { serialNumber: "", name: "", deviceType: "iPad", notes: "", assignedToId: "" }

export default function DevicesClient({ devices: initial, users }: Props) {
  const [devices, setDevices]   = useState<Device[]>(initial)
  const [showAdd, setShowAdd]   = useState(false)
  const [editing, setEditing]   = useState<string | null>(null)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  function openAdd() {
    setForm(EMPTY_FORM)
    setEditing(null)
    setShowAdd(true)
    setError(null)
  }

  function openEdit(d: Device) {
    setForm({
      serialNumber: d.serialNumber,
      name:         d.name,
      deviceType:   d.deviceType,
      notes:        d.notes ?? "",
      assignedToId: d.assignedToId ?? "",
    })
    setEditing(d.id)
    setShowAdd(true)
    setError(null)
  }

  function closeForm() {
    setShowAdd(false)
    setEditing(null)
    setError(null)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body = {
        serialNumber: form.serialNumber,
        name:         form.name,
        deviceType:   form.deviceType,
        notes:        form.notes || null,
        assignedToId: form.assignedToId || null,
      }

      const res = editing
        ? await fetch(`/api/admin/devices/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/admin/devices",            { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Save failed"); return }

      if (editing) {
        setDevices(prev => prev.map(d => d.id === editing ? data.device : d))
      } else {
        setDevices(prev => [...prev, data.device].sort((a, b) => a.name.localeCompare(b.name)))
      }
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  async function deleteDevice(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/devices/${id}`, { method: "DELETE" })
    if (res.ok) setDevices(prev => prev.filter(d => d.id !== id))
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Devices</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Track tablets and other devices used by staff.</p>
        </div>
        <button
          onClick={openAdd}
          className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Add device
        </button>
      </div>

      {/* Add / Edit form */}
      {showAdd && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">{editing ? "Edit device" : "Add device"}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Device name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Warehouse iPad 1"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Serial number</label>
              <input
                value={form.serialNumber}
                onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))}
                placeholder="e.g. DMPYQ3NJQ6NV"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Device type</label>
              <select
                value={form.deviceType}
                onChange={e => setForm(f => ({ ...f, deviceType: e.target.value }))}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option>iPad</option>
                <option>iPad Pro</option>
                <option>iPad Mini</option>
                <option>Android Tablet</option>
                <option>Laptop</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Assigned to</label>
              <select
                value={form.assignedToId}
                onChange={e => setForm(f => ({ ...f, assignedToId: e.target.value }))}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value="">— Unassigned —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Cracked screen, kept in warehouse"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

          <div className="flex gap-3 mt-5">
            <button
              onClick={save}
              disabled={saving || !form.serialNumber.trim() || !form.name.trim()}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={closeForm}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:border-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Device list */}
      {devices.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400 dark:text-gray-500">No devices registered yet.</div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3">Serial number</th>
                <th className="text-left px-5 py-3">Assigned to</th>
                <th className="text-left px-5 py-3">Notes</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {devices.map(d => (
                <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{d.name}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{d.deviceType}</td>
                  <td className="px-5 py-3 font-mono text-gray-600 dark:text-gray-400 text-xs">{d.serialNumber}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300">
                    {d.assignedTo
                      ? <span>{d.assignedTo.name}</span>
                      : <span className="text-gray-400 dark:text-gray-500 italic">Unassigned</span>
                    }
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{d.notes ?? "—"}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => openEdit(d)}
                        className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-gray-300 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteDevice(d.id, d.name)}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
