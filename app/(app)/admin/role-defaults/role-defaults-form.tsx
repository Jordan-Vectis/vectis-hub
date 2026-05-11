"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ALL_APPS, APP_SECTIONS, WAREHOUSE_ROLES } from "@/lib/apps"
import type { AppKey, WarehouseRole } from "@/lib/apps"
import { APP_CARD_DEFS, SECTION_DEFS } from "@/lib/app-cards"

// Convert a role key (e.g. "WAREHOUSE_MANAGER") to a display label
// ("Warehouse Manager"). Keys that are already nicely formatted pass through.
function roleLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

interface User { id: string; name: string; role: string }

interface Props {
  allRoles: string[]
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
  // "configured" = the HUB_CARDS key exists in appPermissions, even if its
  // 'visible' array is empty. Empty means "deliberately no cards", so we must
  // respect that — earlier code treated [] as "not yet set" and silently
  // reverted unticks back to all-on. Bug now fixed by using key presence.
  const hubCardsConfigured = (initial?.appPermissions as any)?.HUB_CARDS !== undefined
  const storedHubCards     = (initial?.appPermissions as any)?.HUB_CARDS?.visible as string[] | undefined

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
    hubCardsConfigured ? (storedHubCards ?? []) : ALL_USER_CARD_KEYS
  )

  const router = useRouter()
  const [saveMsg, setSaveMsg]         = useState<string | null>(null)
  const [savePending, startSave]      = useTransition()
  const [applyMsg, setApplyMsg]       = useState<string | null>(null)
  const [applyPending, startApply]    = useTransition()
  const [applyMode, setApplyMode]     = useState<"all" | "pick">("all")
  const [pickedUsers, setPickedUsers] = useState<string[]>([])

  const roleUsers = users.filter(u => u.role === roleKey)

  // Build unified sections: app-access items + hub-card-visibility items together
  const appKeyToSection: Partial<Record<string, string>> = {}
  for (const card of APP_CARD_DEFS) {
    if (card.appKey && card.group) appKeyToSection[card.appKey] = card.group
  }
  const sections = SECTION_DEFS.map(s => ({
    ...s,
    items: [
      ...ALL_APPS
        .filter(a => appKeyToSection[a.key] === s.key)
        .map(a => ({ type: "app" as const, key: a.key, label: a.label, icon: "" })),
      ...APP_CARD_DEFS
        .filter(c => c.allUsers && c.group === s.key)
        .map(c => ({ type: "hub" as const, key: c.key, label: c.defaultLabel, icon: c.icon })),
    ],
  })).filter(s => s.items.length > 0)

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
      if (res.ok) {
        setSaveMsg("Saved")
        router.refresh()
        setTimeout(() => setSaveMsg(null), 2000)
      } else {
        const data = await res.json().catch(() => ({}))
        setSaveMsg(data.error ?? "Failed to save")
      }
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

      {/* ── All items grouped by section ── */}
      <div className="flex flex-col gap-6 mb-6">
        {sections.map(section => (
          <div key={section.key}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{section.label}</p>
            <div className="flex flex-col gap-3">
              {section.items.map(item => (
                <div key={item.key}>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div
                      onClick={() => item.type === "app" ? toggleApp(item.key as AppKey) : toggleHubCard(item.key)}
                      className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                        (item.type === "app" ? selectedApps.includes(item.key) : hubCards.includes(item.key))
                          ? "bg-blue-600 border-blue-600"
                          : "border-gray-300 group-hover:border-blue-400"
                      }`}
                    >
                      {(item.type === "app" ? selectedApps.includes(item.key) : hubCards.includes(item.key)) && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-gray-900 font-medium">
                      {item.icon && <span className="mr-1">{item.icon}</span>}{item.label}
                    </span>
                  </label>

                  {item.type === "app" && item.key === "WAREHOUSE" && selectedApps.includes("WAREHOUSE") && (
                    <div className="ml-8 mt-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse Role</label>
                      <select
                        value={warehouseRole}
                        onChange={e => setWarehouseRole(e.target.value as WarehouseRole)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {WAREHOUSE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  )}

                  {item.type === "app" && APP_SECTIONS[item.key as AppKey] && selectedApps.includes(item.key) && (
                    <div className="ml-8 mt-2">
                      <p className="text-xs font-medium text-gray-500 mb-2">Visible sections</p>
                      <div className="flex flex-col gap-2">
                        {APP_SECTIONS[item.key as AppKey]!.map(s => {
                          const checked = (appSections[item.key] ?? []).includes(s.key)
                          return (
                            <label key={s.key} className="flex items-center gap-2 cursor-pointer group">
                              <div
                                onClick={() => toggleSection(item.key, s.key)}
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
                              <span className="text-xs text-gray-600 group-hover:text-gray-900">{s.label}</span>
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

export default function RoleDefaultsForm({ allRoles, defaults, users }: Props) {
  const router = useRouter()
  const [pendingRoles, setPendingRoles] = useState<string[]>([])  // locally-added rows the user hasn't saved yet
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null)

  const knownRoles = new Set([...allRoles, ...pendingRoles])

  function handleAdd() {
    setAddError(null)
    // Convert to UPPER_SNAKE_CASE — gives consistent uppercase enum-style keys
    // ("Warehouse Manager" → "WAREHOUSE_MANAGER") to match the existing convention
    const normalised = newRoleName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")
    if (!normalised) { setAddError("Enter a role name"); return }
    if (normalised === "ADMIN") { setAddError("ADMIN is a system role and can't be created here"); return }
    if (knownRoles.has(normalised)) { setAddError(`Role "${normalised}" already exists`); return }
    setPendingRoles(prev => [...prev, normalised])
    setNewRoleName("")
    setShowAddDialog(false)
  }

  async function handleDelete(roleKey: string) {
    const usersOnRole = users.filter(u => u.role === roleKey)
    if (usersOnRole.length > 0) {
      alert(`Cannot delete — ${usersOnRole.length} user${usersOnRole.length === 1 ? "" : "s"} still assigned to this role. Reassign them first.`)
      return
    }
    if (!confirm(`Delete role "${roleKey}"? This removes its default permissions. Any users you later assign to "${roleKey}" will start with no app access until you reconfigure it.`)) return

    // If it's only in pendingRoles (not saved yet) just remove from state
    if (pendingRoles.includes(roleKey) && !allRoles.includes(roleKey)) {
      setPendingRoles(prev => prev.filter(r => r !== roleKey))
      return
    }

    try {
      const res = await fetch(`/api/admin/role-defaults/${encodeURIComponent(roleKey)}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setDeleteMsg(data.error ?? "Failed to delete"); return }
      setDeleteMsg(`Deleted "${roleKey}"`)
      router.refresh()
      setTimeout(() => setDeleteMsg(null), 4000)
    } catch {
      setDeleteMsg("Network error")
    }
  }

  const displayRoles = [...allRoles, ...pendingRoles.filter(r => !allRoles.includes(r))]

  return (
    <div className="flex flex-col gap-6">
      {/* Add-new toolbar */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
        <div>
          <h2 className="font-semibold text-gray-800">{displayRoles.length} role{displayRoles.length === 1 ? "" : "s"}</h2>
          <p className="text-xs text-gray-500 mt-0.5">Click "+ Add role" to create a new one, then configure its permissions and save.</p>
        </div>
        <button
          onClick={() => { setShowAddDialog(true); setAddError(null); setNewRoleName("") }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >+ Add role</button>
      </div>

      {/* Add-role dialog */}
      {showAddDialog && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h3 className="font-semibold text-gray-800 mb-2">New role</h3>
          <p className="text-xs text-gray-600 mb-3">
            Enter a name like <code className="bg-white px-1 py-0.5 rounded text-[11px]">Warehouse Manager</code> or <code className="bg-white px-1 py-0.5 rounded text-[11px]">Junior Cataloguer</code>.
            It'll be stored as upper-snake-case (<code className="bg-white px-1 py-0.5 rounded text-[11px]">WAREHOUSE_MANAGER</code>) to match the existing role keys.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newRoleName}
              onChange={e => setNewRoleName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="e.g. Warehouse Manager"
              autoFocus
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={handleAdd}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg">Add</button>
            <button onClick={() => setShowAddDialog(false)}
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:border-gray-400">Cancel</button>
          </div>
          {addError && <p className="text-xs text-red-600 mt-2">{addError}</p>}
        </div>
      )}

      {deleteMsg && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800 text-sm">{deleteMsg}</div>
      )}

      {/* Role panels */}
      {displayRoles.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          No roles yet (besides ADMIN). Click "+ Add role" above to create one.
        </div>
      ) : displayRoles.map(roleKey => (
        <div key={roleKey} className="relative">
          <button
            onClick={() => handleDelete(roleKey)}
            title="Delete this role (only allowed if no users are assigned to it)"
            className="absolute top-4 right-4 z-10 text-xs text-red-500 hover:text-red-700 hover:underline"
          >
            Delete role
          </button>
          <RolePanel
            roleKey={roleKey}
            roleLabel={roleLabel(roleKey)}
            initial={defaults[roleKey]}
            users={users}
          />
        </div>
      ))}
    </div>
  )
}
