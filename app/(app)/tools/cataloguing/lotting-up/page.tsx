"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import type { LotGroup, LotItem, LottingUpResult } from "@/app/api/lotting-up/route"
import { showError } from "@/lib/error-modal"

// ── Band maths ────────────────────────────────────────────────────────────────
//
// The whole point of this tool: a lot is worth selling when it lands in the
// target band (£60–80 by default). A single item already worth MORE than the
// band is a perfectly good lot on its own and must never be padded out. Anything
// under the band needs grouping up; a pile of small items well over the band
// should have been split into several lots.

const COLOURS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
]

type Band = "under" | "in" | "single" | "over"

const BAND_META: Record<Band, { label: string; colour: string; ring: string; hint: string }> = {
  under:  { label: "Needs grouping", colour: "#f87171", ring: "border-red-500/40 bg-red-500/10 text-red-300",
            hint: "Below the target band — add more items to this lot." },
  in:     { label: "In band",        colour: "#4ade80", ring: "border-green-500/40 bg-green-500/10 text-green-300",
            hint: "Lands in the target band." },
  single: { label: "Single lot",     colour: "#60a5fa", ring: "border-blue-500/40 bg-blue-500/10 text-blue-300",
            hint: "Worth more than the band on its own — sells alone, no filler needed." },
  over:   { label: "Could split",    colour: "#fbbf24", ring: "border-amber-500/40 bg-amber-500/10 text-amber-300",
            hint: "Several items well over the band — unless it's a matched set, this is more than one lot." },
}

function bandOf(g: LotGroup, lo: number, hi: number): Band {
  if (g.estimateLow < lo) return "under"
  if (g.estimateLow > hi) return g.items.length === 1 ? "single" : "over"
  return "in"
}

function boundsOf(items: LotItem[]) {
  if (!items.length) return { y: 0, h: 100 }
  const top    = Math.min(...items.map(i => i.bounds.y))
  const bottom = Math.max(...items.map(i => i.bounds.y + i.bounds.h))
  return { y: top, h: Math.max(1, bottom - top) }
}

/** Re-derive everything that depends on a lot's items, then renumber and recolour. */
function recalc(result: LottingUpResult, groups: LotGroup[]): LottingUpResult {
  const next = groups
    .filter(g => g.items.length > 0)
    .map((g, i) => ({
      ...g,
      id:           i + 1,
      colour:       COLOURS[i % COLOURS.length],
      estimateLow:  g.items.reduce((s, it) => s + it.valueLow,  0),
      estimateHigh: g.items.reduce((s, it) => s + it.valueHigh, 0),
      bounds:       boundsOf(g.items),
    }))
  return {
    ...result,
    groups:            next,
    totalEstimateLow:  next.reduce((s, g) => s + g.estimateLow,  0),
    totalEstimateHigh: next.reduce((s, g) => s + g.estimateHigh, 0),
  }
}

const money = (n: number) => `£${Math.round(n).toLocaleString()}`

// ── Photo with overlay ────────────────────────────────────────────────────────

type Highlight = { y: number; h: number; colour: string; label: string } | null

