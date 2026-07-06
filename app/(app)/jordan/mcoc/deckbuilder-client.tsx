"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import ModelPicker, { getJordanModel } from "../model-picker"
import { classColour, normChampName } from "@/lib/mcoc"
import { applyBgsDeck } from "@/lib/actions/mcoc"
import type { Champ } from "./mcoc-hub"

// 🃏 DECK BUILDER — photograph the Battlegrounds season's nodes/meta and get a
// recommended full deck built from the roster, with an "apply as my BGS deck"
// button.

const GREEN = "#33ff66"

type DeckEntry = { champion: string; role: "Attacker" | "Defender" | "Flex"; why: string }
type Result = { deck: DeckEntry[]; strategy: string; watchouts: string }

const ROLE_COLOUR: Record<string, string> = { Attacker: "#4bff6a", Defender: "#ff5a5a", Flex: "#ffd23f" }

export default function DeckBuilderClient({ roster }: { roster: Champ[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [size, setSize] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [applied, setApplied] = useState(false)

  const ownedByName = new Map(roster.map((c) => [normChampName(c.name), c]))

  function pick(f: File | null) {
    setFile(f)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  async function build() {
    if (busy || (!file && !notes.trim())) return
    setBusy(true); setError(null); setResult(null); setApplied(false)
    try {
      const fd = new FormData()
      if (file) fd.append("image", file)
      if (notes.trim()) fd.append("notes", notes.trim())
      fd.append("size", String(size))
      fd.append("roster", JSON.stringify(roster.map((c) => ({ name: c.name, stars: c.stars, rank: c.rank }))))
      const model = getJordanModel(); if (model) fd.append("model", model)
      const res = await fetch("/api/jordan/mcoc/deck-builder", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Build failed — try again.")
      setResult(j)
    } catch (e: any) {
      setError(e?.message ?? "Build failed — try again.")
    } finally { setBusy(false) }
  }

  function applyDeck() {
    if (!result) return
    const ids = result.deck
      .map((d) => ownedByName.get(normChampName(d.champion))?.id)
      .filter((id): id is string => !!id)
    if (!ids.length) return
    setApplied(true)
    startTransition(async () => { await applyBgsDeck(ids, true); router.refresh() })
  }

  const matchedCount = result ? result.deck.filter((d) => ownedByName.has(normChampName(d.champion))).length : 0

  return (
    <div className="flex-1 min-h-0 overflow-y-auto font-mono" style={{ color: GREEN }}>
      <div className="border border-[#1f5c33] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm opacity-70">Photograph this Battlegrounds season&apos;s nodes/meta screen — get a full deck recommendation from YOUR roster.</p>
          <ModelPicker />
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => fileInput.current?.click()} disabled={busy}
            className="px-4 py-2.5 rounded-lg border border-[#33ff66] text-sm font-bold hover:bg-[#0a2214] disabled:opacity-40 transition-colors">
            📷 {file ? "Change nodes photo" : "Nodes / meta photo"}
          </button>
          <label className="text-xs opacity-70 inline-flex items-center gap-1.5">Deck size
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}
              className="bg-black border border-[#1f5c33] rounded px-2 py-1 text-xs" style={{ color: GREEN }}>
              {[30, 25, 20, 15].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button onClick={build} disabled={busy || (!file && !notes.trim()) || roster.length < size}
            className="px-5 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors ml-auto"
            style={{ background: GREEN }}>
            {busy ? "BUILDING…" : "🃏 BUILD DECK"}
          </button>
        </div>

        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="Optional — describe the season meta/nodes if you don't have a screenshot…"
          className="w-full bg-black border border-[#1f5c33] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"
          style={{ color: GREEN }} />

        {roster.length < size && <p className="text-xs text-amber-400">Your roster has {roster.length} champs — add more (or drop the deck size) to build a {size}-champ deck.</p>}
        {preview && <img src={preview} alt="Season nodes" className="max-h-48 rounded-lg border border-[#1f5c33]" />}
        {error && <p className="text-sm text-red-400">✗ {error}</p>}
        {busy && <p className="text-sm opacity-60 animate-pulse">Reading the season, weighing your roster… this one takes a minute.</p>}

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap border-t border-[#1f5c33] pt-3">
              <p className="text-sm font-bold text-white">Recommended deck — {result.deck.length} champs</p>
              <button onClick={applyDeck} disabled={applied}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-black disabled:opacity-50 ml-auto" style={{ background: GREEN }}>
                {applied ? `✓ Applied (${matchedCount})` : `★ Set as my BGS deck (${matchedCount})`}
              </button>
            </div>

            {result.strategy && (
              <div className="border border-[#33ff66] rounded-lg p-3">
                <p className="text-[10px] opacity-50 uppercase tracking-widest mb-1">Season strategy</p>
                <p className="text-sm">{result.strategy}</p>
              </div>
            )}

            {(["Defender", "Attacker", "Flex"] as const).map((role) => {
              const group = result.deck.filter((d) => d.role === role)
              if (!group.length) return null
              return (
                <div key={role}>
                  <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: ROLE_COLOUR[role] }}>{role}s · {group.length}</p>
                  <div className="space-y-1.5">
                    {group.map((d, i) => {
                      const owned = ownedByName.get(normChampName(d.champion))
                      return (
                        <div key={i} className="flex items-start gap-2 border border-[#1f5c33] rounded-lg px-2.5 py-1.5">
                          {owned?.imageUrl && <img src={owned.imageUrl} alt="" width={24} height={24} className="rounded object-cover mt-0.5" style={{ boxShadow: `0 0 0 1.5px ${classColour(owned.class)}` }} />}
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white">{d.champion} {owned && <span className="text-[10px] font-normal opacity-50">{owned.stars}★ R{owned.rank}</span>}{!owned && <span className="text-[10px] text-amber-400 font-normal"> ⚠ not matched to your roster</span>}</p>
                            {d.why && <p className="text-xs opacity-70">{d.why}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {result.watchouts && (
              <div className="border border-amber-600/50 rounded-lg p-3 text-amber-300">
                <p className="text-[10px] opacity-60 uppercase tracking-widest mb-1">⚠ Watch out</p>
                <p className="text-sm">{result.watchouts}</p>
              </div>
            )}
          </div>
        )}

        <input ref={fileInput} type="file" accept="image/*" className="hidden"
          onChange={(e) => { pick(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
      </div>
    </div>
  )
}
