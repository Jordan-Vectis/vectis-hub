"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { APP_CARD_DEFS } from "@/lib/app-cards"
import { cardDefaultHex, resolveLayout, type HomeSection, type StoredCard, type StoredLayout } from "@/lib/home-layout"
import { SectionTile } from "../../hub/section-tile"

// Admin → Home Page Cards. Everything here applies to EVERYONE's home page.
// Two stores, saved together by one button:
//   /api/admin/app-cards   — each card's order, name, description, shown/hidden, ★ featured
//   /api/admin/home-layout — the sections (order, name, icon, colours, hidden, added/removed)
//                            and each card's section, icon and colours

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
  group: string | null   // the section set in code
}

const DEF = new Map(APP_CARD_DEFS.map(d => [d.key, d]))
const NONE = "__none__"

const inputCls = "border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md px-3 min-h-[44px] focus:outline-none focus:ring-1 focus:ring-slate-400 placeholder:text-gray-400"
const smallBtn = "min-h-[44px] min-w-[44px] px-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent text-sm"

function ColourField({ label, value, fallback, onChange }: { label: string; value: string | null; fallback: string; onChange: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <input type="color" value={value ?? fallback} onChange={e => onChange(e.target.value)}
          className="h-11 w-11 cursor-pointer rounded-md border border-gray-300 dark:border-gray-600 bg-transparent p-1" />
        <span>{label}{value ? "" : " (default)"}</span>
      </label>
      {value && (
        <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-500 dark:text-gray-400 underline hover:text-gray-800 dark:hover:text-white">
          Reset
        </button>
      )}
    </div>
  )
}

