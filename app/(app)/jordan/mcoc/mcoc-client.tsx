"use client"

import { useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "../model-picker"
import { classColour as CLASS_COL, normChampName } from "@/lib/mcoc"
import type { Champ } from "./mcoc-hub"

// 04 · MCOC — "who should I use against this defender?" for Marvel Contest of
// Champions. Name the defender and/or upload a screenshot; web search is on by
// default so counters reflect the current meta.

const GREEN = "#33ff66"

type Counter = { champion: string; class: string; why: string; how: string }
type Result = {
  defender: string; counters: Counter[]; strategy: string; warnings: string
  confident: boolean; queries?: string[]; groundedFallback?: boolean
}

export default function McocClient({ roster }: { roster: Champ[] }) {
  // Owned-champion lookup: match a counter's name to a roster champ so we can
  // flag "you own this" (and show its portrait / best copy).
  const ownedByName = new Map<string, Champ>()
  for (const c of roster) {
    const k = normChampName(c.name)
    const cur = ownedByName.get(k)
    // Prefer the higher star, then higher rank copy.
    if (!cur || c.stars > cur.stars || (c.stars === cur.stars && c.rank > cur.rank)) ownedByName.set(k, c)
  }
  const [defender, setDefender] = useState("")
  const [search, setSearch] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  function pick(f: File | null) {
    setFile(f)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  async function findCounters() {
    if (busy || (!defender.trim() && !file)) return
    setBusy(true); setError(null); setResult(null)
    try {
      const fd = new FormData()
      if (defender.trim()) fd.append("defender", defender.trim())
      if (file) fd.append("image", file)
      fd.append("search", search ? "1" : "0")
      const model = getJordanModel()
      if (model) fd.append("model", model)
      const res = await fetch("/api/jordan/mcoc", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "That didn't work — try again.")
      setResult(j)
    } catch (e: any) {
      setError(e?.message ?? "That didn't work — try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto font-mono" style={{ color: GREEN }}>
      <div className="border border-[#1f5c33] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm opacity-70">Name the defender (add node / buffs) and/or upload a screenshot — get the best attackers to bring.</p>
          <ModelPicker />
        </div>

        <textarea
          value={defender}
          onChange={(e) => setDefender(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); findCounters() } }}
          placeholder="e.g. Nick Fury on Aggression + Bane, or Mystic Dispersion / Enhanced Special 3…"
          rows={2}
          className="w-full bg-black border border-[#1f5c33] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"
          style={{ color: GREEN }}
        />

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => fileInput.current?.click()} disabled={busy}
            className="px-4 py-2.5 rounded-lg border border-[#1f5c33] text-sm hover:border-[#33ff66] disabled:opacity-40 transition-colors">
            📷 {file ? "Change screenshot" : "Add screenshot"}
          </button>
          <button onClick={() => setSearch((s) => !s)}
            className={`text-[10px] uppercase tracking-widest px-2 py-1.5 rounded border transition-colors ${
              search ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60 hover:opacity-100"
            }`} title="Look up the current meta on Google">
            🔎 LIVE META [ {search ? "ON" : "OFF"} ]
          </button>
          <button onClick={findCounters} disabled={busy || (!defender.trim() && !file)}
            className="px-5 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors ml-auto"
            style={{ background: GREEN }}>
            {busy ? "SCOUTING…" : "⚔ FIND COUNTERS"}
          </button>
        </div>

        {preview && <img src={preview} alt="Defender" className="max-h-48 rounded-lg border border-[#1f5c33]" />}
        {error && <p className="text-sm text-red-400">✗ {error}</p>}

        {result && (
          <div className="space-y-3">
            <div className="border-t border-[#1f5c33] pt-3">
              <p className="text-[10px] opacity-50 uppercase tracking-widest">Defender</p>
              <p className="text-base font-bold text-white">{result.defender}</p>
              {!result.confident && <p className="text-xs text-amber-400 mt-1">⚠ Not sure who this is — general advice below; try a clearer screenshot or exact name.</p>}
              {result.queries && result.queries.length > 0 && <p className="text-[10px] opacity-50 mt-1">🔎 {result.queries.join(" · ")}</p>}
              {result.groundedFallback && <p className="text-[10px] text-amber-400 mt-1">(live search unavailable on this model — answered from knowledge)</p>}
            </div>

            {result.counters.map((c, i) => {
              const owned = ownedByName.get(normChampName(c.champion))
              const colour = CLASS_COL(c.class || owned?.class || "")
              return (
                <div key={i} className={`border rounded-lg p-3 ${owned ? "border-[#33ff66] bg-[#0a2214]/40" : "border-[#1f5c33]"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] opacity-50 font-bold">{i + 1}</span>
                    {owned?.imageUrl && <img src={owned.imageUrl} alt="" width={26} height={26} className="rounded object-cover" style={{ boxShadow: `0 0 0 1.5px ${colour}` }} />}
                    <span className="text-base font-bold text-white">{c.champion}</span>
                    {c.class && <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border" style={{ color: colour, borderColor: colour + "88" }}>{c.class}</span>}
                    {owned
                      ? <span className="text-[10px] font-bold text-[#33ff66]">✓ OWNED · {owned.stars}★ R{owned.rank}</span>
                      : <span className="text-[10px] opacity-40">not in roster</span>}
                  </div>
                  {c.why && <p className="text-sm"><span className="opacity-50">Why: </span>{c.why}</p>}
                  {c.how && <p className="text-sm opacity-80"><span className="opacity-50">How: </span>{c.how}</p>}
                </div>
              )
            })}

            {result.strategy && (
              <div className="border border-[#33ff66] rounded-lg p-3">
                <p className="text-[10px] opacity-50 uppercase tracking-widest mb-1">Strategy</p>
                <p className="text-sm">{result.strategy}</p>
              </div>
            )}
            {result.warnings && (
              <div className="border border-amber-600/50 rounded-lg p-3 text-amber-300">
                <p className="text-[10px] opacity-60 uppercase tracking-widest mb-1">⚠ Watch out for</p>
                <p className="text-sm">{result.warnings}</p>
              </div>
            )}
          </div>
        )}

        <input ref={fileInput} type="file" accept="image/*" className="hidden"
          onChange={(e) => { pick(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
      </div>
      <p className="text-[10px] opacity-40 mt-2">CTRL/⌘ + ENTER to search · live meta reflects current champs where available</p>
    </div>
  )
}
