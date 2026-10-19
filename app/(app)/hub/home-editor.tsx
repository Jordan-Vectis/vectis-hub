"use client"

import { useEffect, useRef, useState } from "react"
import { APP_CARD_DEFS } from "@/lib/app-cards"
import { cardDefaultHex, resolveLayout, type HomeLayout, type HomeSection, type StoredCard, type StoredLayout } from "@/lib/home-layout"
import { AppCardTile, type TileCard } from "./app-card-tile"
import { SectionTile } from "./section-tile"

// The home page in edit mode (/hub?edit=1, admins only). The page is drawn as it really looks;
// click a card to change it in the panel on the right, drag cards to reorder them, and Save
// applies it to EVERYONE. Two stores, saved together:
//   /api/admin/app-cards   — each card's order, name, description, shown/hidden, ★ featured
//   /api/admin/home-layout — the sections, and each card's section, icon and colours

export type EditorCard = {
  key: string
  order: number
  visible: boolean
  pinned: boolean
  label: string | null
  description: string | null
}

type Selected = { type: "section" | "card"; key: string } | null

const DEF = new Map(APP_CARD_DEFS.map(d => [d.key, d]))
const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 auto-rows-fr gap-5"
const NONE = "__none__"

const field = "w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
const btn = "min-h-[44px] px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent"
const label = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5"

function ColourRow({ name, value, fallback, onChange }: { name: string; value: string | null; fallback: string; onChange: (v: string | null) => void }) {
  return (
    <div>
      <span className={label}>{name}</span>
      <div className="flex items-center gap-3">
        <input type="color" value={value ?? fallback} onChange={e => onChange(e.target.value)}
          className="h-11 w-16 cursor-pointer rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent p-1" />
        <span className="text-sm text-gray-600 dark:text-gray-300 flex-1">{value ? value.toUpperCase() : "Built-in"}</span>
        {value && <button type="button" onClick={() => onChange(null)} className={btn}>Reset</button>}
      </div>
    </div>
  )
}

