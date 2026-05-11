"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updateUser, changePassword } from "@/lib/actions/admin"
import { ALL_APPS, WAREHOUSE_ROLES, APP_SECTIONS } from "@/lib/apps"
import type { AppKey, WarehouseRole } from "@/lib/apps"
import { APP_CARD_DEFS, SECTION_DEFS } from "@/lib/app-cards"

interface Props {
  userId: string
  name: string
  email: string
  username: string | null
  role: string
  departmentId: string | null
  allowedApps: string[]
  appPermissions: Record<string, any> | null
  departments: { id: string; name: string }[]
  roles:       string[]
  isSelf: boolean
}

function roleLabel(key: string): string {
  return key.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

export default function EditUserForm({ userId, name, email, username, role, departmentId, allowedApps, appPermissions, departments, roles, isSelf }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedApps, setSelectedApps] = useState<string[]>(allowedApps)
  const [warehouseRole, setWarehouseRole] = useState<WarehouseRole>(
    (appPermissions?.WAREHOUSE?.role as WarehouseRole) || "warehouse"
  )
  // Per-app section visibility — keyed by AppKey
  const [appSections, setAppSections] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {}
    for (const [key, sections] of Object.entries(APP_SECTIONS)) {
      initial[key] = appPermissions?.[key]?.sidebarItems ?? sections!.map(s => s.key)
    }
    return initial
  })

  // Hub card visibility — only applies to allUsers cards
  const ALL_USER_CARD_KEYS = APP_CARD_DEFS.filter(c => c.allUsers).map(c => c.key)
  const storedHubCards = (appPermissions as any)?.HUB_CARDS?.visible as string[] | undefined
  const [hubCards, setHubCards] = useState<string[]>(
    // Default to all visible if never configured or empty (treats [] as "not yet set")
    storedHubCards && storedHubCards.length > 0 ? storedHubCards : ALL_USER_CARD_KEYS
  )

  function toggleHubCard(key: string) {
    setHubCards(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  function toggleAppSection(appKey: string, sectionKey: string) {
    setAppSections(prev => {
      const current = prev[appKey] ?? []
      return {
        ...prev,
        [appKey]: current.includes(sectionKey)
          ? current.filter(k => k !== sectionKey)
          : [...current, sectionKey],
      }
    })
  }
  const [appsPending, startAppsTransition] = useTransition()
  const [appsMsg, setAppsMsg] = useState<string | null>(null)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm]   = useState("")
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [pwdPending, startPwdTransition] = useTransition()
  const [showPwd, setShowPwd] = useState(false)

  // Build unified sections: each section contains both app-access items and hub-card-visibility items
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

  function saveDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await updateUser(userId, fd)
      router.refresh()
    })
  }

  function saveApps() {
    setAppsMsg(null)
    const newAppPermissions: Record<string, any> = {}
    if (selectedApps.includes("WAREHOUSE")) {
      newAppPermissions.WAREHOUSE = { role: warehouseRole }
    }
    // Save section visibility for all apps that have sections
    for (const appKey of Object.keys(APP_SECTIONS)) {
      if (selectedApps.includes(appKey)) {
        newAppPermissions[appKey] = {
          ...(newAppPermissions[appKey] ?? {}),
          sidebarItems: appSections[appKey] ?? [],
        }
      }
    }
    // Save hub card visibility overrides (only if not all cards are visible — saves space)
    newAppPermissions.HUB_CARDS = { visible: hubCards }

    startAppsTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/apps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedApps: selectedApps, appPermissions: newAppPermissions }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const persistedApps = (data?.persisted?.allowedApps ?? []) as string[]
        const sent = [...selectedApps].sort().join(",")
        const got = [...persistedApps].sort().join(",")
        if (sent === got) {
          setAppsMsg("Saved")
          router.refresh()
          setTimeout(() => setAppsMsg(null), 2000)
        } else {
          setAppsMsg(`DB mismatch — sent [${sent}] but DB has [${got}]`)
        }
      } else {
        setAppsMsg(data?.error ?? "Failed to save")
      }
    })
  }

  function savePassword(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setPwdError("Passwords do not match."); return }
    if (password.length < 8)  { setPwdError("Password must be at least 8 characters."); return }
    setPwdError(null)
    startPwdTransition(async () => {
      await changePassword(userId, password)
      setPwdOpen(false)
      setPassword("")
      setConfirm("")
      setShowPwd(false)
    })
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Basic details ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Basic Details</h2>
        <form onSubmit={saveDetails} className="flex flex-col gap-4 max-w-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
            <input name="name" defaultValue={name} required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input name="username" defaultValue={username ?? ""} placeholder="First.Last"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">Used to log in instead of email</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input name="email" type="email" defaultValue={email} required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select name="role" defaultValue={role} disabled={isSelf}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400">
              {roles.map(r => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
            {isSelf && <p className="text-xs text-gray-400 mt-1">You cannot change your own role.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <select name="departmentId" defaultValue={departmentId ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">None</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={isPending}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
            {isPending ? "Saving…" : "Save Details"}
          </button>
        </form>
      </section>

      {/* ── App access ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-1">App Access & Permissions</h2>
        <p className="text-sm text-gray-500 mb-5">Choose which apps and hub cards this user can access.</p>
        {role === "ADMIN" ? (
          <p className="text-sm text-gray-500 italic">Admin users have access to all apps with full permissions.</p>
        ) : (
          <>
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
                            <p className="text-xs text-gray-400 mt-1">
                              {warehouseRole === "warehouse" && "Can use Inbound, Locate, and Lookup."}
                              {warehouseRole === "manager" && "Can also view Customers, Receipts, and History."}
                              {warehouseRole === "admin" && "Full access including Reports."}
                            </p>
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
                                      onClick={() => toggleAppSection(item.key, s.key)}
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

            <div className="flex items-center gap-3">
              <button onClick={saveApps} disabled={appsPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                {appsPending ? "Saving…" : "Save App Access"}
              </button>
              {appsMsg && <span className={`text-sm ${appsMsg === "Saved" ? "text-green-600" : "text-red-500"}`}>{appsMsg}</span>}
            </div>
          </>
        )}
      </section>

      {/* ── Password ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-1">Password</h2>
        <p className="text-sm text-gray-500 mb-4">Reset this user's password.</p>
        {!pwdOpen ? (
          <button onClick={() => setPwdOpen(true)}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:border-gray-400 transition-colors">
            Change Password
          </button>
        ) : (
          <form onSubmit={savePassword} className="flex flex-col gap-3 max-w-sm">
            <div className="relative">
              <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="New password" minLength={8} required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="button" onClick={() => setShowPwd(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs px-1">
                {showPwd ? "Hide" : "Show"}
              </button>
            </div>
            <div className="relative">
              <input type={showPwd ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Confirm password" required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {pwdError && <p className="text-xs text-red-500">{pwdError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={pwdPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                {pwdPending ? "Saving…" : "Update Password"}
              </button>
              <button type="button" onClick={() => { setPwdOpen(false); setPwdError(null); setShowPwd(false) }}
                className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:border-gray-400 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

    </div>
  )
}
