"use client"

import { useState, useTransition } from "react"
import { saveFirstAider, deleteFirstAider, saveFirstAidKit, deleteFirstAidKit, saveFirstAidInfo, setAccidentReportStatus, saveAccidentReportEmployer } from "@/lib/actions/first-aid"
import { setFirstAidKitPin } from "@/lib/actions/site-plan"
import { PIN_ICON, PlanImage } from "@/components/site-plan-view"

type Aider  = { id: string; name: string; roleTitle: string | null; location: string | null; phone: string | null; photoKey: string | null; sortOrder: number; active: boolean }
type Kit    = { id: string; kind: string; label: string; whereText: string | null; photoKey: string | null; sortOrder: number; active: boolean; planId: string | null; pinX: number | null; pinY: number | null }
type Plan   = { id: string; name: string; imageKey: string }
type Info   = { emergencySteps: string | null; siteAddress: string | null; assemblyPoint: string | null; extraNotes: string | null } | null
type Report = {
  id: string; reporterName: string; reporterPhone: string | null; injuredName: string | null
  happenedAt: string | null; location: string | null; description: string; status: string
  handledBy: string | null; createdAt: string
  reporterAddress: string | null; reporterOccupation: string | null
  injuredAddress: string | null; injuredOccupation: string | null
  happenedOn: string | null; injuryDetails: string | null
  reportedOn: string | null; recordedBy: string | null
  riddorReportable: boolean | null; riddorRef: string | null; employerNotes: string | null
}

const TABS = [["emergency", "Emergency info"], ["aiders", "First aiders"], ["kits", "Kits & equipment"], ["reports", "Accident reports"]] as const
const KINDS = [["KIT", "🧰 First aid kit"], ["DEFIB", "⚡ Defibrillator"], ["EYEWASH", "💧 Eyewash"], ["OTHER", "📍 Other"]] as const

