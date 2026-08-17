"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updateUser, changePassword, setUserDepartments } from "@/lib/actions/admin"
import { ALL_APPS, WAREHOUSE_ROLES, APP_SECTIONS } from "@/lib/apps"
import type { AppKey, WarehouseRole } from "@/lib/apps"
import { APP_CARD_DEFS, SECTION_DEFS } from "@/lib/app-cards"

interface Props {
  userId: string
  name: string
  email: string
  username: string | null
  role: string
  departmentIds: string[]
  allowedApps: string[]
  appPermissions: Record<string, any> | null
  showScanTimer: boolean
  showLotTimer: boolean
  manualDescriptions: boolean
  timerRedMins: number
  departments: { id: string; name: string }[]
  roles:       string[]
  isSelf: boolean
}

function roleLabel(key: string): string {
  return key.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

export default function EditUserForm({ userId, name, email, username, role, departmentIds, allowedApps, appPermissions, showScanTimer: initialShowScanTimer, showLotTimer: initialShowLotTimer, manualDescriptions: initialManualDescriptions, timerRedMins: initialRed, departments, roles, isSelf }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Departments are saved on their own — a person can be in more than one, and
  // the details form above doesn't carry them.
  const [depts, setDepts] = useState<string[]>(departmentIds)
  const [deptPending, startDeptTransition] = useTransition()
  const [deptMsg, setDeptMsg] = useState<string | null>(null)

  function saveDepartments() {
    setDeptMsg(null)
    startDeptTransition(async () => {
      const res = await setUserDepartments(userId, depts)
      setDeptMsg(res.ok ? "Saved" : (res.error ?? "Could not save departments."))
      if (res.ok) router.refresh()
    })
  }
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

  // Hub card visibility — only applies to allUsers cards.
  // "configured" = the HUB_CARDS key exists in appPermissions, even if its
  // 'visible' array is empty. Empty means "deliberately no cards", so we must
  // respect that. Earlier code treated [] as "not yet set" and silently
  // reverted unticks back to all-on — that bug now fixed by using key presence.
  const ALL_USER_CARD_KEYS = APP_CARD_DEFS.filter(c => c.allUsers).map(c => c.key)
  const hubCardsConfigured = (appPermissions as any)?.HUB_CARDS !== undefined
  const storedHubCards     = (appPermissions as any)?.HUB_CARDS?.visible as string[] | undefined
  const [hubCards, setHubCards] = useState<string[]>(
    hubCardsConfigured ? (storedHubCards ?? []) : ALL_USER_CARD_KEYS
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

  // Cataloguing settings
  const [showScanTimer,    setShowScanTimer]    = useState(initialShowScanTimer)
  const [showLotTimer,     setShowLotTimer]     = useState(initialShowLotTimer)
  const [manualDescriptions, setManualDescriptions] = useState(initialManualDescriptions)
  const [timerRedMins,     setTimerRedMins]     = useState(initialRed)
  const [catPending, startCatTransition]        = useTransition()
  const [catMsg, setCatMsg]                     = useState<string | null>(null)

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

  function saveCataloguing() {
    setCatMsg(null)
    startCatTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showScanTimer, showLotTimer, timerRedMins, manualDescriptions }),
      })
      setCatMsg(res.ok ? "Saved" : "Failed to save")
      if (res.ok) setTimeout(() => setCatMsg(null), 2000)
    })
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Basic details ── */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Basic Details</h2>
        <form onSubmit={saveDetails} className="flex flex-col gap-4 max-w-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full name</label>
            <input name="name" defaultValue={name} required
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input name="username" defaultValue={username ?? ""} placeholder="First.Last"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Used to log in instead of email</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input name="email" type="email" defaultValue={email} required
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
            <select name="role" defaultValue={role} disabled={isSelf}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 dark:disabled:bg-gray-900 disabled:text-gray-400 dark:disabled:text-gray-500">
              {roles.map(r => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
            {isSelf && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">You cannot change your own role.</p>}
          </div>
          <button type="submit" disabled={isPending}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
            {isPending ? "Saving…" : "Save Details"}
          </button>
        </form>
      </section>

      {/* ── Departments ── */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Departments</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Which departments this person works in — tick more than one if they cover several.
          They&apos;ll only see sales belonging to these departments. Ticking none means they see every sale.
        </p>

        {departments.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">
            No departments set up yet — create them under Admin → Departments.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {departments.map(d => {
                const checked = depts.includes(d.id)
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDepts(prev => prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id])}
                    className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                      checked
                        ? "bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300 font-medium"
                        : "bg-transparent border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400"
                    }`}
                  >
                    {checked ? "✓ " : ""}{d.name}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={saveDepartments}
                disabled={deptPending}
                className="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {deptPending ? "Saving…" : "Save Departments"}
              </button>
              {depts.length === 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">No departments — this person sees every sale.</span>
              )}
              {deptMsg && (
                <span className={`text-xs ${deptMsg === "Saved" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {deptMsg}
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── App access ── */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-200 mb-1">App Access & Permissions</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Choose which apps and hub cards this user can access.</p>
        {role === "ADMIN" ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">Admin users have access to all apps with full permissions.</p>
        ) : (
          <>
            <div className="flex flex-col gap-6 mb-6">
              {sections.map(section => (
                <div key={section.key}>
                  <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">{section.label}</p>
                  <div className="flex flex-col gap-3">
                    {section.items.map(item => (
                      <div key={item.key}>
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <div
                            onClick={() => item.type === "app" ? toggleApp(item.key as AppKey) : toggleHubCard(item.key)}
                            className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                              (item.type === "app" ? selectedApps.includes(item.key) : hubCards.includes(item.key))
                                ? "bg-blue-600 border-blue-600"
                                : "border-gray-300 dark:border-gray-600 group-hover:border-blue-400"
                            }`}
                          >
                            {(item.type === "app" ? selectedApps.includes(item.key) : hubCards.includes(item.key)) && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white font-medium">
                            {item.icon && <span className="mr-1">{item.icon}</span>}{item.label}
                          </span>
                        </label>

                        {item.type === "app" && item.key === "WAREHOUSE" && selectedApps.includes("WAREHOUSE") && (
                          <div className="ml-8 mt-2">
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Warehouse Role</label>
                            <select
                              value={warehouseRole}
                              onChange={e => setWarehouseRole(e.target.value as WarehouseRole)}
                              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {WAREHOUSE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                              {warehouseRole === "warehouse" && "Can use Inbound, Locate, and Lookup."}
                              {warehouseRole === "manager" && "Can also view Customers, Receipts, and History."}
                              {warehouseRole === "admin" && "Full access including Reports."}
                            </p>
                          </div>
                        )}

                        {item.type === "app" && APP_SECTIONS[item.key as AppKey] && selectedApps.includes(item.key) && (
                          <div className="ml-8 mt-2">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Visible sections</p>
                            <div className="flex flex-col gap-2">
                              {APP_SECTIONS[item.key as AppKey]!.map(s => {
                                const checked = (appSections[item.key] ?? []).includes(s.key)
                                return (
                                  <label key={s.key} className="flex items-center gap-2 cursor-pointer group">
                                    <div
                                      onClick={() => toggleAppSection(item.key, s.key)}
                                      className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                                        checked ? "bg-blue-50 dark:bg-blue-900/200 border-blue-500" : "border-gray-300 dark:border-gray-600 group-hover:border-blue-400"
                                      }`}
                                    >
                                      {checked && (
                                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                      )}
                                    </div>
                                    <span className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white">{s.label}</span>
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

      {/* ── Cataloguing settings ── */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Cataloguing Settings</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Controls for the lot wizard and cataloguing tools.</p>
        <div className="flex flex-col gap-4">
          {/* Away / activity prompt — the "what were you doing?" popup after a long gap. */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => setShowScanTimer(v => !v)}
              className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                showScanTimer ? "bg-blue-600 border-blue-600" : "border-gray-300 dark:border-gray-600 group-hover:border-blue-400"
              }`}
            >
              {showScanTimer && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div>
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Away / activity prompt</span>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Asks this user what they were doing when they start a new lot after a long gap. Working hours only.</p>
            </div>
          </label>

          {/* The little blue count-up timer shown while cataloguing a lot — separate toggle, off by default. */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => setShowLotTimer(v => !v)}
              className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                showLotTimer ? "bg-blue-600 border-blue-600" : "border-gray-300 dark:border-gray-600 group-hover:border-blue-400"
              }`}
            >
              {showLotTimer && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div>
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Lot make timer (blue)</span>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Shows a little blue count-up timer while this user is cataloguing a lot, starting when the barcode is entered.</p>
            </div>
          </label>

          {/* ⚠ Added at the BOTTOM of this section — RULES.md rule 6. */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => setManualDescriptions(v => !v)}
              className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors cursor-pointer ${
                manualDescriptions ? "bg-blue-600 border-blue-600" : "border-gray-300 dark:border-gray-600 group-hover:border-blue-400"
              }`}
            >
              {manualDescriptions && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div>
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Writes their own descriptions (exclude from AI)</span>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                The wizard hides Key Points for this user and asks for the description directly, and <strong>every lot they
                create is marked excluded from AI</strong> — so a hand-written description can never be overwritten by an AI
                run, whether or not anyone remembered to tick the box on the lot.
              </p>
            </div>
          </label>

          {(showScanTimer || showLotTimer) && (
            <div className="ml-8 space-y-2 max-w-md">
              <div className="max-w-[10rem]">
                <label className="block text-xs font-medium text-red-500 mb-1">⏱ Warn after (mins)</label>
                <input
                  type="number" min={1} max={120}
                  value={timerRedMins}
                  onChange={e => setTimerRedMins(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                One number does both jobs: the lot timer turns red after this long, and when this user starts a
                new lot after a longer gap than this since their last one, they&apos;re asked why. Only working
                hours (Mon–Fri, 9–5) count towards the gap.
              </p>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={saveCataloguing} disabled={catPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
              {catPending ? "Saving…" : "Save Cataloguing Settings"}
            </button>
            {catMsg && <span className={`text-sm ${catMsg === "Saved" ? "text-green-600" : "text-red-500"}`}>{catMsg}</span>}
          </div>
        </div>
      </section>

      {/* ── Password ── */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Password</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Reset this user's password.</p>
        {!pwdOpen ? (
          <button onClick={() => setPwdOpen(true)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:border-gray-400 transition-colors">
            Change Password
          </button>
        ) : (
          <form onSubmit={savePassword} className="flex flex-col gap-3 max-w-sm">
            <div className="relative">
              <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="New password" minLength={8} required
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="button" onClick={() => setShowPwd(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 text-xs px-1">
                {showPwd ? "Hide" : "Show"}
              </button>
            </div>
            <div className="relative">
              <input type={showPwd ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Confirm password" required
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {pwdError && <p className="text-xs text-red-500">{pwdError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={pwdPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                {pwdPending ? "Saving…" : "Update Password"}
              </button>
              <button type="button" onClick={() => { setPwdOpen(false); setPwdError(null); setShowPwd(false) }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-sm rounded-lg hover:border-gray-400 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

    </div>
  )
}
