"use client"

import { useEffect, useRef, useState } from "react"
import { SECTION_DEFS } from "@/lib/app-cards"

type Card = {
  key: string
  order: number
  visible: boolean
  pinned: boolean
  label: string | null
  description: string | null
  defaultLabel: string
  defaultDescription: string
  icon: string
  group: string | null
}

// Section order for grouping (matches the home page); null group rendered last.
const GROUPS: { key: string | null; label: string }[] = [
  ...SECTION_DEFS.map((s) => ({ key: s.key as string | null, label: s.label })),
  { key: null, label: "Other" },
]

export default function HomeCardsPage() {
  const [cards, setCards]     = useState<Card[]>([])
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)
  const dragKey = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState("")

  useEffect(() => {
    fetch("/api/admin/app-cards")
      .then(r => r.json())
      .then(data => { setCards(data); setLoading(false) })
  }, [])

  function update(key: string, patch: Partial<Card>) {
    setCards(prev => prev.map(c => c.key === key ? { ...c, ...patch } : c))
    setSaved(false)
  }

  function handleDragStart(key: string) {
    dragKey.current = key
  }

  function handleDragOver(e: React.DragEvent, key: string) {
    e.preventDefault()
    const from = dragKey.current
    if (!from || from === key) return
    setCards(prev => {
      const fromCard = prev.find(c => c.key === from)
      const toCard   = prev.find(c => c.key === key)
      // Only reorder within the same section — cards can't move between sections here.
      if (!fromCard || !toCard || fromCard.group !== toCard.group) return prev
      const fromIdx = prev.findIndex(c => c.key === from)
      const toIdx   = prev.findIndex(c => c.key === key)
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    // Flatten in grouped display order so the saved global `order` keeps each
    // section's cards contiguous and in the order shown here.
    const ordered = GROUPS.flatMap(g => cards.filter(c => c.group === g.key))
    const payload = ordered.map((c, i) => ({
      key:         c.key,
      order:       i,
      visible:     c.visible,
      pinned:      c.pinned,
      label:       c.label?.trim() || null,
      description: c.description?.trim() || null,
    }))
    await fetch("/api/admin/app-cards", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    setSaved(true)
  }

  // Download the current setup as JSON (same shape the Save PUT uses) so it can
  // be imported on another environment to match it.
  function exportCards() {
    const ordered = GROUPS.flatMap(g => cards.filter(c => c.group === g.key))
    const payload = ordered.map((c, i) => ({
      key: c.key, order: i, visible: c.visible, pinned: c.pinned,
      label: c.label?.trim() || null, description: c.description?.trim() || null,
    }))
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href = url
    a.download = `home-cards-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Load an exported file into the editor (matched by key). It does NOT save —
  // the admin reviews and clicks Save changes to apply, going through the normal PUT.
  async function importCards(file: File) {
    setImportMsg("")
    try {
      const data = JSON.parse(await file.text())
      if (!Array.isArray(data)) throw new Error("not an array")
      const byKey = Object.fromEntries(data.filter((d: any) => d && d.key).map((d: any) => [d.key, d]))
      let applied = 0
      setCards(prev => {
        const next = prev.map(c => {
          const imp = byKey[c.key]
          if (!imp) return c
          applied++
          return {
            ...c,
            order:       typeof imp.order === "number" ? imp.order : c.order,
            visible:     typeof imp.visible === "boolean" ? imp.visible : c.visible,
            pinned:      typeof imp.pinned === "boolean" ? imp.pinned : c.pinned,
            label:       imp.label ?? null,
            description: imp.description ?? null,
          }
        })
        return [...next].sort((a, b) => a.order - b.order)
      })
      setSaved(false)
      const missing = Object.keys(byKey).length - applied
      setImportMsg(`Loaded ${applied} card${applied === 1 ? "" : "s"}${missing > 0 ? ` (${missing} in the file aren't cards here and were ignored)` : ""}. Review, then click Save changes to apply.`)
    } catch {
      setImportMsg("Couldn't read that file — pick a JSON exported from this page.")
    }
  }

  if (loading) return <div className="p-8 text-gray-500 text-sm">Loading…</div>

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Home Page Cards</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Cards are grouped into the same sections shown on the home page. Drag to reorder within a section · toggle visibility &amp; featured · customise labels.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importCards(f); e.target.value = "" }}
          />
          <button
            onClick={exportCards}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-slate-400 text-sm font-medium rounded-lg transition-colors"
            title="Download this setup as JSON to import on another environment"
          >
            Export
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-slate-400 text-sm font-medium rounded-lg transition-colors"
            title="Load a setup from a JSON file (review, then Save)"
          >
            Import
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
          </button>
        </div>
      </div>
      {importMsg && <p className="text-xs text-amber-600 dark:text-amber-400 -mt-4 mb-6">{importMsg}</p>}

      <div className="space-y-8">
        {GROUPS.map(group => {
          const groupCards = cards.filter(c => c.group === group.key)
          if (groupCards.length === 0) return null
          return (
            <div key={group.key ?? "none"}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">{group.label}</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
              </div>
              <div className="space-y-3">
                {groupCards.map(card => (
                  <div
                    key={card.key}
                    draggable
                    onDragStart={() => handleDragStart(card.key)}
                    onDragOver={e => handleDragOver(e, card.key)}
                    onDragEnd={() => { dragKey.current = null }}
                    className={`bg-white dark:bg-gray-900 border rounded-xl p-4 transition-all ${
                      card.visible ? "border-gray-200 dark:border-gray-700" : "border-dashed border-gray-300 dark:border-gray-600 opacity-50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Drag handle */}
                      <div className="mt-1 cursor-grab text-gray-300 hover:text-gray-500 select-none text-lg leading-none" title="Drag to reorder within this section">
                        ⠿
                      </div>

                      {/* Icon */}
                      <div className="text-2xl mt-0.5 select-none">{card.icon}</div>

                      {/* Fields */}
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={card.label ?? ""}
                            onChange={e => update(card.key, { label: e.target.value || null })}
                            placeholder={card.defaultLabel}
                            className="flex-1 text-sm font-semibold border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400 placeholder:text-gray-400 placeholder:font-normal"
                          />
                          <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">default: {card.defaultLabel}</span>
                        </div>
                        <textarea
                          value={card.description ?? ""}
                          onChange={e => update(card.key, { description: e.target.value || null })}
                          placeholder={card.defaultDescription}
                          rows={2}
                          className="w-full text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none placeholder:text-gray-400 leading-relaxed"
                        />
                      </div>

                      {/* Toggles */}
                      <div className="flex flex-col items-center gap-3 ml-1 mt-0.5">
                        <button
                          onClick={() => update(card.key, { visible: !card.visible })}
                          title={card.visible ? "Visible — click to hide" : "Hidden — click to show"}
                          className={`text-lg transition-colors ${card.visible ? "text-green-500 hover:text-green-400" : "text-gray-300 hover:text-gray-400"}`}
                        >
                          {card.visible ? "👁" : "🚫"}
                        </button>
                        <button
                          onClick={() => update(card.key, { pinned: !card.pinned })}
                          title={card.pinned ? "Featured — click to unfeature" : "Click to feature (appears first in its section with a star)"}
                          className={`text-lg transition-colors ${card.pinned ? "text-yellow-400 hover:text-yellow-300" : "text-gray-300 hover:text-gray-400"}`}
                        >
                          ★
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-6">
        Leave label/description blank to use the default text. Hidden cards won&apos;t appear for any user. Featured cards (★) appear first within their section. Which section a card lives in is set in the code.
      </p>
    </div>
  )
}
