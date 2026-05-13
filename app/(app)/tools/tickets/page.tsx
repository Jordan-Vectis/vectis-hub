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

const STATUS_OPTIONS  = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const
const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const
const CATEGORY_OPTIONS = ["HARDWARE", "SOFTWARE", "NETWORK", "APP_BUG", "FEATURE_REQUEST", "OTHER"] as const

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
const CATEGORY_LABEL: Record<string, string> = {
  HARDWARE:        "Hardware",
  SOFTWARE:        "Software",
  NETWORK:         "Network",
  APP_BUG:         "App bug",
  FEATURE_REQUEST: "Feature request",
  OTHER:           "Other",
}

export default function TicketsPage() {
  const [tickets, setTickets]     = useState<Ticket[]>([])
  const [loading, setLoading]     = useState(true)
  const [statusFilter, setStatus] = useState<string>("ACTIVE")  // ACTIVE = OPEN + IN_PROGRESS
  const [showCreate, setShow]     = useState(false)
  const [openId, setOpenId]       = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)

  // Create-form state
  const [newTitle, setNewTitle]             = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newPriority, setNewPriority]       = useState<string>("MEDIUM")
  const [newCategory, setNewCategory]       = useState<string>("OTHER")

  async function load() {
    setLoading(true)
    try {
      const r = await fetch("/api/tickets")
      const d = await r.json()
      setTickets(d.tickets ?? [])
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
        <button
          onClick={() => setShow(true)}
          className="shrink-0 bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          + New ticket
        </button>
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
                      <span className="text-xs text-gray-500">{CATEGORY_LABEL[t.category] ?? t.category}</span>
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
                          {CATEGORY_OPTIONS.map(c => (
                            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
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
                    {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
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
