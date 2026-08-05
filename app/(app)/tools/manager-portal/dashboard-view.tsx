"use client"

// Manager Portal → Dashboard. The frame: arrange widgets, and draw whatever
// each widget's route sends back.
//
// Deliberately an ORDERED FLOW, not a free x/y canvas — drag to reorder, pick a
// width per card. It survives a tablet, needs no grid library, and reads the
// same to the person using it. Free positioning is a bigger job and was left
// out on purpose; if it's ever wanted it's a swap of this file, not of the
// registry or the routes.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  SIZE_CLASS, SIZE_LABEL, GROUP_LABEL,
  type WidgetSize, type WidgetGroup, type DashboardWidgetPlacement, type WidgetPayload,
} from "@/lib/dashboard-widgets"

type Available = {
  key: string; label: string; description: string; group: WidgetGroup
  defaultSize: WidgetSize; sizes: WidgetSize[]; bc: boolean; href: string | null
}

const GROUP_ORDER: WidgetGroup[] = ["sales", "people", "results", "warehouse", "queues", "web"]

export default function DashboardView() {
  const [layout, setLayout]       = useState<DashboardWidgetPlacement[]>([])
  const [available, setAvailable] = useState<Available[]>([])
  const [loading, setLoading]     = useState(true)
  const [picking, setPicking]     = useState(false)
  const [error, setError]         = useState("")
  const dragKey = useRef<string | null>(null)

  useEffect(() => {
    fetch("/api/dashboard/layout")
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setLayout(d.widgets ?? [])
        setAvailable(d.available ?? [])
      })
      .catch(() => setError("Couldn't load your dashboard."))
      .finally(() => setLoading(false))
  }, [])

  // Save whenever the arrangement changes. Fire-and-forget with a visible error
  // — a silent failure here means someone rearranges their dashboard, comes back
  // tomorrow and finds it reverted with no idea why.
  const save = useCallback(async (next: DashboardWidgetPlacement[]) => {
    setLayout(next)
    try {
      const res  = await fetch("/api/dashboard/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: next }),
      })
      const json = await res.json()
      setError(res.ok ? "" : (json.error ?? "Couldn't save your layout."))
    } catch {
      setError("Couldn't save your layout.")
    }
  }, [])

  const byKey = Object.fromEntries(available.map(a => [a.key, a]))
  const unused = available.filter(a => !layout.some(l => l.key === a.key))

  function add(key: string) {
    const def = byKey[key]
    if (!def) return
    save([...layout, { key, size: def.defaultSize }])
    setPicking(false)
  }

  function remove(key: string) {
    save(layout.filter(l => l.key !== key))
  }

  function resize(key: string) {
    const def = byKey[key]
    if (!def) return
    save(layout.map(l => {
      if (l.key !== key) return l
      const i = def.sizes.indexOf(l.size)
      return { ...l, size: def.sizes[(i + 1) % def.sizes.length] }
    }))
  }

  function onDragOver(e: React.DragEvent, key: string) {
    e.preventDefault()
    const from = dragKey.current
    if (!from || from === key) return
    setLayout(prev => {
      const fromIdx = prev.findIndex(l => l.key === from)
      const toIdx   = prev.findIndex(l => l.key === key)
      if (fromIdx < 0 || toIdx < 0) return prev
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
  }

  if (loading) return <div className="text-sm text-gray-500 dark:text-gray-400">Loading your dashboard…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPicking(p => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <span className="text-base leading-none">+</span> Add
          </button>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Drag a card by its handle to reorder · click the size button to change its width
          </span>
        </div>
        {error && <span className="text-xs text-amber-600 dark:text-amber-400">{error}</span>}
      </div>

      {picking && (
        <div className="mb-6 border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/50">
          {unused.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Everything you have access to is already on your dashboard.</p>
          ) : (
            GROUP_ORDER.map(group => {
              const items = unused.filter(a => a.group === group)
              if (items.length === 0) return null
              return (
                <div key={group} className="mb-4 last:mb-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">{GROUP_LABEL[group]}</span>
                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map(a => (
                      <button
                        key={a.key}
                        onClick={() => add(a.key)}
                        className="text-left border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg p-3 hover:border-slate-400 dark:hover:border-slate-500 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">{a.label}</span>
                          {a.bc && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium">BC</span>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{a.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {layout.length === 0 ? (
        <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-10 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing on your dashboard yet — click <span className="font-semibold">+ Add</span> to put something on it.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          {layout.map(item => {
            const def = byKey[item.key]
            if (!def) return null      // retired widget, or access removed
            return (
              <div
                key={item.key}
                onDragOver={e => onDragOver(e, item.key)}
                onDrop={() => { dragKey.current = null; save(layout) }}
                className={SIZE_CLASS[item.size]}
              >
                <WidgetCard
                  def={def}
                  size={item.size}
                  onDragStart={() => { dragKey.current = item.key }}
                  onDragEnd={() => { dragKey.current = null }}
                  onRemove={() => remove(item.key)}
                  onResize={() => resize(item.key)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── One card ────────────────────────────────────────────────────────────────
// Each fetches its own data. Ten widgets rendered server-side would mean the
// slowest query owns the page, and the BC-backed ones can take tens of seconds.
// This way a slow card spins on its own while the rest are already readable.

function WidgetCard({
  def, size, onDragStart, onDragEnd, onRemove, onResize,
}: {
  def: Available
  size: WidgetSize
  onDragStart: () => void
  onDragEnd: () => void
  onRemove: () => void
  onResize: () => void
}) {
  const [data, setData]   = useState<WidgetPayload | null>(null)
  const [err, setErr]     = useState("")
  const [busy, setBusy]   = useState(true)

  const load = useCallback(() => {
    setBusy(true)
    setErr("")
    fetch(`/api/dashboard/widgets/${def.key}`)
      .then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else setData(d) })
      .catch(() => setErr("Couldn't load"))
      .finally(() => setBusy(false))
  }, [def.key])

  useEffect(() => { load() }, [load])

  return (
    <div className="h-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col">
      <div className="flex items-start gap-2 mb-3">
        <div
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none text-lg leading-none mt-0.5"
          title="Drag to reorder"
        >
          ⠿
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{def.label}</h3>
            {def.bc && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium shrink-0">BC</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={load} title="Refresh" className="text-gray-300 hover:text-gray-500 text-xs px-1">↻</button>
          {def.sizes.length > 1 && (
            <button onClick={onResize} title={`Width: ${SIZE_LABEL[size]} — click to change`} className="text-gray-300 hover:text-gray-500 text-xs px-1">⇔</button>
          )}
          <button onClick={onRemove} title="Remove from dashboard" className="text-gray-300 hover:text-red-500 text-xs px-1">✕</button>
        </div>
      </div>

      <div className="flex-1">
        {busy && <div className="text-xs text-gray-400 dark:text-gray-500">Loading…</div>}
        {!busy && err && <div className="text-xs text-amber-600 dark:text-amber-400">{err}</div>}
        {!busy && !err && data && <WidgetBodyView payload={data} />}
      </div>

      {def.href && (
        <Link href={def.href} className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-3 shrink-0">
          Open the full report →
        </Link>
      )}
    </div>
  )
}

// ─── The five shapes ─────────────────────────────────────────────────────────

function WidgetBodyView({ payload }: { payload: WidgetPayload }) {
  const empty = (
    <p className="text-xs text-gray-400 dark:text-gray-500">{payload.empty ?? "Nothing to show."}</p>
  )

  let body: React.ReactNode = null

  if (payload.kind === "stat") {
    body = (
      <div>
        <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{payload.value}</div>
        {payload.sub && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{payload.sub}</div>}
        {payload.delta && (
          <div className={`text-xs mt-1 font-medium ${payload.delta.good ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {payload.delta.text}
          </div>
        )}
      </div>
    )
  }

  if (payload.kind === "stats") {
    body = payload.items.length === 0 ? empty : (
      <div className="grid grid-cols-2 gap-3">
        {payload.items.map((s, i) => (
          <div key={i}>
            <div className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{s.value}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
            {s.sub && <div className="text-[11px] text-gray-400 dark:text-gray-500">{s.sub}</div>}
          </div>
        ))}
      </div>
    )
  }

  if (payload.kind === "list") {
    body = payload.rows.length === 0 ? empty : (
      <ul className="space-y-1.5">
        {payload.rows.map((r, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-gray-700 dark:text-gray-300 truncate">
              {r.href ? <Link href={r.href} className="hover:underline">{r.label}</Link> : r.label}
              {r.sub && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">{r.sub}</span>}
            </span>
            <span className="font-semibold text-gray-900 dark:text-white tabular-nums shrink-0">{r.value}</span>
          </li>
        ))}
      </ul>
    )
  }

  if (payload.kind === "bars") {
    const max = Math.max(1, ...payload.rows.map(r => r.value))
    body = payload.rows.length === 0 ? empty : (
      <div className="space-y-1.5">
        {payload.rows.map((r, i) => (
          <div key={i}>
            <div className="flex items-baseline justify-between gap-3 text-xs mb-0.5">
              <span className="text-gray-600 dark:text-gray-400 truncate">{r.label}</span>
              <span className="font-semibold text-gray-900 dark:text-white tabular-nums shrink-0">{r.display ?? r.value}</span>
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (payload.kind === "table") {
    const align = payload.align ?? []
    // Wide tables scroll inside the card — the dashboard itself must never
    // scroll sideways.
    body = payload.rows.length === 0 ? empty : (
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 dark:text-gray-500">
              {payload.columns.map((c, i) => (
                <th key={i} className={`font-medium px-1 pb-1.5 whitespace-nowrap ${align[i] === "right" ? "text-right" : "text-left"}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((row, ri) => (
              <tr key={ri} className="border-t border-gray-100 dark:border-gray-800">
                {row.map((cell, ci) => (
                  <td key={ci} className={`px-1 py-1.5 whitespace-nowrap ${align[ci] === "right" ? "text-right tabular-nums" : "text-left"} ${ci === 0 ? "text-gray-900 dark:text-white font-medium" : "text-gray-600 dark:text-gray-400"}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div>
      {body}
      {payload.note && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">{payload.note}</p>}
    </div>
  )
}
