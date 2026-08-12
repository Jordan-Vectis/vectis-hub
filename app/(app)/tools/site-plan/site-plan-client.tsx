"use client"

import { useState, useTransition } from "react"
import { saveSitePlan, deleteSitePlan } from "@/lib/actions/site-plan"
import { PIN_ICON, PlanImage } from "@/components/site-plan-view"

type Plan = { id: string; name: string; imageKey: string; active: boolean; sortOrder: number }
type Kit  = { id: string; kind: string; label: string; planId: string; pinX: number; pinY: number }

export default function SitePlanClient({ plans, kits }: { plans: Plan[]; kits: Kit[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [, start] = useTransition()

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null)
    start(async () => {
      const res = await fn()
      setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: res.error ?? "Failed" })
    })
  }

  const input = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-sky-500"
  const card  = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5"

  return (
    <div className="space-y-5">
      {msg && <p className={`text-sm font-medium ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.ok ? "✓ " : "✗ "}{msg.text}</p>}

      {plans.map(p => {
        const pins = kits.filter(k => k.planId === p.id)
        return (
          <div key={p.id} className={card + " space-y-3"}>
            <form action={fd => run(() => saveSitePlan(fd), "Plan saved.")} className="space-y-3">
              <input type="hidden" name="id" value={p.id} />
              <div className="flex items-center gap-3 flex-wrap">
                <input name="name" defaultValue={p.name} maxLength={120} className={input + " flex-1 min-w-[12rem]"} />
                <label className="text-xs text-gray-500 dark:text-gray-400">Order <input type="number" name="sortOrder" defaultValue={p.sortOrder} className="ml-1 w-16 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-sm" /></label>
                <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={p.active} className="accent-sky-600" /> In use</label>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-gray-500 dark:text-gray-400">Replace the drawing <input type="file" name="image" accept="image/png,image/jpeg,image/webp" className="ml-1 text-xs" /></label>
                <div className="ml-auto flex gap-2">
                  <button className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg">Save</button>
                  <button type="button"
                    onClick={() => { if (confirm(`Delete "${p.name}"? Any pins on it are cleared.`)) run(() => deleteSitePlan(p.id), "Plan deleted.") }}
                    className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-red-500 hover:border-red-400 text-xs font-bold rounded-lg">Delete</button>
                </div>
              </div>
            </form>

            <PlanImage imageKey={p.imageKey} alt={p.name}>
              {pins.map(k => (
                <span key={k.id}
                  style={{ left: `${k.pinX}%`, top: `${k.pinY}%` }}
                  title={k.label}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-2xl drop-shadow">
                  {PIN_ICON[k.kind] ?? "📍"}
                </span>
              ))}
            </PlanImage>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {pins.length === 0
                ? "Nothing marked on this plan yet — pin first aid equipment from the First Aid app."
                : `${pins.length} item${pins.length === 1 ? "" : "s"} marked. Move them from the app that owns them.`}
            </p>
          </div>
        )
      })}

      <form action={fd => run(() => saveSitePlan(fd), "Plan added.")} className={card + " space-y-3 border-dashed"}>
        <p className="text-sm font-bold text-gray-900 dark:text-white">Add a plan</p>
        <input name="name" placeholder="e.g. Master plan" required maxLength={120} className={input} />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          A PNG, JPG or WEBP image — not a PDF. Pins have to sit on a plain image to be tappable on a
          phone, so export the page from the PDF first.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="file" name="image" accept="image/png,image/jpeg,image/webp" required className="text-xs" />
          <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked className="accent-sky-600" /> In use</label>
          <button className="ml-auto px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg">Add</button>
        </div>
      </form>
    </div>
  )
}