function PhotoOverlay({ imageUrl, highlight }: { imageUrl: string; highlight: Highlight }) {
  return (
    <div className="relative">
      <img src={imageUrl} alt="Upload" className="w-full h-auto block rounded-xl" />

      {highlight && (
        <>
          <div className="absolute inset-x-0 top-0 bg-black/60 pointer-events-none rounded-t-xl transition-all"
            style={{ height: `${highlight.y}%` }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/60 pointer-events-none rounded-b-xl transition-all"
            style={{ height: `${Math.max(0, 100 - highlight.y - highlight.h)}%` }} />
          <div className="absolute inset-x-0 pointer-events-none transition-all"
            style={{
              top:             `${highlight.y}%`,
              height:          `${highlight.h}%`,
              border:          `3px solid ${highlight.colour}`,
              backgroundColor: `${highlight.colour}18`,
            }}
          />
          <div className="absolute text-white text-xs font-bold px-2 py-0.5 rounded pointer-events-none shadow-lg"
            style={{ left: "6px", top: `calc(${highlight.y}% + 6px)`, backgroundColor: highlight.colour }}>
            {highlight.label}
          </div>
        </>
      )}
    </div>
  )
}

// ── Band meter ────────────────────────────────────────────────────────────────

function BandMeter({ low, high, targetLow, targetHigh }: {
  low: number; high: number; targetLow: number; targetHigh: number
}) {
  // Scale so the band always sits in the middle third of the track.
  const scaleMax = Math.max(targetHigh * 2.5, high * 1.15, targetLow + 1)
  const pct = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`

  return (
    <div className="relative h-1.5 rounded-full bg-[#2C2C2E] overflow-hidden">
      {/* target band */}
      <div className="absolute inset-y-0 bg-white/10"
        style={{ left: pct(targetLow), width: `calc(${pct(targetHigh)} - ${pct(targetLow)})` }} />
      {/* this lot's range */}
      <div className="absolute inset-y-0 rounded-full bg-gray-500"
        style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})`, minWidth: "2px" }} />
      {/* low estimate marker — the figure the band is judged on */}
      <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(low) }} />
    </div>
  )
}

// ── Editable value ────────────────────────────────────────────────────────────

function ValueEditor({ low, high, onChange }: {
  low: number; high: number; onChange: (low: number, high: number) => void
}) {
  // Remounted (via key) whenever the committed values change, so no effect is
  // needed to keep the draft inputs in step with the props.
  const [editing, setEditing] = useState(false)
  const [l, setL] = useState(String(low))
  const [h, setH] = useState(String(high))

  function commit() {
    const nl = Math.max(0, Math.round(parseFloat(l) || 0))
    const nh = Math.max(nl, Math.round(parseFloat(h) || 0))
    onChange(nl, nh)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={e => { e.stopPropagation(); setEditing(true) }}
        title="Click to edit this item's value"
        className="text-xs text-gray-300 tabular-nums hover:text-[#2AB4A6] transition-colors flex-shrink-0 px-2 py-2 -my-1 rounded hover:bg-[#2C2C2E]"
      >
        {money(low)}–{money(high).replace("£", "")}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
      <input autoFocus type="number" min={0} value={l} onChange={e => setL(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false) }}
        className="w-14 bg-[#2C2C2E] border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-[#2AB4A6]" />
      <span className="text-gray-600 text-xs">–</span>
      <input type="number" min={0} value={h} onChange={e => setH(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false) }}
        className="w-14 bg-[#2C2C2E] border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-[#2AB4A6]" />
      <button onClick={commit} className="text-xs text-[#2AB4A6] px-1">✓</button>
    </div>
  )
}

// ── Per-photo panel ───────────────────────────────────────────────────────────

type PhotoRun = {
  file:      File
  url:       string
  result:    LottingUpResult | null
  original:  LottingUpResult | null
  analysing: boolean
}

