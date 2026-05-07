"use client"

import { useState, useTransition } from "react"
import { ALL_APPS, APP_SECTIONS, WAREHOUSE_ROLES } from "@/lib/apps"
import type { AppKey, WarehouseRole } from "@/lib/apps"
import { APP_CARD_DEFS, SECTION_DEFS } from "@/lib/app-cards"

const ROLES = [
  { key: "COLLECTIONS", label: "Collections" },
  { key: "CATALOGUER",  label: "Cataloguer" },
]

interface User { id: string; name: string; role: string }

interface Props {
  defaults: Record<string, { allowedApps: string[]; appPermissions: any } | undefined>
  users: User[]
}

function buildPermissionsPayload(
  selectedApps: string[],
  warehouseRole: WarehouseRole,
  appSections: Record<string, string[]>,
  hubCards: string[],
) {
  const perms: Record<string, any> = {}
  if (selectedApps.includes("WAREHOUSE")) perms.WAREHOUSE = { role: warehouseRole }
  for (const appKey of Object.keys(APP_SECTIONS)) {
    if (selectedApps.includes(appKey)) {
      perms[appKey] = { ...(perms[appKey] ?? {}), sidebarItems: appSections[appKey] ?? [] }
    }
  }
  perms.HUB_CARDS = { visible: hubCards }
  return perms
}

