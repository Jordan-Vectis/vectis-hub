"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import type { LotGroup, LotItem, LottingUpResult } from "@/app/api/lotting-up/route"
import type { LottingUpAuction } from "@/app/api/lotting-up/auctions/route"
import { createLotsFromLottingUp } from "@/lib/actions/catalogue"
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

const AMBER = "#fbbf24"   // the one colour that means "not sure" — see the key on the page

type Band = "under" | "in" | "single" | "over"

const BAND_META: Record<Band, { label: string; ring: string; hint: string }> = {
  under:  { label: "Needs grouping", ring: "border-red-500/40 bg-red-500/10 text-red-300",
            hint: "Below the target band — add more items to this lot." },
  in:     { label: "In band",        ring: "border-green-500/40 bg-green-500/10 text-green-300",
            hint: "Lands in the target band." },
  single: { label: "Single lot",     ring: "border-blue-500/40 bg-blue-500/10 text-blue-300",
            hint: "Worth more than the band on its own — sells alone, no filler needed." },
  over:   { label: "Could split",    ring: "border-amber-500/40 bg-amber-500/10 text-amber-300",
            hint: "Several items well over the band — unless it's a matched set, this is more than one lot." },
}

// Judged on the REAL estimate (what it should make at hammer), never on the
// safety-margin quote figure — the band is about hammer value, not what we quote.
function bandOf(g: LotGroup, lo: number, hi: number): Band {
  if (g.estimateLow < lo) return "under"
  if (g.estimateLow > hi) return g.items.length === 1 ? "single" : "over"
  return "in"
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
    }))
  return {
    ...result,
    groups:            next,
    totalEstimateLow:  next.reduce((s, g) => s + g.estimateLow,  0),
    totalEstimateHigh: next.reduce((s, g) => s + g.estimateHigh, 0),
  }
}

