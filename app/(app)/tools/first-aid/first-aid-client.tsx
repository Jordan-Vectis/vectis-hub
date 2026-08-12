"use client"

import { useState, useTransition } from "react"
import { saveFirstAider, deleteFirstAider, saveFirstAidKit, deleteFirstAidKit, saveFirstAidInfo, setAccidentReportStatus } from "@/lib/actions/first-aid"

type Aider  = { id: string; name: string; roleTitle: string | null; location: string | null; phone: string | null; photoKey: string | null; sortOrder: number; active: boolean }
type Kit    = { id: string; kind: string; label: string; whereText: string | null; photoKey: string | null; sortOrder: number; active: boolean }
type Info   = { emergencySteps: string | null; siteAddress: string | null; assemblyPoint: string | null; extraNotes: string | null } | null
type Report = { id: string; reporterName: string; reporterPhone: string | null; injuredName: string | null; happenedAt: string | null; location: string | null; description: string; status: string; handledBy: string | null; createdAt: string }

const TABS = [["emergency", "Emergency info"], ["aiders", "First aiders"], ["kits", "Kits & equipment"], ["reports", "Accident reports"]] as const
const KINDS = [["KIT", "🧰 First aid kit"], ["DEFIB", "⚡ Defibrillator"], ["EYEWASH", "💧 Eyewash"], ["OTHER", "📍 Other"]] as const

export default function FirstAidClient({ aiders, kits, info, reports }: { aiders: Aider[]; kits: Kit[]; info: Info; reports: Report[] }) {
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
            Sent from the public page. These are never shown publicly — only here.
          </p>
          {reports.length === 0 && <p className={card + " text-sm text-gray-500 dark:text-gray-400"}>No accident reports yet.</p>}
          {reports.map(r => (
            <div key={r.id} className={`${card} ${r.status === "NEW" ? "border-amber-400 dark:border-amber-600" : ""}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-bold text-gray-900 dark:text-white">
                    {r.reporterName}{r.reporterPhone ? ` · ${r.reporterPhone}` : ""}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Sent {new Date(r.createdAt).toLocaleString("en-GB")}
                    {r.happenedAt ? ` · happened ${r.happenedAt}` : ""}
                    {r.location ? ` · ${r.location}` : ""}
                    {r.injuredName ? ` · hurt: ${r.injuredName}` : ""}
                  </p>
                </div>
                {r.status === "NEW" ? (
                  <button onClick={() => run(() => setAccidentReportStatus(r.id, "REVIEWED"), "Marked as looked at.")}
                    className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-bold rounded-lg">Mark as looked at</button>
                ) : (
                  <button onClick={() => run(() => setAccidentReportStatus(r.id, "NEW"), "Reopened.")}
                    className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-500 text-xs font-bold rounded-lg">
                    ✓ {r.handledBy ?? "Done"} — reopen
                  </button>
                )}
              </div>
              <p className="mt-3 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{r.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
