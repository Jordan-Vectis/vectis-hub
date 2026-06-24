"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  addCategory, renameCategory, deleteCategory, moveCategory,
  addSubcategory, renameSubcategory, deleteSubcategory, moveSubcategory,
} from "@/lib/actions/lot-categories"

type Sub = { id: string; name: string }
type Cat = { id: string; name: string; subcategories: Sub[] }

export default function CategoriesManager({ categories }: { categories: Cat[] }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [newCat, setNewCat] = useState("")
  const [newSub, setNewSub] = useState<Record<string, string>>({})

  const run = (fn: () => Promise<any>) =>
    start(async () => {
      try { await fn() } catch (e: any) { alert(e?.message ?? "Something went wrong") }
      router.refresh()
    })

  const input = "px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
  const arrow = "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 text-xs leading-none px-0.5"
  const iconBtn = "text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"

  function addCat() {
    const n = newCat.trim()
    if (!n) return
    setNewCat("")
    run(() => addCategory(n))
  }
  function renameCat(c: Cat) {
    const n = prompt("Rename category", c.name)
    if (n == null || !n.trim() || n.trim() === c.name) return
    run(() => renameCategory(c.id, n.trim()))
  }
  function addSub(catId: string) {
    const n = (newSub[catId] ?? "").trim()
    if (!n) return
    setNewSub((m) => ({ ...m, [catId]: "" }))
    run(() => addSubcategory(catId, n))
  }
  function renameSub(s: Sub) {
    const n = prompt("Rename subcategory", s.name)
    if (n == null || !n.trim() || n.trim() === s.name) return
    run(() => renameSubcategory(s.id, n.trim()))
  }

  return (
    <div className="space-y-4">
      {/* Add category */}
      <div className="flex items-center gap-2">
        <input value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCat() }} placeholder="New category name…" className={`${input} w-64`} />
        <button onClick={addCat} disabled={busy || !newCat.trim()} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">+ Add category</button>
        <span className="text-xs text-gray-400">{categories.length} categories</span>
      </div>

      {categories.length === 0 && <p className="text-sm text-gray-400">No categories yet — add one above.</p>}

      {categories.map((c, ci) => (
        <div key={c.id} className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
          {/* Category header */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="flex flex-col">
              <button onClick={() => run(() => moveCategory(c.id, "up"))} disabled={busy || ci === 0} className={arrow} title="Move up">▲</button>
              <button onClick={() => run(() => moveCategory(c.id, "down"))} disabled={busy || ci === categories.length - 1} className={arrow} title="Move down">▼</button>
            </div>
            <span className="font-bold text-gray-800 dark:text-gray-100">{c.name}</span>
            <span className="text-xs text-gray-400">{c.subcategories.length} subcategories</span>
            <button onClick={() => renameCat(c)} disabled={busy} className={`${iconBtn} ml-1`}>✏ rename</button>
            <button onClick={() => { if (confirm(`Delete the "${c.name}" category and its ${c.subcategories.length} subcategories? Existing lots keep their category text.`)) run(() => deleteCategory(c.id)) }} disabled={busy} className="text-xs text-red-500 hover:text-red-400 ml-auto">Delete</button>
          </div>

          {/* Subcategories */}
          <div className="flex flex-wrap gap-1.5">
            {c.subcategories.map((s, si) => (
              <span key={s.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-200">
                <button onClick={() => run(() => moveSubcategory(s.id, "up"))} disabled={busy || si === 0} className={arrow} title="Move left">‹</button>
                <span>{s.name}</span>
                <button onClick={() => run(() => moveSubcategory(s.id, "down"))} disabled={busy || si === c.subcategories.length - 1} className={arrow} title="Move right">›</button>
                <button onClick={() => renameSub(s)} disabled={busy} className="text-gray-400 hover:text-emerald-500" title="Rename">✏</button>
                <button onClick={() => { if (confirm(`Delete subcategory "${s.name}"?`)) run(() => deleteSubcategory(s.id)) }} disabled={busy} className="text-gray-400 hover:text-red-500 font-bold" title="Delete">×</button>
              </span>
            ))}
          </div>

          {/* Add subcategory */}
          <div className="flex items-center gap-2 mt-3">
            <input value={newSub[c.id] ?? ""} onChange={(e) => setNewSub((m) => ({ ...m, [c.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") addSub(c.id) }} placeholder="New subcategory…" className={`${input} w-56 text-xs py-1`} />
            <button onClick={() => addSub(c.id)} disabled={busy || !(newSub[c.id] ?? "").trim()} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40">+ Add</button>
          </div>
        </div>
      ))}
    </div>
  )
}