export default function HomeCardsPage() {
  const [cards, setCards]       = useState<Card[]>([])
  const [sections, setSections] = useState<HomeSection[]>([])
  const [removed, setRemoved]   = useState<string[]>([])
  const [styles, setStyles]     = useState<Record<string, StoredCard>>({})
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [saveError, setSaveError] = useState("")
  const [importMsg, setImportMsg] = useState("")
  const dragKey = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/app-cards").then(async r => { if (!r.ok) throw new Error(`cards: ${r.status}`); return r.json() }),
      fetch("/api/admin/home-layout").then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `layout: ${r.status}`); return r.json() }),
    ])
      .then(([c, l]) => {
        setCards(c)
        setSections(l.sections)
        setRemoved(l.removed ?? [])
        setStyles(l.cards ?? {})
      })
      .catch(e => setLoadError(e?.message ?? "Couldn't load"))
      .finally(() => setLoading(false))
  }, [])

  const dirty = () => { setSaved(false); setSaveError("") }
  const sectionKeys = new Set(sections.map(s => s.key))
  const sectionOf = (c: Card): string | null => {
    const g = styles[c.key]?.group !== undefined ? styles[c.key]!.group! : c.group
    return g && sectionKeys.has(g) ? g : null
  }
  const groups: { key: string | null; label: string }[] = [
    ...sections.map(s => ({ key: s.key as string | null, label: s.label })),
    { key: null, label: "No section (shown on the home page on its own)" },
  ]

  // ── sections ──
  function updateSection(key: string, patch: Partial<HomeSection>) {
    setSections(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s)); dirty()
  }
  function moveSection(i: number, by: number) {
    setSections(prev => {
      const j = i + by
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next
    }); dirty()
  }
  function addSection() {
    const key = `CUSTOM_${Date.now().toString(36).toUpperCase()}`
    setSections(prev => [...prev, { key, label: "New section", icon: "📁", colour: "#6366f1", textColour: null, hidden: false, builtIn: false }]); dirty()
  }
  function removeSection(s: HomeSection) {
    setSections(prev => prev.filter(x => x.key !== s.key))
    if (s.builtIn) setRemoved(prev => [...prev, s.key])
    dirty()
  }

  // ── cards ──
  function updateCard(key: string, patch: Partial<Card>) {
    setCards(prev => prev.map(c => c.key === key ? { ...c, ...patch } : c)); dirty()
  }
  function updateStyle(key: string, patch: Partial<StoredCard>) {
    setStyles(prev => ({ ...prev, [key]: { ...prev[key], ...patch } })); dirty()
  }
  function moveCardTo(key: string, section: string | null) {
    updateStyle(key, { group: section })
    // to the end of its new section
    setCards(prev => { const c = prev.find(x => x.key === key)!; return [...prev.filter(x => x.key !== key), c] })
  }
  function moveCard(key: string, by: number) {
    setCards(prev => {
      const me = prev.find(c => c.key === key)!
      const same = prev.filter(c => sectionOf(c) === sectionOf(me))
      const i = same.indexOf(me), j = i + by
      if (j < 0 || j >= same.length) return prev
      const a = prev.indexOf(same[i]), b = prev.indexOf(same[j])
      const next = [...prev]; [next[a], next[b]] = [next[b], next[a]]; return next
    }); dirty()
  }
  function handleDragOver(e: React.DragEvent, key: string) {
    e.preventDefault()
    const from = dragKey.current
    if (!from || from === key) return
    setCards(prev => {
      const f = prev.find(c => c.key === from), t = prev.find(c => c.key === key)
      if (!f || !t || sectionOf(f) !== sectionOf(t)) return prev  // ↓ use the Section box to move between sections
      const next = [...prev]
      const [item] = next.splice(next.indexOf(f), 1)
      next.splice(next.indexOf(t), 0, item)
      return next
    }); dirty()
  }

  // ── save / export / import ──
  function cardPayload() {
    const ordered = groups.flatMap(g => cards.filter(c => sectionOf(c) === g.key))
    return ordered.map((c, i) => ({
      key: c.key, order: i, visible: c.visible, pinned: c.pinned,
      label: c.label?.trim() || null, description: c.description?.trim() || null,
    }))
  }
  function layoutPayload(): StoredLayout {
    return {
      sections: sections.map(s => ({ key: s.key, label: s.label, icon: s.icon, colour: s.colour, textColour: s.textColour, hidden: s.hidden })),
      removed,
      cards: styles,
    }
  }

  async function save() {
    setSaving(true); setSaveError("")
    try {
      const l = await fetch("/api/admin/home-layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(layoutPayload()) })
      if (!l.ok) throw new Error((await l.json().catch(() => ({}))).error ?? `Sections didn't save (${l.status})`)
      const c = await fetch("/api/admin/app-cards", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cardPayload()) })
      if (!c.ok) throw new Error(`The sections saved, but the cards didn't (${c.status}) — press Save again`)
      setSaved(true)
    } catch (e: any) {
      setSaveError(e?.message ?? "Couldn't save")
    } finally {
      setSaving(false)
    }
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify({ version: 2, cards: cardPayload(), layout: layoutPayload() }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `home-page-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Loads a file into the editor (matched by key). Nothing is saved until Save changes.
  async function importAll(file: File) {
    setImportMsg("")
    try {
      const data = JSON.parse(await file.text())
      const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.cards) ? data.cards : null as any
      if (!list) throw new Error("not a home page file")
      const byKey = Object.fromEntries(list.filter(d => d?.key).map(d => [d.key, d]))
      let applied = 0
      setCards(prev => prev.map(c => {
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
      }).sort((a, b) => a.order - b.order))
      if (data?.layout) {
        const l = resolveLayout(data.layout)
        setSections(l.sections); setRemoved(l.removed); setStyles(l.cards)
      }
      dirty()
      const missing = Object.keys(byKey).length - applied
      setImportMsg(`Loaded ${applied} card${applied === 1 ? "" : "s"}${data?.layout ? " and the sections" : " (this older file has no sections or colours)"}${missing > 0 ? ` · ${missing} in the file aren't cards here and were ignored` : ""}. Check it, then press Save changes.`)
    } catch {
      setImportMsg("Couldn't read that file — pick one exported from this page.")
    }
  }

  if (loading) return <div className="p-8 text-gray-500 dark:text-gray-400 text-sm">Loading…</div>
  if (loadError) return <div className="p-8 text-sm text-red-600 dark:text-red-400">Couldn&apos;t load the home page setup: {loadError}</div>

  return (
    <div className="p-6 w-full">
      {/* Header + actions — sticky so Save is always in reach */}
      <div className="sticky top-0 z-10 -mx-6 px-6 py-4 mb-6 bg-gray-100/95 dark:bg-[#111318]/95 backdrop-blur border-b border-gray-200 dark:border-white/5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Home Page Cards</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Changes here apply to <strong>everyone&apos;s</strong> home page once you press Save changes.</p>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) importAll(f); e.target.value = "" }} />
        <Link href="/hub" target="_blank" className={smallBtn + " inline-flex items-center px-3"}>View home page ↗</Link>
        <button onClick={exportAll} className={smallBtn + " px-3"} title="Download this setup to load on another environment">Export</button>
        <button onClick={() => fileRef.current?.click()} className={smallBtn + " px-3"} title="Load a setup from a file (check it, then Save)">Import</button>
        <button onClick={save} disabled={saving}
          className="min-h-[44px] px-5 bg-slate-800 hover:bg-slate-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          {saving ? "Saving…" : saved ? "✓ Saved for everyone" : "Save changes"}
        </button>
        {saveError && <p className="basis-full text-sm text-red-600 dark:text-red-400">{saveError}</p>}
        {importMsg && <p className="basis-full text-xs text-amber-600 dark:text-amber-400">{importMsg}</p>}
      </div>

      {/* ── Sections ── */}
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Sections — the cards on the home page</h2>
      <div className="space-y-3 mb-4">
        {sections.map((s, i) => {
          const inIt = cards.filter(c => sectionOf(c) === s.key)
          return (
            <div key={s.key} className={`bg-white dark:bg-gray-900 border rounded-xl p-4 flex flex-wrap gap-4 ${s.hidden ? "border-dashed border-gray-300 dark:border-gray-600 opacity-60" : "border-gray-200 dark:border-gray-700"}`}>
              <div className="flex flex-col gap-1">
                <button onClick={() => moveSection(i, -1)} disabled={i === 0} className={smallBtn} title="Move earlier">↑</button>
                <button onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1} className={smallBtn} title="Move later">↓</button>
              </div>
              <div className="flex-1 min-w-[280px] space-y-3">
                <div className="flex gap-2">
                  <input value={s.icon} onChange={e => updateSection(s.key, { icon: e.target.value })} maxLength={16}
                    className={inputCls + " w-16 text-center text-2xl"} title="Icon — type or paste an emoji" />
                  <input value={s.label} onChange={e => updateSection(s.key, { label: e.target.value })} maxLength={40}
                    className={inputCls + " flex-1 font-semibold"} placeholder="Section name" />
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <ColourField label="Colour" value={s.colour} fallback="#6366f1" onChange={v => updateSection(s.key, { colour: v ?? "#6366f1" })} />
                  <ColourField label="Text colour" value={s.textColour} fallback="#ffffff" onChange={v => updateSection(s.key, { textColour: v })} />
                  <button onClick={() => updateSection(s.key, { hidden: !s.hidden })} className={smallBtn + " px-3"}>
                    {s.hidden ? "🚫 Hidden — show it" : "👁 Shown — hide it"}
                  </button>
                  {inIt.length === 0 ? (
                    <button onClick={() => removeSection(s)} className={smallBtn + " px-3 text-red-600 dark:text-red-400"}>🗑 Remove section</button>
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-gray-400">{inIt.length} app{inIt.length === 1 ? "" : "s"} — move them out to remove it</span>
                  )}
                </div>
                {s.hidden && <p className="text-xs text-amber-600 dark:text-amber-400">Hidden: nobody sees this section or the apps in it on the home page.</p>}
              </div>
              <div className="w-64 hidden md:block pointer-events-none">
                <SectionTile label={s.label || "Section"} icon={s.icon} colour={s.colour} textColour={s.textColour} appNames={inIt.map(c => c.label?.trim() || c.defaultLabel)} />
              </div>
            </div>
          )
        })}
      </div>
      <button onClick={addSection} className={smallBtn + " px-4 mb-10"}>+ Add a section</button>

      {/* ── Apps ── */}
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Apps — the cards inside each section</h2>
      <div className="space-y-8">
        {groups.map(group => {
          const groupCards = cards.filter(c => sectionOf(c) === group.key)
          if (groupCards.length === 0) return null
          return (
            <div key={group.key ?? "none"}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{group.label}</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
              </div>
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                {groupCards.map((card, i) => {
                  const def = DEF.get(card.key)
                  const st = styles[card.key] ?? {}
                  return (
                    <div key={card.key} draggable
                      onDragStart={() => { dragKey.current = card.key }}
                      onDragOver={e => handleDragOver(e, card.key)}
                      onDragEnd={() => { dragKey.current = null }}
                      className={`bg-white dark:bg-gray-900 border rounded-xl p-4 flex gap-3 ${card.visible ? "border-gray-200 dark:border-gray-700" : "border-dashed border-gray-300 dark:border-gray-600 opacity-60"}`}
                      style={st.colour ? { borderLeft: `6px solid ${st.colour}` } : undefined}
                    >
                      <div className="flex flex-col gap-1 items-center">
                        <span className="cursor-grab text-gray-400 select-none text-lg" title="Drag to reorder within this section">⠿</span>
                        <button onClick={() => moveCard(card.key, -1)} disabled={i === 0} className={smallBtn} title="Move earlier">↑</button>
                        <button onClick={() => moveCard(card.key, 1)} disabled={i === groupCards.length - 1} className={smallBtn} title="Move later">↓</button>
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex gap-2">
                          <input value={st.icon ?? ""} placeholder={card.icon} onChange={e => updateStyle(card.key, { icon: e.target.value || null })} maxLength={16}
                            className={inputCls + " w-16 text-center text-2xl"} title={`Icon — leave blank for ${card.icon}`} />
                          <input value={card.label ?? ""} onChange={e => updateCard(card.key, { label: e.target.value || null })} placeholder={card.defaultLabel}
                            className={inputCls + " flex-1 min-w-0 text-sm font-semibold"} />
                        </div>
                        <textarea value={card.description ?? ""} onChange={e => updateCard(card.key, { description: e.target.value || null })} placeholder={card.defaultDescription} rows={2}
                          className={inputCls.replace("min-h-[44px]", "") + " w-full py-2 text-sm resize-none leading-relaxed"} />
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                            Section
                            <select value={sectionOf(card) ?? NONE} onChange={e => moveCardTo(card.key, e.target.value === NONE ? null : e.target.value)}
                              className={inputCls + " text-sm"}>
                              {sections.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                              <option value={NONE}>No section</option>
                            </select>
                          </label>
                          <ColourField label="Colour" value={st.colour ?? null} fallback={def ? cardDefaultHex(def) : "#6366f1"} onChange={v => updateStyle(card.key, { colour: v })} />
                          <ColourField label="Text colour" value={st.textColour ?? null} fallback="#ffffff" onChange={v => updateStyle(card.key, { textColour: v })} />
                          <button onClick={() => updateCard(card.key, { visible: !card.visible })} className={smallBtn + " px-3"}
                            title={card.visible ? "Shown — click to hide from everyone" : "Hidden from everyone — click to show"}>
                            {card.visible ? "👁 Shown" : "🚫 Hidden"}
                          </button>
                          <button onClick={() => updateCard(card.key, { pinned: !card.pinned })} className={smallBtn + ` px-3 ${card.pinned ? "text-yellow-500" : ""}`}
                            title="Featured cards come first in their section with a star">
                            {card.pinned ? "★ Featured" : "☆ Feature"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-8">
        Leave a name, description or icon blank to use the built-in one; Reset puts a colour back. Hiding a card or section hides it from everyone, admins included, on the home page —
        it doesn&apos;t change who can open the app (that&apos;s Users &amp; Permissions). Moving an app to another section also moves it under that heading on the permission screens.
      </p>
    </div>
  )
}