const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`

// ── Adding a plan to a sale ───────────────────────────────────────────────────
//
// Lots are created in THIS app, never in Business Central. BC is only ever read:
// typing a tote looks it up in the BC-synced tote table and fills in the vendor
// and receipt, exactly as step 1 of the lot wizard does.

type ToteInfo = { toteNo: string; vendorNo: string | null; vendorName: string | null; receiptNo: string | null }

type SaleTarget = { auction: LottingUpAuction | null; tote: ToteInfo | null }

const targetReady = (t: SaleTarget) => !!t.auction && !!t.tote

/** The wizard's Next Barcode Number rule: bump the trailing digits, keep the padding. */
function bumpBarcode(src: string): string {
  const s = (src ?? "").trim().toUpperCase()
  const m = s.match(/(\d+)$/)
  if (!m || m.index === undefined) return ""
  return s.slice(0, m.index) + String(parseInt(m[1]) + 1).padStart(m[1].length, "0")
}

/**
 * The item list becomes the lot's key points.
 *
 * ⚠ Key points are treated as AUTHORITATIVE by the Batch AI run — it is forbidden
 * from overriding a stated model/catalogue number. These came from a photo, not
 * from the item in the hand, so the provenance line at the end is deliberate.
 */
function keyPointsFor(g: LotGroup): string {
  const lines = g.items.map(i => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name))
  const doubts = g.items.filter(i => i.uncertain)
  if (g.notes) lines.push("", g.notes)
  if (doubts.length) {
    lines.push("")
    doubts.forEach(i => lines.push(`Check: ${i.name} — ${i.uncertain}`))
  }
  lines.push("", "(From Lotting Up — suggested from a photo, not yet checked in the hand)")
  return lines.join("\n")
}

// ── Photo with overlay ────────────────────────────────────────────────────────

type Box = { y: number; h: number; colour: string; label: string; uncertain: boolean }

function PhotoWithOverlay({ url, index, total, boxes, dim }: {
  url: string; index: number; total: number; boxes: Box[]; dim: boolean
}) {
  return (
    <div className={`relative rounded-xl overflow-hidden border transition-opacity ${
      dim ? "border-gray-800 opacity-40" : "border-gray-700"
    }`}>
      <img src={url} alt={`Photo ${index + 1}`} className="w-full h-auto block" />

      {total > 1 && (
        <span className="absolute top-2 left-2 text-[11px] font-semibold text-white bg-black/70 px-2 py-0.5 rounded">
          Photo {index + 1}
        </span>
      )}

      {boxes.map((b, i) => (
        <div key={i}>
          <div className="absolute inset-x-0 pointer-events-none transition-all"
            style={{
              top:             `${b.y}%`,
              height:          `${b.h}%`,
              border:          `3px ${b.uncertain ? "dashed" : "solid"} ${b.uncertain ? AMBER : b.colour}`,
              backgroundColor: `${b.uncertain ? AMBER : b.colour}18`,
            }}
          />
          <div className="absolute text-white text-[11px] font-bold px-1.5 py-0.5 rounded pointer-events-none shadow-lg max-w-[70%] truncate"
            style={{ left: "6px", top: `calc(${b.y}% + 5px)`, backgroundColor: b.uncertain ? AMBER : b.colour,
                     color: b.uncertain ? "#000" : "#fff" }}>
            {b.uncertain ? "? " : ""}{b.label}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Target band slider ────────────────────────────────────────────────────────
//
// Two plain sliders rather than an overlaid dual-range: overlapping range inputs
// are fiddly on a tablet, and these are used standing at a bench.

const BAND_MIN  = 10
const BAND_MAX  = 500
const BAND_STEP = 5

function BandSlider({ low, high, onChange }: {
  low: number; high: number; onChange: (low: number, high: number) => void
}) {
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="min-w-[13rem] flex-1">
        <label className="flex items-baseline justify-between text-xs text-gray-500 uppercase tracking-wider mb-1">
          <span>Lot worth at least</span>
          <span className="text-[#2AB4A6] text-base font-bold tabular-nums normal-case">£{low}</span>
        </label>
        <input
          type="range" min={BAND_MIN} max={BAND_MAX} step={BAND_STEP} value={low}
          onChange={e => {
            const v = Number(e.target.value)
            onChange(v, Math.max(v, high))
          }}
          className="w-full accent-[#2AB4A6] h-6"
        />
      </div>

      <div className="min-w-[13rem] flex-1">
        <label className="flex items-baseline justify-between text-xs text-gray-500 uppercase tracking-wider mb-1">
          <span>…and no more than</span>
          <span className="text-[#2AB4A6] text-base font-bold tabular-nums normal-case">£{high}</span>
        </label>
        <input
          type="range" min={BAND_MIN} max={BAND_MAX} step={BAND_STEP} value={high}
          onChange={e => {
            const v = Number(e.target.value)
            onChange(Math.min(v, low), v)
          }}
          className="w-full accent-[#2AB4A6] h-6"
        />
      </div>
    </div>
  )
}

// ── Band meter ────────────────────────────────────────────────────────────────

function BandMeter({ low, high, targetLow, targetHigh }: {
  low: number; high: number; targetLow: number; targetHigh: number
}) {
  const scaleMax = Math.max(targetHigh * 2.5, high * 1.15, targetLow + 1)
  const pct = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`

  return (
    <div className="relative h-1.5 rounded-full bg-[#2C2C2E] overflow-hidden">
      <div className="absolute inset-y-0 bg-white/10"
        style={{ left: pct(targetLow), width: `calc(${pct(targetHigh)} - ${pct(targetLow)})` }} />
      <div className="absolute inset-y-0 rounded-full bg-gray-500"
        style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})`, minWidth: "2px" }} />
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

// ── Sale + vendor bar ─────────────────────────────────────────────────────────

function SaleTargetBar({ target, onChange }: {
  target: SaleTarget; onChange: (t: SaleTarget) => void
}) {
  const [auctions, setAuctions] = useState<LottingUpAuction[]>([])
  const [toteText, setToteText] = useState(target.tote?.toteNo ?? "")
  const [looking,  setLooking]  = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch("/api/lotting-up/auctions")
      .then(r => r.json())
      .then(j => { if (j.auctions) setAuctions(j.auctions) })
      .catch(() => {})
  }, [])

  // Debounced tote lookup — same endpoint and same BC-synced table as the wizard.
  // Clearing is handled in the input's handler, so this effect never sets state
  // synchronously; it only reacts to a real query.
  useEffect(() => {
    const q = toteText.trim()
    if (!q) return
    if (target.tote && target.tote.toteNo.toUpperCase() === q.toUpperCase()) return

    let cancelled = false
    const t = setTimeout(() => {
      setLooking(true)
      fetch(`/api/warehouse/tote-search?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then((rows: ToteInfo[]) => {
          if (cancelled) return
          const hit = Array.isArray(rows)
            ? rows.find(r => r.toteNo.toUpperCase() === q.toUpperCase()) ?? null
            : null
          setNotFound(!hit)
          onChange({ ...target, tote: hit })
        })
        .catch(() => { if (!cancelled) setNotFound(true) })
        .finally(() => { if (!cancelled) setLooking(false) })
    }, 350)

    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toteText])

  const a = target.auction

  return (
    <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl px-5 py-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-medium text-white">Add these lots to a sale</p>
        <span className="text-xs text-gray-500">
          Lots are created in the Hub. Business Central is only read, to fill in the vendor and receipt.
        </span>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        <div className="space-y-1">
          <label className="text-[11px] text-gray-500 uppercase tracking-wider block">Sale</label>
          <select
            value={a?.id ?? ""}
            onChange={e => onChange({ ...target, auction: auctions.find(x => x.id === e.target.value) ?? null })}
            className="bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-[#2AB4A6] min-w-[16rem]">
            <option value="">Choose a sale…</option>
            {auctions.map(x => (
              <option key={x.id} value={x.id}>
                {x.code.toUpperCase()} — {x.name} ({x.lotCount} lots)
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-gray-500 uppercase tracking-wider block">
            Tote number <span className="text-gray-600 normal-case tracking-normal">— vendor &amp; receipt fill in from BC</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              value={toteText}
              onChange={e => {
                const v = e.target.value.toUpperCase()
                setToteText(v)
                if (!v.trim()) { setNotFound(false); onChange({ ...target, tote: null }) }
              }}
              placeholder="Scan or type the tote…"
              className="bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-[#2AB4A6] w-56"
            />
            {toteText && (
              <button
                onClick={() => { setToteText(""); setNotFound(false); onChange({ ...target, tote: null }) }}
                title="Clear vendor details"
                className="text-gray-500 hover:text-white px-3 py-2.5 rounded border border-gray-700 text-sm">✕</button>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-[14rem] pb-1">
          {looking && <p className="text-xs text-gray-500">Looking up tote…</p>}
          {!looking && target.tote && (
            <div className="text-xs space-y-0.5">
              <p className="text-gray-400">
                Vendor <span className="text-[#2AB4A6] font-medium">{target.tote.vendorNo ?? "—"}</span>
                {target.tote.vendorName ? <span className="text-gray-500"> · {target.tote.vendorName}</span> : null}
              </p>
              <p className="text-gray-400">
                Receipt <span className="text-[#2AB4A6] font-medium">{target.tote.receiptNo ?? "—"}</span>
              </p>
            </div>
          )}
          {!looking && !target.tote && notFound && (
            <p className="text-xs text-red-300">
              Tote <strong>{toteText}</strong> isn&apos;t in the BC tote data — check the number, or that the warehouse sync has run.
            </p>
          )}
        </div>
      </div>

      {a?.addedToBC && (
        <p className="text-xs text-amber-300 border-t border-gray-800 pt-2">
          ⚠ {a.code.toUpperCase()} is marked <strong>Added to BC</strong> and is locked — only an admin can add lots to it.
        </p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL     = "gemini-2.5-flash-preview-04-17"
const MODEL_STORAGE_KEY = "lotting-up-model"
const BAND_STORAGE_KEY  = "lotting-up-band"
const MAX_PHOTOS        = 10

const DEFAULT_LOW    = 60
const DEFAULT_HIGH   = 80
const DEFAULT_MARGIN = 35   // matches the Valuations tab

type Photo = { file: File; url: string }

export default function LottingUpPage() {
  const [photos,    setPhotos]    = useState<Photo[]>([])
  const [result,    setResult]    = useState<LottingUpResult | null>(null)
  const [original,  setOriginal]  = useState<LottingUpResult | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [stale,     setStale]     = useState(false)   // photos changed since the last analysis

  const [targetLow,  setTargetLow]  = useState(DEFAULT_LOW)
  const [targetHigh, setTargetHigh] = useState(DEFAULT_HIGH)
  const [margin,     setMargin]     = useState(DEFAULT_MARGIN)
  // The band the current plan was actually GROUPED for. Sliding the band
  // re-judges the lots instantly, but only a re-analysis rebuilds them — so the
  // page has to be honest about which band the grouping came from.
  const [analysedBand, setAnalysedBand] = useState<{ low: number; high: number } | null>(null)

  const [model,        setModel]        = useState(DEFAULT_MODEL)
  const [modelList,    setModelList]    = useState<string[]>([DEFAULT_MODEL])
  const [savedDefault, setSavedDefault] = useState(DEFAULT_MODEL)
  const [defaultSaved, setDefaultSaved] = useState(false)

  // Interaction
  const [hoverGroup, setHoverGroup] = useState<number | null>(null)
  const [hoverItem,  setHoverItem]  = useState<string | null>(null)
  const [pinnedId,   setPinnedId]   = useState<number | null>(null)
  const [selected,   setSelected]   = useState<Set<string>>(new Set())

  // Sale + vendor, and the lots already created from this plan
  const [target,    setTarget]    = useState<SaleTarget>({ auction: null, tote: null })
  const [barcodes,  setBarcodes]  = useState<Record<string, string>>({})
  const [added,     setAdded]     = useState<Record<string, string>>({})
  const [saving,    setSaving]    = useState(false)
  const [confirm,   setConfirm]   = useState<{ gid: string; title: string; barcode: string }[] | null>(null)
  const [report,    setReport]    = useState<{ created: number; skipped: { barcode: string; reason: string }[] } | null>(null)

  const fileRef    = useRef<HTMLInputElement>(null)
  const addMoreRef = useRef<HTMLInputElement>(null)

  // ── Preferences ──

  useEffect(() => {
    const savedModel = localStorage.getItem(MODEL_STORAGE_KEY)
    if (savedModel) { setModel(savedModel); setSavedDefault(savedModel) }
    const savedBand = localStorage.getItem(BAND_STORAGE_KEY)
    if (savedBand) {
      try {
        const { low, high, margin: m } = JSON.parse(savedBand)
        if (low  > 0) setTargetLow(low)
        if (high > 0) setTargetHigh(high)
        if (typeof m === "number") setMargin(m)
      } catch {}
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(BAND_STORAGE_KEY, JSON.stringify({ low: targetLow, high: targetHigh, margin }))
  }, [targetLow, targetHigh, margin])

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setSelected(new Set()) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // ── Photos ──

  function addFiles(files: File[]) {
    const images = files.filter(f => f.type.startsWith("image/"))
    if (!images.length) return
    const room = MAX_PHOTOS - photos.length
    if (room <= 0) return
    const next = images.slice(0, room).map(file => ({ file, url: URL.createObjectURL(file) }))
    setPhotos(prev => [...prev, ...next])
    // Appending is safe — existing photo indices don't move, the plan just
    // doesn't cover the new ones yet.
    if (photos.length && result) setStale(true)
  }

  function removePhoto(idx: number) {
    // Removing renumbers the photos, which would point every existing item at
    // the wrong image — so the plan goes with it rather than quietly misleading.
    if (result && !confirmDrop()) return
    setPhotos(prev => {
      URL.revokeObjectURL(prev[idx].url)
      return prev.filter((_, i) => i !== idx)
    })
    if (result) { setResult(null); setOriginal(null); setStale(false); setAdded({}); setBarcodes({}) }
  }

  function confirmDrop() {
    return window.confirm("Removing a photo clears the current lot plan, because the lots are pinned to photo positions. Carry on?")
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []))
    e.target.value = ""
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    addFiles(Array.from(e.dataTransfer.files))
  }

  // ── Analysis ──

  async function analyse() {
    if (!photos.length || analysing) return
    setAnalysing(true)
    try {
      const fd = new FormData()
      photos.forEach(p => fd.append("photo", p.file))
      fd.append("model", model)
      fd.append("targetLow",  String(targetLow))
      fd.append("targetHigh", String(targetHigh))
      const res = await fetch("/api/lotting-up", { method: "POST", body: fd })
      const j   = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setResult(j)
      setOriginal(j)
      setAnalysedBand({ low: targetLow, high: targetHigh })
      setStale(false)
      setAdded({})
      setBarcodes({})
      setReport(null)
    } catch (e: any) {
      showError("Analysis failed", e?.message ?? "Unknown error")
    } finally {
      setAnalysing(false)
    }
  }

  // ── Derived ──

  const groups = useMemo(() => result?.groups ?? [], [result])
  const keep   = 1 - margin / 100
  const quote  = (n: number) => Math.round(n * keep)

  const activeId = hoverGroup ?? pinnedId
  const activeGroup = activeId !== null ? groups.find(g => g.id === activeId) ?? null : null

  const uncertainItems = useMemo(
    () => groups.flatMap(g => g.items.filter(i => i.uncertain).map(i => ({ g, i }))),
    [groups],
  )

  const archivePriced = useMemo(
    () => groups.reduce((s, g) => s + g.items.filter(i => i.pricedFrom === "archive").length, 0),
    [groups],
  )

  /** Boxes to draw on each photo, given what's hovered/pinned. */
  const boxesByPhoto = useMemo(() => {
    const out: Box[][] = Array.from({ length: photos.length }, () => [])
    const push = (i: LotItem, colour: string, label: string) => {
      if (i.photo < out.length) out[i.photo].push({ y: i.bounds.y, h: i.bounds.h, colour, label, uncertain: !!i.uncertain })
    }

    if (hoverItem) {
      for (const g of groups) {
        const it = g.items.find(x => x.uid === hoverItem)
        if (it) { push(it, g.colour, it.name.slice(0, 30)); return out }
      }
    }
    if (activeGroup) {
      activeGroup.items.forEach(i => push(i, activeGroup.colour, `Lot ${activeGroup.id}`))
      return out
    }
    // Resting state: show what the AI wasn't sure about.
    uncertainItems.forEach(({ i }) => push(i, AMBER, i.name.slice(0, 30)))
    return out
  }, [photos.length, groups, hoverItem, activeGroup, uncertainItems])

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

  const edited = !!result && !!original && JSON.stringify(result.groups) !== JSON.stringify(original.groups)

  const bandMoved = !!result && !!analysedBand &&
    (analysedBand.low !== targetLow || analysedBand.high !== targetHigh)

  const ready   = targetReady(target)
  const pending = groups.filter(g => !added[g.gid])

  // ── Plan editing ──

  function apply(next: LotGroup[]) {
    if (!result) return
    setResult(recalc(result, next))
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
        gid:          crypto.randomUUID(),
        id:           0,   // recalc renumbers
        title:        moving.length === 1 ? moving[0].name.slice(0, 60) : "New lot",
        kind:         moving.length === 1 ? "single" : "grouped",
        items:        moving,
        estimateLow:  0,
        estimateHigh: 0,
        notes:        "",
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
    // Fresh gid per split — they are new lots, and a shared gid would make them
    // all look "already added" the moment one of them was.
    const singles: LotGroup[] = g.items.map(it => ({
      ...g,
      gid:   crypto.randomUUID(),
      id:    0,
      title: it.name.slice(0, 60),
      kind:  "single" as const,
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
    apply(result.groups.map(g => ({ ...g, items: g.items.map(i => i.uid === uid ? { ...i, ...patch } : i) })))
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

  // ── Adding to a sale ──

  /**
   * Number every un-added lot BELOW this one, running on from its barcode.
   * Driven from the lot in hand rather than a box at the top of the page.
   */
  function fillBarcodesFrom(startIdx: number) {
    const start = (barcodes[groups[startIdx]?.gid] ?? "").trim().toUpperCase()
    if (!start) return
    const next = { ...barcodes }
    let code = start
    for (let i = startIdx + 1; i < groups.length; i++) {
      const g = groups[i]
      if (added[g.gid]) continue          // already created — don't reuse its number
      const bumped = bumpBarcode(code)
      if (!bumped) break                  // no trailing digits — leave the rest blank
      next[g.gid] = bumped
      code = bumped
    }
    setBarcodes(next)
  }

  async function addLots(list: LotGroup[]) {
    if (!target.auction || !target.tote || !list.length) return
    setSaving(true)
    setReport(null)
    try {
      const res = await createLotsFromLottingUp(
        target.auction.id,
        { vendor: target.tote.vendorNo ?? "", tote: target.tote.toteNo, receipt: target.tote.receiptNo ?? "" },
        list.map(g => ({
          gid:          g.gid,
          barcode:      (barcodes[g.gid] ?? "").trim(),
          title:        g.title,
          keyPoints:    keyPointsFor(g),
          estimateLow:  g.estimateLow  || null,
          estimateHigh: g.estimateHigh || null,
        })),
      )
      if (res.created.length) {
        setAdded(prev => {
          const next = { ...prev }
          res.created.forEach(c => { next[c.gid] = c.barcode })
          return next
        })
      }
      // Always report, including the all-skipped case — "nothing happened" must
      // never read as success.
      setReport({ created: res.created.length, skipped: res.skipped })
      if (!res.ok && res.error && !res.skipped.length) showError("Could not add the lots", res.error)
    } catch (e: any) {
      showError("Could not add the lots", e?.message ?? "Unknown error")
    } finally {
      setSaving(false)
      setConfirm(null)
    }
  }

  // ── Render ──

  return (
    <div className="p-6 max-w-[1800px] mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Lotting Up</h1>
          <p className="text-sm text-gray-400 mt-1">
            Photograph the bench — the AI values every item and packs them into lots worth
            <span className="text-[#2AB4A6]"> £{targetLow}–£{targetHigh}</span>.
            Anything already worth more than £{targetHigh} on its own stays a single lot.
            Several photos of the same layout are read together, so a lot can span them.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
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

      {/* Target band — slide it and every lot re-bands live */}
      <div className="bg-[#1C1C1E] border border-[#2AB4A6]/25 rounded-xl px-5 py-4 space-y-3">
        <BandSlider
          low={targetLow} high={targetHigh}
          onChange={(lo, hi) => { setTargetLow(lo); setTargetHigh(hi) }}
        />

        {result ? (
          <div className="flex items-center gap-2 flex-wrap border-t border-gray-800 pt-3">
            {(["in", "single", "over", "under"] as Band[]).filter(b => counts[b] > 0).map(b => (
              <span key={b} title={BAND_META[b].hint}
                className={`text-[11px] px-2 py-0.5 rounded-full border ${BAND_META[b].ring}`}>
                {counts[b]} {BAND_META[b].label.toLowerCase()}
              </span>
            ))}
            {bandMoved ? (
              <div className="ml-auto flex items-center gap-3">
                <span className="text-[11px] text-amber-300">
                  Judged at £{targetLow}–£{targetHigh}, but grouped for £{analysedBand!.low}–£{analysedBand!.high}
                </span>
                <button
                  onClick={analyse}
                  disabled={analysing}
                  className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-4 py-2.5 rounded-lg transition-colors">
                  {analysing ? "Regrouping…" : `Regroup at £${targetLow}–£${targetHigh}`}
                </button>
              </div>
            ) : (
              <span className="ml-auto text-[11px] text-gray-600">
                Slide the band to re-judge these lots. Regroup to have the AI rebuild them around a new band.
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-600 border-t border-gray-800 pt-3">
            Items are grouped up until a lot is worth this much. Anything already worth more than
            £{targetHigh} on its own is left as a single lot.
          </p>
        )}
      </div>

      <SaleTargetBar target={target} onChange={setTarget} />

      {/* Upload */}
      {photos.length === 0 ? (
        <div
          onDrop={onDrop} onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-700 hover:border-[#2AB4A6] rounded-2xl p-16 text-center cursor-pointer transition-colors group"
        >
          <div className="text-5xl mb-4">📷</div>
          <p className="text-white font-medium text-lg group-hover:text-[#2AB4A6] transition-colors">
            Drop photos here or click to upload
          </p>
          <p className="text-gray-500 text-sm mt-1">
            JPG, PNG, WEBP · up to {MAX_PHOTOS} · several photos of the same bench are read as one layout
          </p>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onInputChange} />
        </div>
      ) : (
        <div className="bg-[#1C1C1E] border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            {photos.length} photo{photos.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {photos.map((p, i) => (
              <div key={i} className="relative group/thumb">
                <img src={p.url} alt="" className="w-12 h-12 rounded object-cover border border-gray-700" />
                <span className="absolute bottom-0 left-0 text-[9px] bg-black/70 text-white px-1 rounded-tr">{i + 1}</span>
                <button
                  onClick={() => removePhoto(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-900 border border-gray-600 rounded-full text-gray-400 hover:text-white text-[10px] flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                >×</button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button
                onClick={() => addMoreRef.current?.click()}
                className="w-12 h-12 rounded border-2 border-dashed border-gray-700 hover:border-[#2AB4A6] text-gray-600 hover:text-[#2AB4A6] text-lg">
                +
              </button>
            )}
          </div>
          <input ref={addMoreRef} type="file" accept="image/*" multiple className="hidden" onChange={onInputChange} />

          {stale && (
            <span className="text-xs text-amber-300">
              ⚠ Photos changed since the last run — re-analyse to include them.
            </span>
          )}

          <button
            onClick={analyse}
            disabled={analysing}
            className="ml-auto text-sm bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-5 py-2.5 rounded-lg transition-colors">
            {analysing ? "Analysing…" : result ? "Re-analyse" : `✦ Analyse ${photos.length} photo${photos.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {analysing && (
        <div className="flex items-center gap-3 text-sm text-gray-400 bg-[#1C1C1E] border border-gray-800 rounded-xl px-4 py-3">
          <span className="animate-spin text-[#2AB4A6]">⟳</span>
          Reading {photos.length} photo{photos.length === 1 ? "" : "s"}, valuing every item and packing
          them into £{targetLow}–£{targetHigh} lots…
        </div>
      )}

      {/* Summary + safety margin */}
      {result && (
        <div className="bg-[#1C1C1E] border border-[#2AB4A6]/30 rounded-xl px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="min-w-[15rem]">
              <label htmlFor="margin" className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
                Safety margin — {margin}% under
              </label>
              <input
                id="margin" type="range" min={0} max={50} step={5}
                value={margin} onChange={e => setMargin(Number(e.target.value))}
                className="w-full accent-[#2AB4A6] h-6"
              />
              <p className="text-xs text-gray-600 mt-1">The house quotes 30–40% below what things really make.</p>
            </div>

            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Est. sale total</p>
              <p className={`text-xl font-semibold ${margin > 0 ? "text-gray-400 line-through decoration-gray-700" : "text-white"}`}>
                {money(result.totalEstimateLow)} – {money(result.totalEstimateHigh)}
              </p>
            </div>

            {margin > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider mb-1 text-[#2AB4A6]">Quote this</p>
                <p className="text-3xl font-bold text-white">
                  {money(quote(result.totalEstimateLow))} – {money(quote(result.totalEstimateHigh))}
                </p>
              </div>
            )}

            <div className="text-right ml-auto">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Lots</p>
              <p className="text-2xl font-bold text-[#2AB4A6]">{groups.length}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap border-t border-gray-800 pt-3">
            {uncertainItems.length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
                {uncertainItems.length} item{uncertainItems.length === 1 ? "" : "s"} to check
              </span>
            )}
            {archivePriced > 0 && (
              <span title="Priced from our own sold archive (median of single-item hammer results) rather than the model's guess"
                className="text-[11px] px-2 py-0.5 rounded-full border border-[#2AB4A6]/40 bg-[#2AB4A6]/10 text-[#2AB4A6]">
                {archivePriced} priced from our sold archive
              </span>
            )}
            <span className="text-[11px] text-gray-600">
              — band judged on the real estimate, not the quote figure
            </span>
            {edited && (
              <button
                onClick={() => original && setResult(original)}
                className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-400 hover:text-white ml-auto">
                ↺ Reset to AI suggestion
              </button>
            )}
          </div>

          {result.sceneNotes && <p className="text-xs text-gray-500 italic">{result.sceneNotes}</p>}

          {counts.under > 0 && (
            <p className="text-xs text-red-300/80">
              {counts.under} lot{counts.under > 1 ? "s are" : " is"} under £{targetLow} — tick the items and
              move them into another lot to group them up.
            </p>
          )}
        </div>
      )}

      {/* Not sure about these */}
      {result && uncertainItems.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 space-y-2">
          <p className="text-sm text-amber-200">
            ⚠ Not confident on {uncertainItems.length} item{uncertainItems.length === 1 ? "" : "s"} —
            these are marked with a dashed amber box on the photos. Check them in the hand.
          </p>
          <div className="space-y-1">
            {uncertainItems.map(({ g, i }) => (
              <div
                key={i.uid}
                onMouseEnter={() => setHoverItem(i.uid)}
                onMouseLeave={() => setHoverItem(null)}
                className="text-xs flex items-start gap-2 hover:bg-amber-500/10 rounded px-2 py-1.5 cursor-default">
                <span className="text-amber-400 flex-shrink-0">Lot {g.id}</span>
                <span className="text-gray-300 flex-shrink-0">{i.name}</span>
                <span className="text-amber-200/70">— {i.uncertain}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Photos + lots */}
      {result && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

          {/* Left — every photo, marked up */}
          <div className="space-y-3 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto pr-1">
            {photos.map((p, i) => (
              <PhotoWithOverlay
                key={i}
                url={p.url}
                index={i}
                total={photos.length}
                boxes={boxesByPhoto[i] ?? []}
                dim={!!activeGroup && (boxesByPhoto[i]?.length ?? 0) === 0}
              />
            ))}
            <p className="text-xs text-gray-600">
              Hover a lot or an item to light it up. Solid box = the lot you&apos;re looking at ·
              <span className="text-amber-300"> dashed amber box = the AI isn&apos;t sure</span>.
            </p>
          </div>

          {/* Right — the plan */}
          <div className="space-y-4">

            {!ready && (
              <p className="text-xs text-gray-600 bg-[#1C1C1E] border border-gray-800 rounded-xl px-4 py-3">
                Choose a sale and scan a tote at the top of the page to add these lots to a sale.
              </p>
            )}

            {/* What actually happened */}
            {report && (
              <div className={`rounded-xl border px-4 py-3 space-y-1 ${
                report.created > 0 ? "border-green-600/40 bg-green-950/20" : "border-red-600/40 bg-red-950/20"
              }`}>
                <p className={`text-sm ${report.created > 0 ? "text-green-300" : "text-red-300"}`}>
                  {report.created > 0
                    ? `✓ Created ${report.created} lot${report.created === 1 ? "" : "s"} in ${target.auction?.code.toUpperCase()}`
                    : "No lots were created."}
                </p>
                {report.skipped.map((s, i) => (
                  <p key={i} className="text-xs text-amber-300/90">
                    Skipped {s.barcode || "(no barcode)"} — {s.reason}
                  </p>
                ))}
                <button onClick={() => setReport(null)} className="text-[11px] text-gray-500 hover:text-white pt-1">dismiss</button>
              </div>
            )}

            {/* Lot cards */}
            <div className="space-y-2">
              {groups.map((g, gIdx) => {
                const band     = bandOf(g, targetLow, targetHigh)
                const meta     = BAND_META[band]
                const isPinned = pinnedId === g.id
                const isLit    = hoverGroup === g.id || isPinned
                const photosIn = Array.from(new Set(g.items.map(i => i.photo))).sort((a, b) => a - b)

                return (
                  <div
                    key={g.gid}
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
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-[#2AB4A6] tabular-nums">
                            {money(g.estimateLow)}–{money(g.estimateHigh).replace("£", "")}
                          </p>
                          {margin > 0 && (
                            <p className="text-[10px] text-gray-500 tabular-nums">
                              quote {money(quote(g.estimateLow))}–{money(quote(g.estimateHigh)).replace("£", "")}
                            </p>
                          )}
                        </div>
                      </div>

                      <BandMeter low={g.estimateLow} high={g.estimateHigh}
                        targetLow={targetLow} targetHigh={targetHigh} />

                      <div className="flex items-center gap-2 flex-wrap">
                        {photos.length > 1 && (
                          <span className="text-[10px] text-gray-500">
                            photo{photosIn.length > 1 ? "s" : ""} {photosIn.map(p => p + 1).join(", ")}
                          </span>
                        )}
                        {g.kind === "joblot" && (
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">job lot</span>
                        )}
                        {g.items.some(i => i.uncertain) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                            ? needs checking
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
                                <option key={o.gid} value={o.id} className="bg-[#1C1C1E]">
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
                            className={`px-2 py-2 min-h-[44px] rounded-lg cursor-pointer transition-colors ${
                              isSel ? "bg-[#2AB4A6]/15 ring-1 ring-[#2AB4A6]/40" : "hover:bg-[#2C2C2E]"
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className={`w-[18px] h-[18px] rounded border flex items-center justify-center text-[11px] flex-shrink-0 ${
                                isSel ? "bg-[#2AB4A6] border-[#2AB4A6] text-black" : "border-gray-600 text-transparent"
                              }`}>✓</span>
                              {it.qty > 1 && (
                                <span className="text-[10px] text-gray-500 tabular-nums flex-shrink-0">{it.qty}×</span>
                              )}
                              {it.uncertain && <span className="text-amber-400 text-xs flex-shrink-0" title="Not confident">?</span>}
                              <span className="text-xs text-gray-300 flex-1 min-w-0 truncate" title={it.name}>{it.name}</span>
                              {photos.length > 1 && (
                                <span className="text-[10px] text-gray-600 flex-shrink-0">p{it.photo + 1}</span>
                              )}
                              <ValueEditor
                                key={`${it.valueLow}-${it.valueHigh}`}
                                low={it.valueLow} high={it.valueHigh}
                                onChange={(low, high) => patchItem(it.uid, { valueLow: low, valueHigh: high })}
                              />
                            </div>
                            {it.uncertain && (
                              <p className="text-[11px] text-amber-300/80 pl-[28px] pt-0.5">{it.uncertain}</p>
                            )}
                            {/* What our own sold archive says. When it priced the
                                item, show the AI figure it replaced — the gap is
                                the whole point. */}
                            {it.archive && (
                              <p className="text-[11px] pl-[28px] pt-0.5">
                                {it.pricedFrom === "archive" ? (
                                  <>
                                    <span className="text-[#2AB4A6]">
                                      our archive: {money(it.archive.median)} median of {it.archive.count} sale
                                      {it.archive.count === 1 ? "" : "s"}
                                    </span>
                                    {(it.aiValueLow !== it.valueLow || it.aiValueHigh !== it.valueHigh) && (
                                      <span className="text-gray-600">
                                        {" "}· AI said {money(it.aiValueLow)}–{money(it.aiValueHigh).replace("£", "")}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-gray-600">
                                    only {it.archive.count} comparable sale{it.archive.count === 1 ? "" : "s"} —
                                    kept the AI figure
                                  </span>
                                )}
                                {it.archive.groupedExcluded > 0 && (
                                  <span className="text-gray-700"> · {it.archive.groupedExcluded} group lot
                                    {it.archive.groupedExcluded === 1 ? "" : "s"} ignored</span>
                                )}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {g.notes && (
                      <p className="text-xs text-gray-500 italic border-t border-gray-800 px-4 py-2">{g.notes}</p>
                    )}

                    {/* Barcode + add */}
                    {ready && (added[g.gid] ? (
                      <p className="text-xs text-green-300 border-t border-gray-800 px-4 py-2.5">
                        ✓ Added to {target.auction!.code.toUpperCase()} as <strong>{added[g.gid]}</strong>
                      </p>
                    ) : (
                      <div className="border-t border-gray-800 px-4 py-2.5 flex items-center gap-2 flex-wrap">
                        <input
                          value={barcodes[g.gid] ?? ""}
                          onChange={e => setBarcodes(p => ({ ...p, [g.gid]: e.target.value.toUpperCase() }))}
                          placeholder="Scan or type barcode…"
                          className="bg-[#2C2C2E] border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 flex-1 min-w-[9rem] focus:outline-none focus:border-[#2AB4A6]"
                        />
                        <button
                          onClick={() => {
                            // Take the nearest barcode above this lot and bump it.
                            let src = ""
                            for (let i = gIdx - 1; i >= 0; i--) {
                              const b = (added[groups[i].gid] ?? barcodes[groups[i].gid] ?? "").trim()
                              if (b) { src = b; break }
                            }
                            const next = bumpBarcode(src)
                            if (next) setBarcodes(p => ({ ...p, [g.gid]: next }))
                          }}
                          title="Next barcode number, from the lot above"
                          className="text-xs text-[#2AB4A6] border border-[#2AB4A6]/50 hover:bg-[#2AB4A6]/10 px-3 py-2 rounded-lg">
                          ⊕ Next
                        </button>
                        {/* Fill the rest FROM HERE — the barcode you just scanned is
                            the one you're holding, so this belongs on the lot, not
                            in a box at the top of the page. */}
                        {(barcodes[g.gid] ?? "").trim() && gIdx < groups.length - 1 && (
                          <button
                            onClick={() => fillBarcodesFrom(gIdx)}
                            title="Number the lots below this one sequentially from this barcode"
                            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-2 rounded-lg">
                            ↓ Number the rest
                          </button>
                        )}
                        <button
                          onClick={() => addLots([g])}
                          disabled={saving || !(barcodes[g.gid] ?? "").trim()}
                          className="text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-3 py-2 rounded-lg transition-colors">
                          {saving ? "…" : "Add lot"}
                        </button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            {/* Add-all — sticky, so it's reachable from wherever you are in the
                list rather than living at the top out of sight. Gives way to the
                selection bar when items are ticked. */}
            {ready && selected.size === 0 && pending.some(g => (barcodes[g.gid] ?? "").trim()) && (
              <div className="sticky bottom-4 z-10 bg-[#2C2C2E] border border-[#2AB4A6]/50 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap shadow-2xl">
                <span className="text-sm text-white font-medium">
                  {pending.filter(g => (barcodes[g.gid] ?? "").trim()).length} lot
                  {pending.filter(g => (barcodes[g.gid] ?? "").trim()).length === 1 ? "" : "s"} barcoded
                </span>
                <span className="text-xs text-gray-500">
                  {pending.filter(g => !(barcodes[g.gid] ?? "").trim()).length} still without a barcode
                </span>
                <button
                  onClick={() => setConfirm(
                    pending
                      .filter(g => (barcodes[g.gid] ?? "").trim())
                      .map(g => ({ gid: g.gid, title: g.title, barcode: (barcodes[g.gid] ?? "").trim().toUpperCase() }))
                  )}
                  disabled={saving}
                  className="ml-auto text-xs bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-4 py-2.5 rounded-lg transition-colors">
                  Add them to {target.auction!.code.toUpperCase()}
                </button>
              </div>
            )}

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
                    <option key={o.gid} value={o.id}>
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
          </div>
        </div>
      )}

      {/* Add all — confirm before writing anything */}
      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setConfirm(null)}>
          <div className="bg-[#1C1C1E] border border-gray-700 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-800">
              <p className="text-white font-medium">
                Create {confirm.length} lot{confirm.length === 1 ? "" : "s"} in {target.auction?.code.toUpperCase()}?
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Vendor {target.tote?.vendorNo ?? "—"} · Receipt {target.tote?.receiptNo ?? "—"} · Tote {target.tote?.toteNo}
              </p>
            </div>
            <div className="px-5 py-3 space-y-1">
              {confirm.map(c => (
                <div key={c.gid} className="flex items-center gap-3 text-xs">
                  <span className="text-[#2AB4A6] font-mono flex-shrink-0">{c.barcode}</span>
                  <span className="text-gray-400 truncate">{c.title}</span>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex items-center gap-2">
              <button
                onClick={() => addLots(pending.filter(g => confirm.some(c => c.gid === g.gid)))}
                disabled={saving}
                className="text-sm bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-4 py-2.5 rounded-lg">
                {saving ? "Creating…" : "Create them"}
              </button>
              <button onClick={() => setConfirm(null)}
                className="text-sm text-gray-400 hover:text-white px-4 py-2.5 rounded-lg border border-gray-700">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