export default function HomeEditor({ initialCards, initialLayout, startSection }: {
  initialCards: EditorCard[]
  initialLayout: HomeLayout
  startSection: string | null
}) {
  const [cards, setCards]       = useState<EditorCard[]>(initialCards)
  const [sections, setSections] = useState<HomeSection[]>(initialLayout.sections)
  const [removed, setRemoved]   = useState<string[]>(initialLayout.removed)
  const [styles, setStyles]     = useState<Record<string, StoredCard>>(initialLayout.cards)
  const [view, setView]         = useState<string | null>(
    startSection && initialLayout.sections.some(s => s.key === startSection) ? startSection : null)
  const [selected, setSelected] = useState<Selected>(null)
  const [dirty, setDirty]       = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState("")
  const [note, setNote]         = useState("")
  const [askLeave, setAskLeave] = useState(false)
  const [askRemove, setAskRemove] = useState(false)
  const drag = useRef<{ type: "section" | "card"; key: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Unsaved changes are lost on a reload or a link elsewhere — say so first.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [dirty])

  const touch = () => { setDirty(true); setSaved(false); setError("") }

  // ── reading ──
  const sectionKeys = new Set(sections.map(s => s.key))
  const sectionOf = (c: EditorCard): string | null => {
    const chosen = styles[c.key]?.group
    const g = chosen !== undefined ? chosen : DEF.get(c.key)?.group ?? null
    return g && sectionKeys.has(g) ? g : null
  }
  // Same order the real home page uses: featured first, then the saved order.
  const cardsIn = (section: string | null) => {
    const list = cards.filter(c => sectionOf(c) === section)
    return [...list.filter(c => c.pinned), ...list.filter(c => !c.pinned)]
  }
  const tile = (c: EditorCard): TileCard => {
    const d = DEF.get(c.key)!
    const st = styles[c.key] ?? {}
    return {
      key: c.key, href: d.href, border: d.border, iconBg: d.iconBg, btnBg: d.btnBg, glow: d.glow, comingSoon: d.comingSoon,
      label: c.label?.trim() || d.defaultLabel,
      description: c.description?.trim() || d.defaultDescription,
      icon: st.icon || d.icon,
      pinned: c.pinned,
      colour: st.colour ?? null,
      textColour: st.textColour ?? null,
    }
  }
  const viewSection = view ? sections.find(s => s.key === view) ?? null : null
  const selSection = selected?.type === "section" ? sections.find(s => s.key === selected.key) ?? null : null
  const selCard = selected?.type === "card" ? cards.find(c => c.key === selected.key) ?? null : null

  // ── changing ──
  const setSection = (key: string, patch: Partial<HomeSection>) => { setSections(p => p.map(s => s.key === key ? { ...s, ...patch } : s)); touch() }
  const setCard = (key: string, patch: Partial<EditorCard>) => { setCards(p => p.map(c => c.key === key ? { ...c, ...patch } : c)); touch() }
  const setStyle = (key: string, patch: Partial<StoredCard>) => { setStyles(p => ({ ...p, [key]: { ...p[key], ...patch } })); touch() }

  function moveSectionBy(key: string, by: number) {
    setSections(p => {
      const i = p.findIndex(s => s.key === key), j = i + by
      if (i < 0 || j < 0 || j >= p.length) return p
      const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n
    }); touch()
  }
  function moveSectionOnto(from: string, to: string) {
    setSections(p => {
      const f = p.findIndex(s => s.key === from), t = p.findIndex(s => s.key === to)
      if (f < 0 || t < 0 || f === t) return p
      const n = [...p]; const [x] = n.splice(f, 1); n.splice(t, 0, x); return n
    }); touch()
  }
  // Cards only swap with a neighbour of the same ★ state — featured ones always sit first.
  function moveCardBy(key: string, by: number) {
    const me = cards.find(c => c.key === key)
    if (!me) return
    const peers = cardsIn(sectionOf(me)).filter(c => c.pinned === me.pinned)
    const other = peers[peers.indexOf(me) + by]
    if (other) moveCardOnto(key, other.key)
  }
  function moveCardOnto(from: string, to: string) {
    setCards(p => {
      const f = p.findIndex(c => c.key === from), t = p.findIndex(c => c.key === to)
      if (f < 0 || t < 0 || f === t) return p
      const n = [...p]; const [x] = n.splice(f, 1); n.splice(t, 0, x); return n
    }); touch()
  }
  function moveCardToSection(key: string, section: string | null) {
    setStyle(key, { group: section })
    setCards(p => { const c = p.find(x => x.key === key)!; return [...p.filter(x => x.key !== key), c] })
  }
  function addSection() {
    const key = `CUSTOM_${Date.now().toString(36).toUpperCase()}`
    setSections(p => [...p, { key, label: "New section", icon: "📁", colour: "#6366f1", textColour: null, hidden: false, builtIn: false }])
    setSelected({ type: "section", key }); touch()
  }
  function removeSection(s: HomeSection) {
    setSections(p => p.filter(x => x.key !== s.key))
    if (s.builtIn) setRemoved(p => [...p, s.key])
    setSelected(null); setAskRemove(false); touch()
  }
  function resetCard(key: string) {
    setCard(key, { label: null, description: null })
    setStyles(p => { const { group } = p[key] ?? {}; return { ...p, [key]: group !== undefined ? { group } : {} } })
  }

  // ── drag (desktop; the panel's Earlier / Later buttons do the same on an iPad) ──
  const dragProps = (type: "section" | "card", key: string) => ({
    draggable: true,
    onDragStart: () => { drag.current = { type, key } },
    onDragEnd: () => { drag.current = null },
    onDragOver: (e: React.DragEvent) => {
      const d = drag.current
      if (!d || d.type !== type || d.key === key) return
      e.preventDefault()
      if (type === "section") moveSectionOnto(d.key, key)
      else {
        const a = cards.find(c => c.key === d.key), b = cards.find(c => c.key === key)
        if (a && b && sectionOf(a) === sectionOf(b) && a.pinned === b.pinned) moveCardOnto(d.key, key)
      }
    },
  })

  // ── save / leave / export / import ──
  function payloads() {
    // Saved in the order shown, section by section, so each section's cards stay together.
    const flat = [...sections.map(s => s.key as string | null), null].flatMap(k => cardsIn(k))
    const cardRows = flat.map((c, i) => ({
      key: c.key, order: i, visible: c.visible, pinned: c.pinned,
      label: c.label?.trim() || null, description: c.description?.trim() || null,
    }))
    const layout: StoredLayout = {
      sections: sections.map(s => ({ key: s.key, label: s.label, icon: s.icon, colour: s.colour, textColour: s.textColour, hidden: s.hidden })),
      removed,
      cards: styles,
    }
    return { cardRows, layout }
  }

  async function save() {
    setSaving(true); setError("")
    try {
      const { cardRows, layout } = payloads()
      const l = await fetch("/api/admin/home-layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(layout) })
      if (!l.ok) throw new Error((await l.json().catch(() => ({}))).error ?? `The sections didn't save (${l.status})`)
      const c = await fetch("/api/admin/app-cards", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cardRows) })
      if (!c.ok) throw new Error(`The sections saved, but the cards didn't (${c.status}) — press Save again`)
      setDirty(false); setSaved(true)
    } catch (e: any) {
      setError(e?.message ?? "Couldn't save")
    } finally {
      setSaving(false)
    }
  }

  const leave = () => { window.location.href = view ? `/hub/${view.toLowerCase().replace(/_/g, "-")}` : "/hub" }

  function exportAll() {
    const { cardRows, layout } = payloads()
    const blob = new Blob([JSON.stringify({ version: 2, cards: cardRows, layout }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `home-page-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }
  async function importAll(file: File) {
    setNote("")
    try {
      const data = JSON.parse(await file.text())
      const list: any[] | null = Array.isArray(data) ? data : Array.isArray(data?.cards) ? data.cards : null
      if (!list) throw new Error("not a home page file")
      const byKey = Object.fromEntries(list.filter(d => d?.key).map(d => [d.key, d]))
      setCards(p => p.map(c => {
        const i = byKey[c.key]
        return i ? {
          ...c,
          order:       typeof i.order === "number" ? i.order : c.order,
          visible:     typeof i.visible === "boolean" ? i.visible : c.visible,
          pinned:      typeof i.pinned === "boolean" ? i.pinned : c.pinned,
          label:       i.label ?? null,
          description: i.description ?? null,
        } : c
      }).sort((a, b) => a.order - b.order))
      if (data?.layout) { const l = resolveLayout(data.layout); setSections(l.sections); setRemoved(l.removed); setStyles(l.cards) }
      setSelected(null); setView(null); touch()
      setNote(`Loaded from the file${data?.layout ? "" : " (an older file — names and order only)"}. Check it, then press Save.`)
    } catch {
      setNote("Couldn't read that file — pick one exported from here.")
    }
  }

  // ── drawing ──
  const ring = (on: boolean) => on
    ? "ring-4 ring-indigo-500 ring-offset-2 ring-offset-gray-100 dark:ring-offset-[#111318]"
    : "hover:ring-2 hover:ring-indigo-400/60 hover:ring-offset-2 hover:ring-offset-gray-100 dark:hover:ring-offset-[#111318]"

  const hiddenBadge = (
    <span className="absolute top-3 left-3 z-10 text-xs font-semibold bg-gray-800 text-white px-2 py-0.5 rounded-full">🚫 Hidden</span>
  )

  const panelOpen = !!(selSection || selCard)

  return (
    <div className="relative min-h-screen bg-gray-100 dark:bg-[#111318]">
      {/* The edit bar */}
      <div className="sticky top-0 z-30 bg-indigo-700 text-white shadow-lg">
        <div className="flex flex-wrap items-center gap-2 px-6 py-3">
          <span className="font-semibold">✏️ Editing the home page</span>
          <span className="text-sm text-indigo-100 flex-1 min-w-[220px]">
            Click a card to change it · drag to move it · everyone sees it once you press Save
          </span>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importAll(f); e.target.value = "" }} />
          <button onClick={exportAll} className="min-h-[44px] px-3 rounded-lg text-sm hover:bg-white/10" title="Download this setup to load on another environment">Export</button>
          <button onClick={() => fileRef.current?.click()} className="min-h-[44px] px-3 rounded-lg text-sm hover:bg-white/10" title="Load a setup from a file">Import</button>
          {askLeave ? (
            <>
              <span className="text-sm">Throw away your changes?</span>
              <button onClick={leave} className="min-h-[44px] px-3 rounded-lg text-sm bg-red-600 hover:bg-red-500 font-semibold">Throw away</button>
              <button onClick={() => setAskLeave(false)} className="min-h-[44px] px-3 rounded-lg text-sm hover:bg-white/10">Keep editing</button>
            </>
          ) : (
            <button onClick={() => dirty ? setAskLeave(true) : leave()} className="min-h-[44px] px-4 rounded-lg text-sm border border-white/40 hover:bg-white/10">
              {dirty ? "Cancel" : "Done"}
            </button>
          )}
          <button onClick={save} disabled={saving || !dirty}
            className="min-h-[44px] px-5 rounded-lg text-sm font-semibold bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">
            {saving ? "Saving…" : saved && !dirty ? "✓ Saved for everyone" : "Save"}
          </button>
        </div>
        {(error || note) && (
          <div className={`px-6 pb-3 text-sm ${error ? "text-red-100 font-semibold" : "text-amber-100"}`}>{error || note}</div>
        )}
      </div>

      <div className={`w-full px-6 pt-6 pb-16 transition-[padding] ${panelOpen ? "sm:pr-[420px]" : ""}`}>
        {/* Where we are */}
        <div className="flex items-center gap-3 mb-6 min-h-[44px]">
          {viewSection ? (
            <>
              <button onClick={() => { setView(null); setSelected(null) }} className={btn}>← All sections</button>
              <button onClick={() => setSelected({ type: "section", key: viewSection.key })}
                className="text-xl font-bold text-gray-900 dark:text-white hover:underline" title="Change this section">
                {viewSection.icon} {viewSection.label}
              </button>
              {viewSection.hidden && <span className="text-xs font-semibold bg-gray-800 text-white px-2 py-0.5 rounded-full">🚫 Hidden</span>}
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">The home page — every section, as everyone will see it. Double-click a section (or use <strong>Open this section</strong>) to edit the apps inside.</p>
          )}
        </div>

        <div className={GRID}>
          {!viewSection && sections.map(s => {
            const inIt = cardsIn(s.key)
            const on = selected?.type === "section" && selected.key === s.key
            return (
              <div key={s.key} {...dragProps("section", s.key)}
                onClick={() => setSelected({ type: "section", key: s.key })}
                onDoubleClick={() => { setView(s.key); setSelected(null) }}
                className={`relative rounded-xl cursor-pointer ${ring(on)} ${s.hidden ? "opacity-50" : ""}`}>
                {s.hidden && hiddenBadge}
                <div className="pointer-events-none h-full">
                  <SectionTile label={s.label || "Section"} icon={s.icon} colour={s.colour} textColour={s.textColour} appNames={inIt.map(c => tile(c).label)} />
                </div>
              </div>
            )
          })}

          {(viewSection ? cardsIn(viewSection.key) : cardsIn(null)).map(c => {
            const on = selected?.type === "card" && selected.key === c.key
            return (
              <div key={c.key} {...dragProps("card", c.key)}
                onClick={() => setSelected({ type: "card", key: c.key })}
                className={`relative rounded-xl cursor-pointer ${ring(on)} ${c.visible ? "" : "opacity-50"}`}>
                {!c.visible && hiddenBadge}
                <div className="pointer-events-none h-full"><AppCardTile app={tile(c)} link={false} /></div>
              </div>
            )
          })}

          {!viewSection && (
            <button onClick={addSection}
              className="min-h-[320px] rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-500 flex flex-col items-center justify-center gap-2">
              <span className="text-4xl">＋</span>
              <span className="font-semibold">Add a section</span>
            </button>
          )}
          {viewSection && cardsIn(viewSection.key).length === 0 && (
            <div className="min-h-[320px] rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 flex items-center justify-center text-center p-6 text-sm">
              No apps here yet. Open another section, click an app and pick this section in its <strong className="mx-1">Section</strong> box.
            </div>
          )}
        </div>
      </div>

      {/* The panel */}
      {panelOpen && (
        <aside className="fixed right-0 bottom-0 top-12 z-40 w-full sm:w-[400px] bg-white dark:bg-[#1c1f27] border-l border-gray-200 dark:border-white/10 shadow-2xl overflow-y-auto">
          <div className="sticky top-0 bg-white dark:bg-[#1c1f27] border-b border-gray-200 dark:border-white/10 px-5 py-3 flex items-center gap-3">
            <span className="font-semibold text-gray-900 dark:text-white flex-1">{selSection ? "Section" : "App card"}</span>
            <button onClick={() => { setSelected(null); setAskRemove(false) }} className={btn} title="Close">✕</button>
          </div>

          {selSection && (() => {
            const s = selSection
            const i = sections.indexOf(s)
            const count = cardsIn(s.key).length
            return (
              <div className="p-5 space-y-5">
                <div className="flex gap-3">
                  <div className="w-20">
                    <span className={label}>Icon</span>
                    <input value={s.icon} maxLength={16} onChange={e => setSection(s.key, { icon: e.target.value })} className={field + " text-center text-2xl"} />
                  </div>
                  <div className="flex-1">
                    <span className={label}>Name</span>
                    <input value={s.label} maxLength={40} onChange={e => setSection(s.key, { label: e.target.value })} className={field + " font-semibold"} />
                  </div>
                </div>
                <ColourRow name="Colour" value={s.colour} fallback="#6366f1" onChange={v => setSection(s.key, { colour: v ?? "#6366f1" })} />
                <ColourRow name="Text colour" value={s.textColour} fallback="#ffffff" onChange={v => setSection(s.key, { textColour: v })} />
                <div>
                  <span className={label}>Position</span>
                  <div className="flex gap-2">
                    <button onClick={() => moveSectionBy(s.key, -1)} disabled={i === 0} className={btn + " flex-1"}>← Earlier</button>
                    <button onClick={() => moveSectionBy(s.key, 1)} disabled={i === sections.length - 1} className={btn + " flex-1"}>Later →</button>
                  </div>
                </div>
                <button onClick={() => setSection(s.key, { hidden: !s.hidden })} className={btn + " w-full"}>
                  {s.hidden ? "🚫 Hidden from everyone — show it" : "👁 Shown — hide it from everyone"}
                </button>
                {view !== s.key && (
                  <button onClick={() => { setView(s.key); setSelected(null) }} className={btn + " w-full font-semibold"}>
                    Open this section — edit its {count} app{count === 1 ? "" : "s"} ›
                  </button>
                )}
                <div className="pt-4 border-t border-gray-200 dark:border-white/10">
                  {count > 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">To remove this section, first move its {count} app{count === 1 ? "" : "s"} to another section.</p>
                  ) : askRemove ? (
                    <div className="flex gap-2">
                      <button onClick={() => { removeSection(s); if (view === s.key) setView(null) }} className="min-h-[44px] flex-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold">Remove it</button>
                      <button onClick={() => setAskRemove(false)} className={btn + " flex-1"}>Keep it</button>
                    </div>
                  ) : (
                    <button onClick={() => setAskRemove(true)} className={btn + " w-full text-red-600 dark:text-red-400"}>🗑 Remove this section</button>
                  )}
                </div>
              </div>
            )
          })()}

          {selCard && (() => {
            const c = selCard
            const d = DEF.get(c.key)!
            const st = styles[c.key] ?? {}
            const peers = cardsIn(sectionOf(c)).filter(x => x.pinned === c.pinned)
            const i = peers.indexOf(c)
            return (
              <div className="p-5 space-y-5">
                <div className="flex gap-3">
                  <div className="w-20">
                    <span className={label}>Icon</span>
                    <input value={st.icon ?? ""} placeholder={d.icon} maxLength={16} onChange={e => setStyle(c.key, { icon: e.target.value || null })} className={field + " text-center text-2xl"} />
                  </div>
                  <div className="flex-1">
                    <span className={label}>Name</span>
                    <input value={c.label ?? ""} placeholder={d.defaultLabel} onChange={e => setCard(c.key, { label: e.target.value || null })} className={field + " font-semibold"} />
                  </div>
                </div>
                <div>
                  <span className={label}>Description</span>
                  <textarea value={c.description ?? ""} placeholder={d.defaultDescription} rows={4}
                    onChange={e => setCard(c.key, { description: e.target.value || null })} className={field + " py-2 resize-y leading-relaxed"} />
                </div>
                <ColourRow name="Colour" value={st.colour ?? null} fallback={cardDefaultHex(d)} onChange={v => setStyle(c.key, { colour: v })} />
                <ColourRow name="Text colour" value={st.textColour ?? null} fallback="#ffffff" onChange={v => setStyle(c.key, { textColour: v })} />
                <div>
                  <span className={label}>Section</span>
                  <select value={sectionOf(c) ?? NONE} onChange={e => moveCardToSection(c.key, e.target.value === NONE ? null : e.target.value)} className={field}>
                    {sections.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}{s.hidden ? " (hidden)" : ""}</option>)}
                    <option value={NONE}>No section — on the home page by itself</option>
                  </select>
                </div>
                <div>
                  <span className={label}>Position</span>
                  <div className="flex gap-2">
                    <button onClick={() => moveCardBy(c.key, -1)} disabled={i <= 0} className={btn + " flex-1"}>← Earlier</button>
                    <button onClick={() => moveCardBy(c.key, 1)} disabled={i === peers.length - 1} className={btn + " flex-1"}>Later →</button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setCard(c.key, { visible: !c.visible })} className={btn + " flex-1"}>
                    {c.visible ? "👁 Shown" : "🚫 Hidden"}
                  </button>
                  <button onClick={() => setCard(c.key, { pinned: !c.pinned })} className={btn + ` flex-1 ${c.pinned ? "text-yellow-500" : ""}`}
                    title="Featured cards come first in their section, with a star">
                    {c.pinned ? "★ Featured" : "☆ Feature it"}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Hiding takes it off everyone&apos;s home page; it doesn&apos;t change who may open the app — that&apos;s Users &amp; Permissions.
                </p>
                <div className="pt-4 border-t border-gray-200 dark:border-white/10 flex gap-2">
                  <button onClick={() => resetCard(c.key)} className={btn + " flex-1"} title="Name, description, icon and colours back to the built-in ones">↺ Reset to built-in</button>
                  <a href={d.href} target="_blank" rel="noreferrer" className={btn + " flex-1 inline-flex items-center justify-center"}>Open the app ↗</a>
                </div>
              </div>
            )
          })()}
        </aside>
      )}
    </div>
  )
}
