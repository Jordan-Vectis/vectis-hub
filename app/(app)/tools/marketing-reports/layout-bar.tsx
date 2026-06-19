"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  createMarketingLayout, updateMarketingLayout, deleteMarketingLayout, setDefaultMarketingLayout,
} from "@/lib/actions/marketing-layouts"

type Layout = { id: string; name: string; sections: string[]; isDefault: boolean }
type CatalogItem = { id: string; title: string }
type EditItem = { id: string; title: string; on: boolean }

export default function LayoutBar({
  layouts,
  activeId,
  catalog,
  isAdmin,
}: {
  layouts: Layout[]
  activeId: string | null
  catalog: CatalogItem[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const titleOf = Object.fromEntries(catalog.map((c) => [c.id, c.title]))

  // ── Switcher (all users) ───────────────────────────────────────────────────
  const active = layouts.find((l) => l.id === activeId) ?? layouts.find((l) => l.isDefault) ?? layouts[0] ?? null

  function pick(id: string) {
    document.cookie = `mr_layout=${id}; path=/; max-age=${60 * 60 * 24 * 365}`
    router.refresh()
  }

  // ── Editor (admin) ─────────────────────────────────────────────────────────
  const [open, setOpen]   = useState(false)
  const [editId, setEdit] = useState<string | null>(null)
  const [name, setName]   = useState("")
  const [items, setItems] = useState<EditItem[]>([])
  const [busy, setBusy]   = useState(false)
  const dragKey = useRef<string | null>(null)

  function itemsFor(layout: Layout | null): EditItem[] {
    const ids = layout ? layout.sections.filter((id) => titleOf[id]) : catalog.map((c) => c.id)
    const on = ids.map((id) => ({ id, title: titleOf[id], on: true }))
    const off = catalog.filter((c) => !ids.includes(c.id)).map((c) => ({ id: c.id, title: c.title, on: false }))
    return [...on, ...off]
  }

  function load(layout: Layout | null) {
    setEdit(layout?.id ?? null)
    setName(layout?.name ?? "")
    setItems(itemsFor(layout))
  }

  function openEditor() {
    load(active)
    setOpen(true)
  }

  function dragOver(e: React.DragEvent, key: string) {
    e.preventDefault()
    if (!dragKey.current || dragKey.current === key) return
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === dragKey.current)
      const to   = prev.findIndex((i) => i.id === key)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it)
      return next
    })
  }

  const selected = items.filter((i) => i.on).map((i) => i.id)

  async function run(fn: () => Promise<any>) {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  async function saveNew() {
    const n = name.trim() || "Untitled layout"
    await run(async () => {
      const { id } = await createMarketingLayout(n, selected)
      pick(id)               // switch to the new layout
    })
    setOpen(false)
  }
  async function saveUpdate() {
    if (!editId) return
    await run(() => updateMarketingLayout(editId, name.trim() || "Untitled layout", selected))
    router.refresh()
    setOpen(false)
  }
  async function makeDefault() {
    if (!editId) return
    await run(() => setDefaultMarketingLayout(editId))
    router.refresh()
  }
  async function remove() {
    if (!editId) return
    if (!confirm("Delete this layout?")) return
    await run(() => deleteMarketingLayout(editId))
    router.refresh()
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-2">
      {/* Switcher */}
      {layouts.length > 0 && (
        <select
          value={active?.id ?? ""}
          onChange={(e) => pick(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-700 dark:text-gray-200 border-none focus:outline-none focus:ring-2 focus:ring-pink-500 cursor-pointer"
          title="Switch layout"
        >
          {layouts.map((l) => (
            <option key={l.id} value={l.id}>{l.isDefault ? "★ " : ""}{l.name}</option>
          ))}
        </select>
      )}

      {isAdmin && (
        <button
          onClick={openEditor}
          className="px-3.5 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          ⚙ Layouts
        </button>
      )}

      {/* Editor modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-[#1C1C1E] w-full max-w-lg rounded-2xl border border-gray-200 dark:border-gray-800 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Report layouts</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
            </div>

            {/* Which layout to edit */}
            <div className="flex items-center gap-2 mb-3">
              <select
                value={editId ?? "__new__"}
                onChange={(e) => load(e.target.value === "__new__" ? null : layouts.find((l) => l.id === e.target.value) ?? null)}
                className="flex-1 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="__new__">+ New layout</option>
                {layouts.map((l) => <option key={l.id} value={l.id}>{l.isDefault ? "★ " : ""}{l.name}</option>)}
              </select>
              {editId && (
                <button onClick={makeDefault} disabled={busy} className="text-xs font-semibold text-gray-500 hover:text-yellow-500 px-2 py-2 whitespace-nowrap" title="Make this the default layout everyone sees">★ Set default</button>
              )}
            </div>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Layout name"
              className="w-full mb-3 px-3 py-2 rounded-xl text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-pink-500"
            />

            <p className="text-xs text-gray-400 mb-2">Drag to reorder · tick to include. The order here is the order the tiles appear.</p>
            <div className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
              {items.map((it) => (
                <div
                  key={it.id}
                  draggable
                  onDragStart={() => { dragKey.current = it.id }}
                  onDragOver={(e) => dragOver(e, it.id)}
                  onDragEnd={() => { dragKey.current = null }}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border ${it.on ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" : "border-dashed border-gray-300 dark:border-gray-700 opacity-60"}`}
                >
                  <span className="cursor-grab text-gray-300 hover:text-gray-500 select-none">⠿</span>
                  <input
                    type="checkbox"
                    checked={it.on}
                    onChange={() => setItems((prev) => prev.map((p) => p.id === it.id ? { ...p, on: !p.on } : p))}
                    className="w-4 h-4 accent-pink-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-200">{it.title}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex-wrap">
              {editId && <button onClick={saveUpdate} disabled={busy} className="bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">Save changes</button>}
              <button onClick={saveNew} disabled={busy} className={`${editId ? "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700" : "bg-pink-600 hover:bg-pink-700 text-white"} text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50`}>Save as new</button>
              {editId && <button onClick={remove} disabled={busy} className="ml-auto text-sm text-red-500 hover:text-red-700 font-semibold">Delete</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
