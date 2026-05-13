"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

type Ticket = {
  id:             string
  title:          string
  description:    string
  status:         string
  priority:       string
  category:       string
  createdByName:  string
  createdById:    string | null
  assignedToName: string | null
  resolvedAt:     string | null
  resolutionNote: string | null
  createdAt:      string
  updatedAt:      string
}

type Category = {
  id:        string
  key:       string
  label:     string
  sortOrder: number
  active:    boolean
}

const STATUS_OPTIONS  = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const
const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const

const STATUS_COLOUR: Record<string, string> = {
  OPEN:        "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  RESOLVED:    "bg-green-100 text-green-700",
  CLOSED:      "bg-gray-100 text-gray-600",
}
const PRIORITY_COLOUR: Record<string, string> = {
  LOW:    "bg-gray-100 text-gray-600",
  MEDIUM: "bg-sky-100 text-sky-700",
  HIGH:   "bg-orange-100 text-orange-700",
  URGENT: "bg-red-100 text-red-700",
}

export default function TicketsPage() {
  const [tickets, setTickets]     = useState<Ticket[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading]     = useState(true)
  const [statusFilter, setStatus] = useState<string>("ACTIVE")  // ACTIVE = OPEN + IN_PROGRESS
  const [showCreate, setShow]     = useState(false)
  const [showManageCats, setShowManageCats] = useState(false)
  const [openId, setOpenId]       = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)

  // Create-form state
  const [newTitle, setNewTitle]             = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newPriority, setNewPriority]       = useState<string>("MEDIUM")
  const [newCategory, setNewCategory]       = useState<string>("OTHER")

  // Look up label by key — handles deactivated / renamed categories gracefully.
  const categoryLabel = (key: string) =>
    categories.find(c => c.key === key)?.label ??
    key.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, m => m.toUpperCase())

  const activeCategories = useMemo(
    () => categories.filter(c => c.active),
    [categories],
  )

  async function load() {
    setLoading(true)
    try {
      const [tr, cr] = await Promise.all([
        fetch("/api/tickets"),
        fetch("/api/ticket-categories"),
      ])
      const td = await tr.json()
      const cd = await cr.json()
      setTickets(td.tickets ?? [])
      const cats: Category[] = cd.categories ?? []
      setCategories(cats)
      // Seed the create-form default with the first active category if "OTHER"
      // doesn't exist any more.
      const active = cats.filter(c => c.active)
      if (active.length > 0 && !active.find(c => c.key === newCategory)) {
        const fallback = active.find(c => c.key === "OTHER") ?? active[active.length - 1]
        setNewCategory(fallback.key)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    if (statusFilter === "ALL")    return tickets
    if (statusFilter === "ACTIVE") return tickets.filter(t => t.status === "OPEN" || t.status === "IN_PROGRESS")
    return tickets.filter(t => t.status === statusFilter)
  }, [tickets, statusFilter])

  async function createTicket() {
    if (!newTitle.trim() || !newDescription.trim()) {
      alert("Title and description are required")
      return
    }
    setSaving(true)
    try {
      const r = await fetch("/api/tickets", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          title:       newTitle,
          description: newDescription,
          priority:    newPriority,
          category:    newCategory,
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        alert(d.error ?? "Failed to create ticket")
        return
      }
      setNewTitle("")
      setNewDescription("")
      setNewPriority("MEDIUM")
      setNewCategory("OTHER")
      setShow(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function updateTicket(id: string, patch: Partial<Ticket>) {
    setSaving(true)
    try {
      const r = await fetch(`/api/tickets/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(patch),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        alert(d.error ?? "Failed to update ticket")
        return
      }
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function deleteTicket(id: string) {
    if (!confirm("Delete this ticket permanently?")) return
    setSaving(true)
    try {
      const r = await fetch(`/api/tickets/${id}`, { method: "DELETE" })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        alert(d.error ?? "Failed to delete (admin only)")
        return
      }
      setOpenId(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const counts = useMemo(() => ({
    ACTIVE:      tickets.filter(t => t.status === "OPEN" || t.status === "IN_PROGRESS").length,
    OPEN:        tickets.filter(t => t.status === "OPEN").length,
    IN_PROGRESS: tickets.filter(t => t.status === "IN_PROGRESS").length,
    RESOLVED:    tickets.filter(t => t.status === "RESOLVED").length,
    CLOSED:      tickets.filter(t => t.status === "CLOSED").length,
    ALL:         tickets.length,
  }), [tickets])

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link href="/hub" className="text-sm text-gray-500 hover:text-gray-700">← Hub</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Ticket System</h1>
          <p className="text-sm text-gray-500 mt-1">
            Log IT problems, app bugs and feature requests. Anyone can raise a ticket; the IT team works through them.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <Link
            href="/tools/tickets/import"
            className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-2 rounded-lg"
            title="Bulk import tickets from an Outlook CSV export (admin)"
          >
            📥 Import
          </Link>
          <button
            onClick={() => setShowManageCats(true)}
            className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-2 rounded-lg"
            title="Add, rename or deactivate ticket categories (admin)"
          >
            ⚙ Categories
          </button>
          <button
            onClick={() => setShow(true)}
            className="bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            + New ticket
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        {(["ACTIVE", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "ALL"] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              statusFilter === s
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {s.replace("_", " ")} <span className="opacity-60">({counts[s]})</span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="text-gray-500 text-sm bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          No tickets to show.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map(t => {
            const isOpen = openId === t.id
            return (
              <div key={t.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenId(isOpen ? null : t.id)}
                  className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{t.title}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOUR[t.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {t.status.replace("_", " ")}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLOUR[t.priority] ?? ""}`}>
                        {t.priority}
                      </span>
                      <span className="text-xs text-gray-500">{categoryLabel(t.category)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Raised by {t.createdByName} · {new Date(t.createdAt).toLocaleString("en-GB")}
                      {t.assignedToName && <> · assigned to <strong>{t.assignedToName}</strong></>}
                    </p>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 mt-1 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                    <div>
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Description</div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{t.description}</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Status">
                        <select
                          value={t.status}
                          onChange={e => updateTicket(t.id, { status: e.target.value })}
                          disabled={saving}
                          className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5"
                        >
                          {STATUS_OPTIONS.map(s => (
                            <option key={s} value={s}>{s.replace("_", " ")}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Priority">
                        <select
                          value={t.priority}
                          onChange={e => updateTicket(t.id, { priority: e.target.value })}
                          disabled={saving}
                          className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5"
                        >
                          {PRIORITY_OPTIONS.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Category">
                        <select
                          value={t.category}
                          onChange={e => updateTicket(t.id, { category: e.target.value })}
                          disabled={saving}
                          className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5"
                        >
                          {/* Keep the ticket's current value selectable even if it's been
                              deactivated or renamed since — otherwise the dropdown lies
                              about the active value. */}
                          {!activeCategories.find(c => c.key === t.category) && (
                            <option value={t.category}>{categoryLabel(t.category)} (inactive)</option>
                          )}
                          {activeCategories.map(c => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Assigned to">
                        <input
                          type="text"
                          defaultValue={t.assignedToName ?? ""}
                          onBlur={e => {
                            const v = e.target.value.trim()
                            if (v !== (t.assignedToName ?? "")) updateTicket(t.id, { assignedToName: v })
                          }}
                          placeholder="Name (blank = unassigned)"
                          className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5"
                        />
                      </Field>
                    </div>

                    <Field label="Resolution note">
                      <textarea
                        defaultValue={t.resolutionNote ?? ""}
                        onBlur={e => {
                          const v = e.target.value.trim()
                          if (v !== (t.resolutionNote ?? "")) updateTicket(t.id, { resolutionNote: v })
                        }}
                        rows={2}
                        placeholder="Filled in when the ticket is resolved or closed."
                        className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 resize-y"
                      />
                    </Field>

                    {t.resolvedAt && (
                      <p className="text-xs text-gray-500">
                        Resolved {new Date(t.resolvedAt).toLocaleString("en-GB")}
                      </p>
                    )}

                    <div className="flex justify-end">
                      <button
                        onClick={() => deleteTicket(t.id)}
                        disabled={saving}
                        className="text-xs text-red-600 hover:text-red-700 hover:underline"
                      >
                        Delete (admin only)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setShow(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">New ticket</h2>
            </div>
            <div className="px-6 py-4 space-y-4">
              <Field label="Title">
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Short summary of the problem"
                  className="w-full text-sm border border-gray-200 rounded-md px-3 py-2"
                  autoFocus
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  rows={5}
                  placeholder="What were you doing? What went wrong? Any error messages?"
                  className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 resize-y"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Priority">
                  <select
                    value={newPriority}
                    onChange={e => setNewPriority(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-md px-2 py-2"
                  >
                    {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Category">
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-md px-2 py-2"
                  >
                    {activeCategories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </Field>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setShow(false)}
                disabled={saving}
                className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={createTicket}
                disabled={saving}
                className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
              >
                {saving ? "Creating…" : "Create ticket"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage categories modal */}
      {showManageCats && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setShowManageCats(false)}
          onChanged={load}
        />
      )}
    </div>
  )
}

function ManageCategoriesModal({
  categories,
  onClose,
  onChanged,
}: {
  categories: Category[]
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [newLabel, setNewLabel] = useState("")
  const [saving, setSaving]     = useState(false)

  async function add() {
    const label = newLabel.trim()
    if (!label) return
    setSaving(true)
    try {
      const r = await fetch("/api/ticket-categories", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ label }),
      })
      const d = await r.json()
      if (!r.ok) {
        alert(d.error ?? "Failed to add (admin only)")
        return
      }
      setNewLabel("")
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  async function patch(id: string, body: any) {
    setSaving(true)
    try {
      const r = await fetch(`/api/ticket-categories/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) {
        alert(d.error ?? "Failed to update (admin only)")
        return
      }
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Delete category "${label}"? Tickets that use it must be re-categorised first.`)) return
    setSaving(true)
    try {
      const r = await fetch(`/api/ticket-categories/${id}`, { method: "DELETE" })
      const d = await r.json()
      if (!r.ok) {
        alert(d.error ?? "Failed to delete")
        return
      }
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Manage ticket categories</h2>
          <p className="text-xs text-gray-500 mt-1">
            Admin only. Renaming is safe — the underlying key stays the same. Deactivate a category
            to hide it from new tickets without breaking existing ones. Delete is only allowed
            when no tickets reference it.
          </p>
        </div>

        <div className="px-6 py-4 flex-1 overflow-y-auto space-y-2">
          {categories.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No categories yet — add one below.</p>
          ) : (
            categories.map(c => (
              <div key={c.id} className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${c.active ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50 opacity-70"}`}>
                <input
                  type="text"
                  defaultValue={c.label}
                  onBlur={e => {
                    const v = e.target.value.trim()
                    if (v && v !== c.label) patch(c.id, { label: v })
                  }}
                  className="flex-1 text-sm border border-transparent hover:border-gray-200 focus:border-gray-300 rounded px-2 py-1 outline-none bg-transparent"
                  title="Click to rename"
                />
                <span className="text-xs text-gray-400 font-mono">{c.key}</span>
                <button
                  onClick={() => patch(c.id, { active: !c.active })}
                  disabled={saving}
                  className={`text-xs font-medium px-2 py-1 rounded-md ${
                    c.active
                      ? "bg-green-100 text-green-700 hover:bg-green-200"
                      : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                  }`}
                >
                  {c.active ? "Active" : "Inactive"}
                </button>
                <button
                  onClick={() => remove(c.id, c.label)}
                  disabled={saving}
                  className="text-xs text-red-600 hover:text-red-700 hover:underline px-1"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Add a category</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") add() }}
              placeholder="e.g. Printer, Email, Phone"
              className="flex-1 text-sm border border-gray-200 rounded-md px-3 py-2"
            />
            <button
              onClick={add}
              disabled={saving || !newLabel.trim()}
              className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Add
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{label}</div>
      {children}
    </label>
  )
}
