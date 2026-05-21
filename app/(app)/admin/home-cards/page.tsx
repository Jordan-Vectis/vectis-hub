"use client"

import { useEffect, useRef, useState } from "react"

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
}

export default function HomeCardsPage() {
  const [cards, setCards]     = useState<Card[]>([])
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)
  const dragKey = useRef<string | null>(null)

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
    if (!dragKey.current || dragKey.current === key) return
    setCards(prev => {
      const from = prev.findIndex(c => c.key === dragKey.current)
      const to   = prev.findIndex(c => c.key === key)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    const payload = cards.map((c, i) => ({
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

  if (loading) return <div className="p-8 text-gray-500 text-sm">Loading…</div>

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Home Page Cards</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Drag to reorder · toggle visibility and featured · customise labels</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
        </button>
      </div>

      <div className="space-y-3">
        {cards.map(card => (
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
              <div className="mt-1 cursor-grab text-gray-300 hover:text-gray-500 select-none text-lg leading-none">
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
                {/* Visible */}
                <button
                  onClick={() => update(card.key, { visible: !card.visible })}
                  title={card.visible ? "Visible — click to hide" : "Hidden — click to show"}
                  className={`text-lg transition-colors ${card.visible ? "text-green-500 hover:text-green-400" : "text-gray-300 hover:text-gray-400"}`}
                >
                  {card.visible ? "👁" : "🚫"}
                </button>
                {/* Pinned/Featured */}
                <button
                  onClick={() => update(card.key, { pinned: !card.pinned })}
                  title={card.pinned ? "Featured — click to unfeature" : "Click to feature"}
                  className={`text-lg transition-colors ${card.pinned ? "text-yellow-400 hover:text-yellow-300" : "text-gray-300 hover:text-gray-400"}`}
                >
                  ★
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
        Leave label/description blank to use the default text. Hidden cards won't appear for any user. Featured cards appear first with a star badge.
      </p>
    </div>
  )
}