function RolePanel({ roleKey, roleLabel, initial, users }: {
  roleKey: string
  roleLabel: string
  initial: { allowedApps: string[]; appPermissions: any } | undefined
  users: User[]
}) {
  const ALL_USER_CARD_KEYS = APP_CARD_DEFS.filter(c => c.allUsers).map(c => c.key)
  const storedHubCards = initial?.appPermissions?.HUB_CARDS?.visible as string[] | undefined

  const [selectedApps, setSelectedApps] = useState<string[]>(initial?.allowedApps ?? [])
  const [warehouseRole, setWarehouseRole] = useState<WarehouseRole>(
    (initial?.appPermissions?.WAREHOUSE?.role as WarehouseRole) ?? "warehouse"
  )
  const [appSections, setAppSections] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {}
    for (const [key, sections] of Object.entries(APP_SECTIONS)) {
      out[key] = initial?.appPermissions?.[key]?.sidebarItems ?? sections!.map(s => s.key)
    }
    return out
  })
  const [hubCards, setHubCards] = useState<string[]>(
    storedHubCards && storedHubCards.length > 0 ? storedHubCards : ALL_USER_CARD_KEYS
  )

  const [saveMsg, setSaveMsg]         = useState<string | null>(null)
  const [savePending, startSave]      = useTransition()
  const [applyMsg, setApplyMsg]       = useState<string | null>(null)
  const [applyPending, startApply]    = useTransition()
  const [applyMode, setApplyMode]     = useState<"all" | "pick">("all")
  const [pickedUsers, setPickedUsers] = useState<string[]>([])

  const roleUsers = users.filter(u => u.role === roleKey)

  // Map AppKey → section
  const appKeyToSection: Partial<Record<string, string>> = {}
  for (const card of APP_CARD_DEFS) {
    if (card.appKey && card.group) appKeyToSection[card.appKey] = card.group
  }
  const groupedApps = SECTION_DEFS
    .map(s => ({ ...s, apps: ALL_APPS.filter(a => appKeyToSection[a.key] === s.key) }))
    .filter(s => s.apps.length > 0)

  function toggleApp(key: AppKey) {
    setSelectedApps(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }
  function toggleSection(appKey: string, sectionKey: string) {
    setAppSections(prev => {
      const cur = prev[appKey] ?? []
      return { ...prev, [appKey]: cur.includes(sectionKey) ? cur.filter(k => k !== sectionKey) : [...cur, sectionKey] }
    })
  }
  function toggleHubCard(key: string) {
    setHubCards(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }
  function togglePickedUser(id: string) {
    setPickedUsers(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id])
  }

  function save() {
    setSaveMsg(null)
    const appPermissions = buildPermissionsPayload(selectedApps, warehouseRole, appSections, hubCards)
    startSave(async () => {
      const res = await fetch("/api/admin/role-defaults", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ role: roleKey, allowedApps: selectedApps, appPermissions }),
      })
      setSaveMsg(res.ok ? "Saved" : "Failed to save")
      if (res.ok) setTimeout(() => setSaveMsg(null), 2000)
    })
  }

  function apply() {
    setApplyMsg(null)
    const userIds = applyMode === "all" ? "all" : pickedUsers
    if (applyMode === "pick" && pickedUsers.length === 0) {
      setApplyMsg("Select at least one user.")
      return
    }
    startApply(async () => {
      const res = await fetch("/api/admin/role-defaults/apply", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ role: roleKey, userIds }),
      })
      const data = await res.json()
      if (res.ok) {
        setApplyMsg(`Applied to ${data.count} user${data.count === 1 ? "" : "s"}`)
        setTimeout(() => setApplyMsg(null), 3000)
      } else {
        setApplyMsg(data.error ?? "Failed")
      }
    })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="font-semibold text-gray-800 mb-1">{roleLabel}</h2>
      <p className="text-sm text-gray-500 mb-5">Default app access for new {roleLabel} users.</p>

      {/* ── Tool apps grouped by section ── */}
      <div className="flex flex-col gap-6 mb-6">
        {groupedApps.map(section => (
          <div key={section.key}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{section.label}</p>
            <div className="flex flex-col gap-3">
              {section.apps.map(app => (
                <div key={app.key}>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div
                      onClick={() => toggleApp(app.key)}
                      className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                        selectedApps.includes(app.key) ? "bg-blue-600 border-blue-600" : "border-gray-300 group-hover:border-blue-400"
                      }`}
                    >
                      {selectedApps.includes(app.key) && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-gray-900 font-medium">{app.label}</span>
                  </label>

                  {app.key === "WAREHOUSE" && selectedApps.includes("WAREHOUSE") && (
                    <div className="ml-8 mt-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse Role</label>
                      <select
                        value={warehouseRole}
                        onChange={e => setWarehouseRole(e.target.value as WarehouseRole)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {WAREHOUSE_ROLES.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {APP_SECTIONS[app.key as AppKey] && selectedApps.includes(app.key) && (
                    <div className="ml-8 mt-2">
                      <p className="text-xs font-medium text-gray-500 mb-2">Visible sections</p>
                      <div className="flex flex-col gap-2">
                        {APP_SECTIONS[app.key as AppKey]!.map(section => {
                          const checked = (appSections[app.key] ?? []).includes(section.key)
                          return (
                            <label key={section.key} className="flex items-center gap-2 cursor-pointer group">
                              <div
                                onClick={() => toggleSection(app.key, section.key)}
                                className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                                  checked ? "bg-blue-500 border-blue-500" : "border-gray-300 group-hover:border-blue-400"
                                }`}
                              >
                                {checked && (
                                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </div>
                              <span className="text-xs text-gray-600 group-hover:text-gray-900">{section.label}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Hub cards ── */}
      <div className="border-t border-gray-100 pt-5 mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Hub Cards</p>
        <p className="text-xs text-gray-400 mb-3">These cards are shown to all users — untick to hide by default.</p>
        <div className="flex flex-col gap-3">
          {APP_CARD_DEFS.filter(c => c.allUsers).map(card => (
            <label key={card.key} className="flex items-center gap-3 cursor-pointer group">
              <div
                onClick={() => toggleHubCard(card.key)}
                className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                  hubCards.includes(card.key) ? "bg-blue-600 border-blue-600" : "border-gray-300 group-hover:border-blue-400"
                }`}
              >
                {hubCards.includes(card.key) && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span className="text-sm text-gray-700 group-hover:text-gray-900 font-medium">{card.icon} {card.defaultLabel}</span>
            </label>
          ))}
        </div>
      </div>

      {/* ── Save defaults ── */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={save}
          disabled={savePending}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          {savePending ? "Saving…" : "Save Defaults"}
        </button>
        {saveMsg && (
          <span className={`text-sm ${saveMsg === "Saved" ? "text-green-600" : "text-red-500"}`}>{saveMsg}</span>
        )}
      </div>

      {/* ── Apply to existing users ── */}
      <div className="border-t border-gray-100 pt-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Apply to Existing Users</p>

        {roleUsers.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No {roleLabel} users yet.</p>
        ) : (
          <>
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => setApplyMode("all")}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  applyMode === "all"
                    ? "bg-gray-800 text-white border-gray-800"
                    : "border-gray-300 text-gray-600 hover:border-gray-400"
                }`}
              >
                All {roleLabel} users ({roleUsers.length})
              </button>
              <button
                onClick={() => setApplyMode("pick")}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  applyMode === "pick"
                    ? "bg-gray-800 text-white border-gray-800"
                    : "border-gray-300 text-gray-600 hover:border-gray-400"
                }`}
              >
                Pick users
              </button>
            </div>

            {applyMode === "pick" && (
              <div className="flex flex-col gap-2 mb-4 pl-1">
                {roleUsers.map(u => (
                  <label key={u.id} className="flex items-center gap-3 cursor-pointer group">
                    <div
                      onClick={() => togglePickedUser(u.id)}
                      className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                        pickedUsers.includes(u.id) ? "bg-blue-600 border-blue-600" : "border-gray-300 group-hover:border-blue-400"
                      }`}
                    >
                      {pickedUsers.includes(u.id) && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-gray-900">{u.name}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={apply}
                disabled={applyPending}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {applyPending ? "Applying…" : "Apply Defaults"}
              </button>
              {applyMsg && (
                <span className={`text-sm ${applyMsg.startsWith("Applied") ? "text-green-600" : "text-red-500"}`}>
                  {applyMsg}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function RoleDefaultsForm({ defaults, users }: Props) {
  return (
    <div className="flex flex-col gap-8">
      {ROLES.map(r => (
        <RolePanel
          key={r.key}
          roleKey={r.key}
          roleLabel={r.label}
          initial={defaults[r.key]}
          users={users}
        />
      ))}
    </div>
  )
}