function PhotoPanel({ run, targetLow, targetHigh, onResult, onAnalyse }: {
  run:        PhotoRun
  targetLow:  number
  targetHigh: number
  onResult:   (r: LottingUpResult) => void
  onAnalyse:  () => void
}) {
  const [hoverGroup, setHoverGroup] = useState<number | null>(null)
  const [hoverItem,  setHoverItem]  = useState<string | null>(null)
  const [pinnedId,   setPinnedId]   = useState<number | null>(null)
  const [selected,   setSelected]   = useState<Set<string>>(new Set())

  const { url, result, analysing } = run

  // Escape clears a selection — quicker than hunting for the Clear button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setSelected(new Set()) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const groups = useMemo(() => result?.groups ?? [], [result])

  // Highlight priority: hovered item → hovered lot → pinned lot.
  const highlight: Highlight = useMemo(() => {
    if (hoverItem) {
      for (const g of groups) {
        const it = g.items.find(i => i.uid === hoverItem)
        if (it) return { y: it.bounds.y, h: it.bounds.h, colour: g.colour, label: it.name.slice(0, 28) }
      }
    }
    const id = hoverGroup ?? pinnedId
    const g  = id !== null ? groups.find(x => x.id === id) : null
    return g ? { y: g.bounds.y, h: g.bounds.h, colour: g.colour, label: `Lot ${g.id}` } : null
  }, [hoverItem, hoverGroup, pinnedId, groups])

  const counts = useMemo(() => {
    const c: Record<Band, number> = { under: 0, in: 0, single: 0, over: 0 }
    groups.forEach(g => { c[bandOf(g, targetLow, targetHigh)]++ })
    return c
  }, [groups, targetLow, targetHigh])

  const selectedItems = useMemo(() => {
    const out: LotItem[] = []
    groups.forEach(g => g.items.forEach(i => { if (selected.has(i.uid)) out.push(i) }))
    return out
  }, [groups, selected])

  const selLow  = selectedItems.reduce((s, i) => s + i.valueLow,  0)
  const selHigh = selectedItems.reduce((s, i) => s + i.valueHigh, 0)

  const edited = !!result && !!run.original && JSON.stringify(result.groups) !== JSON.stringify(run.original.groups)

  // ── Editing actions ──

  function apply(groups: LotGroup[]) {
    if (!result) return
    onResult(recalc(result, groups))
  }

  function moveSelectedTo(targetGroupId: number | "new") {
    if (!result || !selected.size) return
    const moving: LotItem[] = []
    let next = result.groups.map(g => ({
      ...g,
      items: g.items.filter(i => {
        if (!selected.has(i.uid)) return true
        moving.push(i)
        return false
      }),
    }))

    if (targetGroupId === "new") {
      next = [...next, {
        id:           0, // recalc renumbers
        title:        moving.length === 1 ? moving[0].name.slice(0, 60) : "New lot",
        kind:         moving.length === 1 ? "single" : "grouped",
        items:        moving,
        estimateLow:  0,
        estimateHigh: 0,
        bounds:       boundsOf(moving),
        notes:        "",
        confidence:   "medium",
        colour:       "",
      }]
    } else {
      next = next.map(g => g.id === targetGroupId ? { ...g, items: [...g.items, ...moving] } : g)
    }

    apply(next)
    setSelected(new Set())
  }

  function mergeInto(fromId: number, toId: number) {
    if (!result) return
    const from = result.groups.find(g => g.id === fromId)
    if (!from) return
    apply(result.groups
      .filter(g => g.id !== fromId)
      .map(g => g.id === toId ? { ...g, items: [...g.items, ...from.items] } : g))
  }

  function splitEachItem(groupId: number) {
    if (!result) return
    const g = result.groups.find(x => x.id === groupId)
    if (!g || g.items.length < 2) return
    const singles: LotGroup[] = g.items.map(it => ({
      ...g,
      id: 0,
      title: it.name.slice(0, 60),
      kind: "single" as const,
      items: [it],
      notes: "",
      colour: "",
    }))
    const idx = result.groups.findIndex(x => x.id === groupId)
    apply([...result.groups.slice(0, idx), ...singles, ...result.groups.slice(idx + 1)])
  }

  function deleteGroup(groupId: number) {
    if (!result) return
    apply(result.groups.filter(g => g.id !== groupId))
  }

  function patchItem(uid: string, patch: Partial<LotItem>) {
    if (!result) return
    apply(result.groups.map(g => ({
      ...g,
      items: g.items.map(i => i.uid === uid ? { ...i, ...patch } : i),
    })))
  }

  function patchGroup(groupId: number, patch: Partial<LotGroup>) {
    if (!result) return
    apply(result.groups.map(g => g.id === groupId ? { ...g, ...patch } : g))
  }

  function toggleItem(uid: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid); else next.add(uid)
      return next
    })
  }

  // ── Render ──

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

      {/* Left — sticky photo */}
      <div className="space-y-3 lg:sticky lg:top-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-300">Photo</p>
          <button
            onClick={onAnalyse}
            disabled={analysing}
            className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-4 py-1 rounded-lg transition-colors">
            {analysing ? "Analysing…" : result ? "Re-analyse" : "✦ Analyse"}
          </button>
        </div>

        <div className="rounded-xl bg-[#1C1C1E] border border-gray-800 overflow-hidden">
          {result ? <PhotoOverlay imageUrl={url} highlight={highlight} />
                  : <img src={url} alt="Upload" className="w-full h-auto block rounded-xl" />}
        </div>

        {result?.sceneNotes && (
          <p className="text-xs text-gray-500 italic px-1">{result.sceneNotes}</p>
        )}

        {analysing && (
          <div className="flex items-center gap-3 text-sm text-gray-400 bg-[#1C1C1E] border border-gray-800 rounded-xl px-4 py-3">
            <span className="animate-spin text-[#2AB4A6]">⟳</span>
            Valuing every item and packing them into £{targetLow}–£{targetHigh} lots…
          </div>
        )}

        {result && !analysing && (
          <p className="text-xs text-gray-600 px-1">
            Hover a lot or an item to light it up on the photo. Click a lot number to pin it.
          </p>
        )}
      </div>

      {/* Right — results */}
      <div className="space-y-4">
        {!result && !analysing && (
          <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl p-8 text-center text-gray-600">
            <p className="text-3xl mb-3">✦</p>
            <p className="text-sm">
              Click <span className="text-[#2AB4A6]">Analyse</span> to break this photo into
              £{targetLow}–£{targetHigh} lots
            </p>
          </div>
        )}

        {result && (
          <>
            {/* Summary */}
            <div className="bg-[#1C1C1E] border border-[#2AB4A6]/30 rounded-xl px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Photo estimate</p>
                  <p className="text-2xl font-bold text-white">
                    {money(result.totalEstimateLow)} – {money(result.totalEstimateHigh)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Lots</p>
                  <p className="text-2xl font-bold text-[#2AB4A6]">{groups.length}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {(["in", "single", "over", "under"] as Band[]).filter(b => counts[b] > 0).map(b => (
                  <span key={b} title={BAND_META[b].hint}
                    className={`text-[11px] px-2 py-0.5 rounded-full border ${BAND_META[b].ring}`}>
                    {counts[b]} {BAND_META[b].label.toLowerCase()}
                  </span>
                ))}
                {edited && (
                  <button
                    onClick={() => run.original && onResult(run.original)}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-400 hover:text-white ml-auto">
                    ↺ Reset to AI suggestion
                  </button>
                )}
              </div>

              {counts.under > 0 && (
                <p className="text-xs text-red-300/80 border-t border-gray-800 pt-2">
                  {counts.under} lot{counts.under > 1 ? "s are" : " is"} under £{targetLow} — tick the items and
                  move them into another lot to group them up.
                </p>
              )}
            </div>

            {/* Lot cards */}
            <div className="space-y-2">
              {groups.map(g => {
                const band     = bandOf(g, targetLow, targetHigh)
                const meta     = BAND_META[band]
                const isPinned = pinnedId === g.id
                const isLit    = hoverGroup === g.id || isPinned

                return (
                  <div
                    key={g.id}
                    onMouseEnter={() => setHoverGroup(g.id)}
                    onMouseLeave={() => setHoverGroup(null)}
                    className={`rounded-xl border transition-all ${isLit ? "bg-[#232325]" : "border-gray-800 bg-[#1C1C1E]"}`}
                    style={{ borderColor: isLit ? g.colour : undefined }}
                  >
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-gray-800 space-y-2">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setPinnedId(isPinned ? null : g.id)}
                          title={isPinned ? "Unpin from photo" : "Pin on photo"}
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 transition-transform hover:scale-110 ${isPinned ? "ring-2 ring-white/60" : ""}`}
                          style={{ backgroundColor: g.colour }}>
                          {g.id}
                        </button>

                        <input
                          value={g.title}
                          onChange={e => patchGroup(g.id, { title: e.target.value.slice(0, 60) })}
                          className="flex-1 min-w-0 bg-transparent text-sm font-medium text-white focus:outline-none focus:bg-[#2C2C2E] rounded px-1 py-0.5"
                        />

                        <span className={`text-[11px] px-2 py-0.5 rounded-full border flex-shrink-0 ${meta.ring}`}
                          title={meta.hint}>
                          {meta.label}
                        </span>
                        <p className="text-sm font-semibold text-[#2AB4A6] tabular-nums flex-shrink-0">
                          {money(g.estimateLow)}–{money(g.estimateHigh).replace("£", "")}
                        </p>
                      </div>

                      <BandMeter low={g.estimateLow} high={g.estimateHigh}
                        targetLow={targetLow} targetHigh={targetHigh} />

                      <div className="flex items-center gap-2 flex-wrap">
                        {g.kind === "joblot" && (
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">job lot</span>
                        )}
                        {g.confidence === "low" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                            low confidence — check this one
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            onClick={() => setSelected(new Set(g.items.map(i => i.uid)))}
                            className="text-[11px] text-gray-500 hover:text-white px-2 py-2 rounded hover:bg-[#2C2C2E]">
                            Select all
                          </button>
                          {g.items.length > 1 && (
                            <button
                              onClick={() => splitEachItem(g.id)}
                              title="Turn every item in this lot into its own lot"
                              className="text-[11px] text-gray-500 hover:text-white px-2 py-2 rounded hover:bg-[#2C2C2E]">
                              Split all
                            </button>
                          )}
                          {groups.length > 1 && (
                            <select
                              value=""
                              onChange={e => { if (e.target.value) mergeInto(g.id, Number(e.target.value)) }}
                              className="text-[11px] bg-transparent text-gray-500 hover:text-white border border-transparent hover:border-gray-700 rounded px-1 py-2 focus:outline-none cursor-pointer">
                              <option value="">Merge into…</option>
                              {groups.filter(o => o.id !== g.id).map(o => (
                                <option key={o.id} value={o.id} className="bg-[#1C1C1E]">
                                  Lot {o.id} — {o.title.slice(0, 30)} ({money(o.estimateLow)})
                                </option>
                              ))}
                            </select>
                          )}
                          <button
                            onClick={() => deleteGroup(g.id)}
                            title="Remove this lot and its items from the plan"
                            className="text-[11px] text-gray-600 hover:text-red-400 px-2.5 py-2 rounded hover:bg-[#2C2C2E]">
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Items */}
                    <div className="px-2 py-2 space-y-0.5">
                      {g.items.map(it => {
                        const isSel = selected.has(it.uid)
                        return (
                          <div
                            key={it.uid}
                            onMouseEnter={() => setHoverItem(it.uid)}
                            onMouseLeave={() => setHoverItem(null)}
                            onClick={() => toggleItem(it.uid)}
                            className={`flex items-center gap-2.5 px-2 py-2 min-h-[44px] rounded-lg cursor-pointer transition-colors ${
                              isSel ? "bg-[#2AB4A6]/15 ring-1 ring-[#2AB4A6]/40" : "hover:bg-[#2C2C2E]"
                            }`}
                          >
                            <span className={`w-[18px] h-[18px] rounded border flex items-center justify-center text-[11px] flex-shrink-0 ${
                              isSel ? "bg-[#2AB4A6] border-[#2AB4A6] text-black" : "border-gray-600 text-transparent"
                            }`}>✓</span>
                            {it.qty > 1 && (
                              <span className="text-[10px] text-gray-500 tabular-nums flex-shrink-0">{it.qty}×</span>
                            )}
                            <span className="text-xs text-gray-300 flex-1 min-w-0 truncate" title={it.name}>{it.name}</span>
                            <ValueEditor
                              key={`${it.valueLow}-${it.valueHigh}`}
                              low={it.valueLow} high={it.valueHigh}
                              onChange={(low, high) => patchItem(it.uid, { valueLow: low, valueHigh: high })}
                            />
                          </div>
                        )
                      })}
                    </div>

                    {g.notes && (
                      <p className="text-xs text-gray-500 italic border-t border-gray-800 px-4 py-2">{g.notes}</p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Selection action bar */}
            {selected.size > 0 && (
              <div className="sticky bottom-4 z-10 bg-[#2C2C2E] border border-[#2AB4A6]/50 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap shadow-2xl">
                <span className="text-sm text-white font-medium">
                  {selected.size} item{selected.size > 1 ? "s" : ""}
                </span>
                <span className="text-sm text-[#2AB4A6] tabular-nums">
                  {money(selLow)}–{money(selHigh).replace("£", "")}
                </span>
                <span className="text-gray-600">→</span>
                <select
                  value=""
                  onChange={e => { if (e.target.value) moveSelectedTo(Number(e.target.value)) }}
                  className="bg-[#1C1C1E] border border-gray-700 rounded-lg px-2 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-[#2AB4A6]">
                  <option value="">Move into lot…</option>
                  {groups.map(o => (
                    <option key={o.id} value={o.id}>
                      Lot {o.id} — {o.title.slice(0, 30)} ({money(o.estimateLow)})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => moveSelectedTo("new")}
                  className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] text-black font-semibold px-4 py-2.5 rounded-lg transition-colors">
                  Make a new lot
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-gray-400 hover:text-white ml-auto px-3 py-2.5 rounded hover:bg-[#1C1C1E]">
                  Clear
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL     = "gemini-2.5-flash-preview-04-17"
const MODEL_STORAGE_KEY = "lotting-up-model"
const BAND_STORAGE_KEY  = "lotting-up-band"

const DEFAULT_LOW  = 60
const DEFAULT_HIGH = 80

export default function LottingUpPage() {
  const [runs,      setRuns]      = useState<PhotoRun[]>([])
  const [activeIdx, setActiveIdx] = useState(0)

  const [targetLow,  setTargetLow]  = useState<number>(DEFAULT_LOW)
  const [targetHigh, setTargetHigh] = useState<number>(DEFAULT_HIGH)

  const [model,        setModel]        = useState(DEFAULT_MODEL)
  const [modelList,    setModelList]    = useState<string[]>([DEFAULT_MODEL])
  const [savedDefault, setSavedDefault] = useState(DEFAULT_MODEL)
  const [defaultSaved, setDefaultSaved] = useState(false)

  const fileRef    = useRef<HTMLInputElement>(null)
  const addMoreRef = useRef<HTMLInputElement>(null)

  // Restore saved preferences (client only — avoids a hydration mismatch).
  useEffect(() => {
    const savedModel = localStorage.getItem(MODEL_STORAGE_KEY)
    if (savedModel) { setModel(savedModel); setSavedDefault(savedModel) }
    const savedBand = localStorage.getItem(BAND_STORAGE_KEY)
    if (savedBand) {
      try {
        const { low, high } = JSON.parse(savedBand)
        if (low  > 0) setTargetLow(low)
        if (high > 0) setTargetHigh(high)
      } catch {}
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(BAND_STORAGE_KEY, JSON.stringify({ low: targetLow, high: targetHigh }))
  }, [targetLow, targetHigh])

  useEffect(() => {
    fetch("/api/auction-ai/models")
      .then(r => r.json())
      .then(j => { if (j.models?.length) setModelList(j.models) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (localStorage.getItem(MODEL_STORAGE_KEY)) return
    fetch("/api/ai-tool-model?slot=catalogue_lotting_up")
      .then(r => r.json())
      .then(j => { if (j?.model) setModel(j.model) })
      .catch(() => {})
  }, [])

  function addFiles(files: File[]) {
    const images = files.filter(f => f.type.startsWith("image/"))
    if (!images.length) return
    const newRuns: PhotoRun[] = images.map(file => ({
      file,
      url:       URL.createObjectURL(file),
      result:    null,
      original:  null,
      analysing: false,
    }))
    setRuns(prev => {
      const merged = [...prev, ...newRuns]
      setActiveIdx(merged.length - newRuns.length) // jump to first new tab
      return merged
    })
  }

  function removeRun(idx: number) {
    setRuns(prev => {
      URL.revokeObjectURL(prev[idx].url)
      const next = prev.filter((_, i) => i !== idx)
      setActiveIdx(i => Math.min(i, Math.max(0, next.length - 1)))
      return next
    })
  }

  function updateRun(idx: number, patch: Partial<PhotoRun>) {
    setRuns(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []))
    e.target.value = ""
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    addFiles(Array.from(e.dataTransfer.files))
  }

  async function analyseIdx(idx: number, file: File) {
    updateRun(idx, { analysing: true })
    try {
      const fd = new FormData()
      fd.append("photo", file)
      fd.append("model", model)
      fd.append("targetLow",  String(targetLow))
      fd.append("targetHigh", String(targetHigh))
      const res = await fetch("/api/lotting-up", { method: "POST", body: fd })
      const j   = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      updateRun(idx, { result: j, original: j, analysing: false })
    } catch (e: any) {
      updateRun(idx, { analysing: false })
      showError(`Photo ${idx + 1} failed`, e?.message ?? "Analysis failed")
    }
  }

  // Sequential with a short gap — firing every photo at once trips Gemini's rate limit.
  async function analyseAll() {
    const snapshot = runs
    for (let i = 0; i < snapshot.length; i++) {
      await analyseIdx(i, snapshot[i].file)
      if (i < snapshot.length - 1) await new Promise(r => setTimeout(r, 1000))
    }
  }

  // Combined totals across every analysed photo
  const done        = runs.filter(r => r.result)
  const overallLow  = done.reduce((s, r) => s + (r.result?.totalEstimateLow  ?? 0), 0)
  const overallHigh = done.reduce((s, r) => s + (r.result?.totalEstimateHigh ?? 0), 0)
  const overallLots = done.reduce((s, r) => s + (r.result?.groups.length     ?? 0), 0)
  const overallBands = useMemo(() => {
    const c: Record<Band, number> = { under: 0, in: 0, single: 0, over: 0 }
    done.forEach(r => r.result?.groups.forEach(g => { c[bandOf(g, targetLow, targetHigh)]++ }))
    return c
  }, [done, targetLow, targetHigh])

  const activeRun = runs[activeIdx] ?? null
  const busy      = runs.some(r => r.analysing)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Lotting Up</h1>
          <p className="text-sm text-gray-400 mt-1">
            Photograph the shelf — the AI values every item and packs them into lots worth
            <span className="text-[#2AB4A6]"> £{targetLow}–£{targetHigh}</span>.
            Anything already worth more than £{targetHigh} on its own stays a single lot.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {/* Target band */}
          <label className="text-xs text-gray-500">Target lot</label>
          <div className="flex items-center gap-1 bg-[#2C2C2E] border border-gray-700 rounded-lg px-2 py-1">
            <span className="text-gray-500 text-xs">£</span>
            <input type="number" min={1} value={targetLow}
              onChange={e => setTargetLow(Math.max(1, parseInt(e.target.value) || 0))}
              className="bg-transparent text-xs text-gray-200 w-10 focus:outline-none tabular-nums" />
            <span className="text-gray-600 text-xs">–</span>
            <span className="text-gray-500 text-xs">£</span>
            <input type="number" min={1} value={targetHigh}
              onChange={e => setTargetHigh(Math.max(1, parseInt(e.target.value) || 0))}
              className="bg-transparent text-xs text-gray-200 w-10 focus:outline-none tabular-nums" />
          </div>

          <span className="text-gray-700">|</span>

          {/* Model selector */}
          <label className="text-xs text-gray-500">Model</label>
          <select value={model} onChange={e => setModel(e.target.value)}
            className="bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-[#2AB4A6]">
            {modelList.map(m => (
              <option key={m} value={m}>{m}{m === savedDefault ? " ★" : ""}</option>
            ))}
          </select>
          {defaultSaved ? (
            <span className="text-xs text-[#2AB4A6]">✓ Saved</span>
          ) : (
            <button
              onClick={() => {
                localStorage.setItem(MODEL_STORAGE_KEY, model)
                setSavedDefault(model)
                setDefaultSaved(true)
                setTimeout(() => setDefaultSaved(false), 2000)
              }}
              disabled={model === savedDefault}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                model === savedDefault
                  ? "border-gray-700 text-gray-600 cursor-default"
                  : "border-[#2AB4A6]/50 text-[#2AB4A6] hover:bg-[#2AB4A6]/10"
              }`}
            >
              {model === savedDefault ? "★ Default" : "Set as default"}
            </button>
          )}
        </div>
      </div>

      {/* Combined totals (2+ analysed photos) */}
      {done.length >= 2 && (
        <div className="bg-[#1C1C1E] border border-[#2AB4A6]/20 rounded-xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">
              Overall estimate ({done.length} photos)
            </p>
            <p className="text-2xl font-bold text-white">{money(overallLow)} – {money(overallHigh)}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(["in", "single", "over", "under"] as Band[]).filter(b => overallBands[b] > 0).map(b => (
              <span key={b} title={BAND_META[b].hint}
                className={`text-[11px] px-2 py-0.5 rounded-full border ${BAND_META[b].ring}`}>
                {overallBands[b]} {BAND_META[b].label.toLowerCase()}
              </span>
            ))}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Total lots</p>
            <p className="text-2xl font-bold text-[#2AB4A6]">{overallLots}</p>
          </div>
        </div>
      )}

      {/* Upload drop zone */}
      {runs.length === 0 && (
        <div
          onDrop={onDrop} onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-700 hover:border-[#2AB4A6] rounded-2xl p-16 text-center cursor-pointer transition-colors group"
        >
          <div className="text-5xl mb-4">📷</div>
          <p className="text-white font-medium text-lg group-hover:text-[#2AB4A6] transition-colors">
            Drop photos here or click to upload
          </p>
          <p className="text-gray-500 text-sm mt-1">JPG, PNG, WEBP — select multiple for separate analyses</p>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onInputChange} />
        </div>
      )}

      {/* Tabs + panel */}
      {runs.length > 0 && (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {runs.map((r, i) => (
              <div key={i} className="relative flex-shrink-0 group/tab">
                <button
                  onClick={() => setActiveIdx(i)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors border ${
                    i === activeIdx
                      ? "bg-[#2C2C2E] border-[#2AB4A6]/50 text-white"
                      : "bg-[#1C1C1E] border-gray-800 text-gray-400 hover:text-white hover:bg-[#232323]"
                  }`}
                >
                  <img src={r.url} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                  <span>Photo {i + 1}</span>
                  {r.analysing && <span className="animate-spin text-[#2AB4A6] text-xs">⟳</span>}
                  {r.result && !r.analysing && (
                    <span className="text-xs text-[#2AB4A6]">
                      {r.result.groups.length} lots · {money(r.result.totalEstimateLow)}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => removeRun(i)}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 border border-gray-600 rounded-full text-gray-400 hover:text-white text-[10px] flex items-center justify-center opacity-0 group-hover/tab:opacity-100 transition-opacity"
                >×</button>
              </div>
            ))}

            <button
              onClick={() => addMoreRef.current?.click()}
              className="flex-shrink-0 px-4 py-2 rounded-xl text-sm border-2 border-dashed border-gray-700 hover:border-[#2AB4A6] text-gray-600 hover:text-[#2AB4A6] transition-colors"
            >
              + Add photo
            </button>

            {runs.length > 1 && (
              <button
                onClick={analyseAll}
                disabled={busy}
                className="flex-shrink-0 ml-auto text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-4 py-2 rounded-xl transition-colors"
              >
                {busy ? "Analysing…" : "✦ Analyse all"}
              </button>
            )}

            <input ref={addMoreRef} type="file" accept="image/*" multiple className="hidden" onChange={onInputChange} />
          </div>

          {activeRun && (
            <PhotoPanel
              key={activeIdx}
              run={activeRun}
              targetLow={targetLow}
              targetHigh={targetHigh}
              onResult={r => updateRun(activeIdx, { result: r })}
              onAnalyse={() => analyseIdx(activeIdx, activeRun.file)}
            />
          )}
        </>
      )}
    </div>
  )
}