export default function FirstAidClient({ aiders, kits, info, reports, plans }: { aiders: Aider[]; kits: Kit[]; info: Info; reports: Report[]; plans: Plan[] }) {
  const [tab, setTab]   = useState<typeof TABS[number][0]>("emergency")
  const [msg, setMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [, start]       = useTransition()
  const newCount = reports.filter(r => r.status === "NEW").length

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null)
    start(async () => {
      const res = await fn()
      setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: res.error ?? "Failed" })
    })
  }

  const input = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-green-600"
  const card  = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5"

  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setMsg(null) }}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === k ? "bg-green-700 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            }`}>
            {label}{k === "reports" && newCount > 0 ? ` (${newCount})` : ""}
          </button>
        ))}
      </div>

      {msg && <p className={`text-sm font-medium ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.ok ? "✓ " : "✗ "}{msg.text}</p>}

      {tab === "emergency" && (
        <form action={fd => run(() => saveFirstAidInfo(fd), "Saved — the public page is updated.")} className={card + " space-y-4"}>
          <div>
            <label className="block text-sm font-semibold mb-1 text-gray-900 dark:text-white">What to do in an emergency</label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">One step per line — they appear as a numbered list.</p>
            <textarea name="emergencySteps" rows={6} defaultValue={info?.emergencySteps ?? ""} maxLength={4000} className={input}
              placeholder={"Find a first aider from the list below\nIf it is serious, ring 999\nGive the address shown here\nSend someone to meet the ambulance"} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1 text-gray-900 dark:text-white">Address to give the ambulance</label>
            <textarea name="siteAddress" rows={3} defaultValue={info?.siteAddress ?? ""} maxLength={500} className={input} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1 text-gray-900 dark:text-white">Assembly point</label>
            <input name="assemblyPoint" defaultValue={info?.assemblyPoint ?? ""} maxLength={200} className={input} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1 text-gray-900 dark:text-white">Anything else worth knowing</label>
            <textarea name="extraNotes" rows={4} defaultValue={info?.extraNotes ?? ""} maxLength={4000} className={input} />
          </div>
          <button className="px-5 py-2.5 bg-green-700 hover:bg-green-600 text-white font-bold rounded-xl text-sm">Save</button>
        </form>
      )}

      {tab === "aiders" && (
        <div className="space-y-4">
          {aiders.map(a => (
            <form key={a.id} action={fd => run(() => saveFirstAider(fd), "First aider saved.")} className={card + " space-y-3"}>
              <input type="hidden" name="id" value={a.id} />
              <div className="flex items-center gap-3">
                {a.photoKey && <img src={`/api/public/photo?key=${encodeURIComponent(a.photoKey)}`} alt="" className="w-12 h-12 rounded-full object-cover" />}
                <input name="name" defaultValue={a.name} maxLength={100} className={input + " flex-1"} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input name="roleTitle" defaultValue={a.roleTitle ?? ""} placeholder="Job / department" maxLength={100} className={input} />
                <input name="location" defaultValue={a.location ?? ""} placeholder="Where to find them" maxLength={150} className={input} />
                <input name="phone" defaultValue={a.phone ?? ""} placeholder="Phone / extension" maxLength={40} className={input} />
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <label className="text-xs text-gray-500 dark:text-gray-400">Order <input type="number" name="sortOrder" defaultValue={a.sortOrder} className="ml-1 w-16 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-sm" /></label>
                <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={a.active} className="accent-green-700" /> Show on the public page</label>
                <label className="text-xs text-gray-500 dark:text-gray-400">Photo <input type="file" name="photo" accept="image/*" className="ml-1 text-xs" /></label>
                <div className="ml-auto flex gap-2">
                  <button className="px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-bold rounded-lg">Save</button>
                  <button type="button" onClick={() => { if (confirm(`Remove ${a.name}?`)) run(() => deleteFirstAider(a.id), "Removed.") }}
                    className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-red-500 hover:border-red-400 text-xs font-bold rounded-lg">Remove</button>
                </div>
              </div>
            </form>
          ))}
          <form action={fd => run(() => saveFirstAider(fd), "First aider added.")} className={card + " space-y-3 border-dashed"}>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Add a first aider</p>
            <input name="name" placeholder="Name" required maxLength={100} className={input} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input name="roleTitle" placeholder="Job / department" maxLength={100} className={input} />
              <input name="location" placeholder="Where to find them" maxLength={150} className={input} />
              <input name="phone" placeholder="Phone / extension" maxLength={40} className={input} />
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="text-xs text-gray-500 dark:text-gray-400">Order <input type="number" name="sortOrder" defaultValue={0} className="ml-1 w-16 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-sm" /></label>
              <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked className="accent-green-700" /> Show on the public page</label>
              <label className="text-xs text-gray-500 dark:text-gray-400">Photo <input type="file" name="photo" accept="image/*" className="ml-1 text-xs" /></label>
              <button className="ml-auto px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-bold rounded-lg">Add</button>
            </div>
          </form>
        </div>
      )}

      {tab === "kits" && (
        <div className="space-y-4">
          <PinEditor plans={plans} kits={kits} card={card} run={run} />
          {kits.map(k => (
            <form key={k.id} action={fd => run(() => saveFirstAidKit(fd), "Location saved.")} className={card + " space-y-3"}>
              <input type="hidden" name="id" value={k.id} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select name="kind" defaultValue={k.kind} className={input}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <input name="label" defaultValue={k.label} maxLength={120} className={input + " sm:col-span-2"} />
              </div>
              <input name="whereText" defaultValue={k.whereText ?? ""} placeholder="Exactly where it is" maxLength={300} className={input} />
              {k.photoKey && <img src={`/api/public/photo?key=${encodeURIComponent(k.photoKey)}`} alt="" className="max-h-32 rounded-lg" />}
              <div className="flex items-center gap-4 flex-wrap">
                <label className="text-xs text-gray-500 dark:text-gray-400">Order <input type="number" name="sortOrder" defaultValue={k.sortOrder} className="ml-1 w-16 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-sm" /></label>
                <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={k.active} className="accent-green-700" /> Show on the public page</label>
                <label className="text-xs text-gray-500 dark:text-gray-400">Photo <input type="file" name="photo" accept="image/*" className="ml-1 text-xs" /></label>
                <div className="ml-auto flex gap-2">
                  <button className="px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-bold rounded-lg">Save</button>
                  <button type="button" onClick={() => { if (confirm(`Remove ${k.label}?`)) run(() => deleteFirstAidKit(k.id), "Removed.") }}
                    className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-red-500 hover:border-red-400 text-xs font-bold rounded-lg">Remove</button>
                </div>
              </div>
            </form>
          ))}
          <form action={fd => run(() => saveFirstAidKit(fd), "Location added.")} className={card + " space-y-3 border-dashed"}>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Add a kit or piece of equipment</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select name="kind" defaultValue="KIT" className={input}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input name="label" placeholder="e.g. Warehouse kit" required maxLength={120} className={input + " sm:col-span-2"} />
            </div>
            <input name="whereText" placeholder="Exactly where it is" maxLength={300} className={input} />
            <div className="flex items-center gap-4 flex-wrap">
              <label className="text-xs text-gray-500 dark:text-gray-400">Order <input type="number" name="sortOrder" defaultValue={0} className="ml-1 w-16 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-sm" /></label>
              <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked className="accent-green-700" /> Show on the public page</label>
              <label className="text-xs text-gray-500 dark:text-gray-400">Photo <input type="file" name="photo" accept="image/*" className="ml-1 text-xs" /></label>
              <button className="ml-auto px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-bold rounded-lg">Add</button>
            </div>
          </form>
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The accident book. Entries arrive from the public page; <strong>Part 4 is yours</strong> — it never
            appears there. Records are normally kept for three years.
          </p>
          {reports.length === 0 && <p className={card + " text-sm text-gray-500 dark:text-gray-400"}>No entries yet.</p>}
          {reports.map(r => <ReportCard key={r.id} r={r} card={card} input={input} run={run} />)}
        </div>
      )}
    </div>
  )
}

// One accident book entry. Parts 1-3 come from the public form and are read-only here; Part 4 is
// the EMPLOYER-ONLY section, which exists nowhere else — the public page never sees it.
function ReportCard({ r, card, input, run }: {
  r: Report; card: string; input: string
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => void
}) {
  const [open, setOpen] = useState(r.status === "NEW")
  const dt = (v: string | null) => v ? new Date(v).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—"
  // datetime-local needs "YYYY-MM-DDTHH:mm" — an ISO string with the seconds and zone trimmed.
  const forInput = (v: string | null) => v ? new Date(v).toISOString().slice(0, 16) : ""
  const when = dt(r.happenedOn) !== "—" ? dt(r.happenedOn) : (r.happenedAt || "—")
  const Row = ({ label, value }: { label: string; value: string | null }) => (
    <div className="py-1">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{value?.trim() || "—"}</p>
    </div>
  )
  const head = "text-xs font-bold uppercase tracking-wider text-green-700 dark:text-green-500 border-b border-gray-200 dark:border-gray-700 pb-1 mb-1"

  return (
    <div className={`${card} ${r.status === "NEW" ? "border-amber-400 dark:border-amber-600" : ""}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-bold text-gray-900 dark:text-white">
            {r.injuredName?.trim() || r.reporterName}
            {r.status === "SUSPECT" && (
              <span className="ml-2 text-xs font-semibold text-amber-700 dark:text-amber-400">⚠ flagged — check this is genuine</span>
            )}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Happened {when}{r.location ? ` · ${r.location}` : ""} · reported by {r.reporterName} on {dt(r.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {r.status === "REVIEWED" && (
            <span className="text-xs text-green-600">✓ completed{r.handledBy ? ` by ${r.handledBy}` : ""}</span>
          )}
          <button onClick={() => setOpen(o => !o)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs font-bold rounded-lg">
            {open ? "Hide" : "Open"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <div>
              <p className={head}>Part 1 — injured person</p>
              <Row label="Name" value={r.injuredName || r.reporterName} />
              <Row label="Job" value={r.injuredOccupation || r.reporterOccupation} />
              <Row label="Address" value={r.injuredAddress || r.reporterAddress} />
            </div>
            <div>
              <p className={head}>Part 2 — reported by</p>
              <Row label="Name" value={r.reporterName} />
              <Row label="Job" value={r.reporterOccupation} />
              <Row label="Phone" value={r.reporterPhone} />
            </div>
          </div>

          <div>
            <p className={head}>Part 3 — the accident</p>
            <Row label="When" value={when} />
            <Row label="Where" value={r.location} />
            <Row label="How it happened" value={r.description} />
            <Row label="The injury" value={r.injuryDetails} />
          </div>

          <form action={fd => run(() => saveAccidentReportEmployer(r.id, fd), "Part 4 saved — entry completed.")}
            className="rounded-xl border-2 border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-green-400">
              Part 4 — for the employer only
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-gray-600 dark:text-gray-300">Date reported
                <input type="datetime-local" name="reportedOn" defaultValue={forInput(r.reportedOn)} className={input + " mt-1"} />
              </label>
              <label className="text-xs text-gray-600 dark:text-gray-300">Recorded by
                <input name="recordedBy" defaultValue={r.recordedBy ?? ""} placeholder="your name" maxLength={100} className={input + " mt-1"} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-gray-600 dark:text-gray-300">Reportable under RIDDOR?
                <select name="riddorReportable"
                  defaultValue={r.riddorReportable === true ? "yes" : r.riddorReportable === false ? "no" : ""}
                  className={input + " mt-1"}>
                  <option value="">Not decided yet</option>
                  <option value="yes">Yes — reported to HSE</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="text-xs text-gray-600 dark:text-gray-300">HSE reference
                <input name="riddorRef" defaultValue={r.riddorRef ?? ""} maxLength={100} className={input + " mt-1"} />
              </label>
            </div>
            <label className="block text-xs text-gray-600 dark:text-gray-300">Notes / action taken
              <textarea name="employerNotes" rows={3} defaultValue={r.employerNotes ?? ""} maxLength={4000} className={input + " mt-1"} />
            </label>
            <div className="flex items-center gap-2">
              <button className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-xs font-bold rounded-lg">Save Part 4</button>
              {r.status === "REVIEWED" && (
                <button type="button" onClick={() => run(() => setAccidentReportStatus(r.id, "NEW"), "Reopened.")}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-500 text-xs font-bold rounded-lg">Reopen</button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

// Marking kits onto the shared site plan. Positions are percentages, so a pin lands in the same
// place whatever the plan is displayed at — see components/site-plan-view.
function PinEditor({ plans, kits, card, run }: {
  plans: Plan[]; kits: Kit[]; card: string
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => void
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "")
  const [placing, setPlacing] = useState<string | null>(null)
  const plan = plans.find(p => p.id === planId)

  if (plans.length === 0) {
    return (
      <div className={card + " text-sm text-gray-500 dark:text-gray-400"}>
        No site plan uploaded yet — add one in <a href="/tools/site-plan" className="text-sky-600 hover:underline">Site Plan</a>,
        then come back to mark where each kit is.
      </div>
    )
  }

  const onPlan = kits.filter(k => k.planId === planId && k.pinX !== null && k.pinY !== null)
  const off    = kits.filter(k => k.planId !== planId || k.pinX === null)

  return (
    <div className={card + " space-y-3"}>
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-sm font-bold text-gray-900 dark:text-white">🗺️ Where things are</p>
        {plans.length > 1 && (
          <select value={planId} onChange={e => { setPlanId(e.target.value); setPlacing(null) }}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-xs">
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {placing
          ? <span className="text-xs font-semibold text-sky-600">Click the plan to place &quot;{kits.find(k => k.id === placing)?.label}&quot; — or press Escape</span>
          : <span className="text-xs text-gray-500 dark:text-gray-400">Pick an item below, then click the plan.</span>}
        {placing && (
          <button onClick={() => setPlacing(null)} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
        )}
      </div>

      {plan && (
        <PlanImage
          imageKey={plan.imageKey}
          alt={plan.name}
          onPick={placing ? (x, y) => {
            const id = placing
            setPlacing(null)
            run(() => setFirstAidKitPin(id, planId, x, y), "Marked on the plan.")
          } : undefined}
        >
          {onPlan.map(k => (
            <span key={k.id} style={{ left: `${k.pinX}%`, top: `${k.pinY}%` }} title={k.label}
              className="absolute -translate-x-1/2 -translate-y-1/2 text-2xl drop-shadow">
              {PIN_ICON[k.kind] ?? "📍"}
            </span>
          ))}
        </PlanImage>
      )}

      <div className="flex flex-wrap gap-2">
        {kits.map(k => {
          const isOn = onPlan.some(o => o.id === k.id)
          return (
            <span key={k.id} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
              isOn ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20" : "border-gray-300 dark:border-gray-600"
            }`}>
              <span>{PIN_ICON[k.kind] ?? "📍"}</span>
              <span className="text-gray-800 dark:text-gray-200">{k.label}</span>
              <button onClick={() => setPlacing(k.id)} className="text-sky-600 hover:underline font-semibold">
                {isOn ? "move" : "place"}
              </button>
              {isOn && (
                <button onClick={() => run(() => setFirstAidKitPin(k.id, null, null, null), "Taken off the plan.")}
                  className="text-gray-400 hover:text-red-500">✕</button>
              )}
            </span>
          )
        })}
      </div>
      {off.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{off.length} not on this plan yet.</p>
      )}
    </div>
  )
}
