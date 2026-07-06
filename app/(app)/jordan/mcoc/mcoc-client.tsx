"use client"

import { useEffect, useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "../model-picker"
import { classColour as CLASS_COL, classAdvantageAgainst, normChampName } from "@/lib/mcoc"
import type { Champ } from "./mcoc-hub"

// ⚔ COUNTERS — two modes:
//   ⚡ INSTANT: no AI call — looks the defender up in the Champion DB (built in
//     the Champion DB tab) and matches its stored counters against the roster /
//     BGS deck locally. Fast enough to use mid-draft in Battlegrounds, and it
//     shows counters YOU own even if no guide lists them.
//   🤖 AI DEEP DIVE: the original grounded AI lookup (screenshot support, live
//     meta) for when you want depth over speed.

const GREEN = "#33ff66"

type Counter = { champion: string; class: string; why: string; how: string }
type Result = {
  defender: string; counters: Counter[]; strategy: string; warnings: string
  confident: boolean; queries?: string[]; groundedFallback?: boolean
}
type Profile = {
  name: string; class: string; immunities: string[]; tags: string[]
  summary: string; counters: string[]; defenderNotes: string; profileAt: string | null
}

export default function McocClient({ roster }: { roster: Champ[] }) {
  const [mode, setMode] = useState<"instant" | "ai">("instant")

  // Owned-champion lookup (best copy = highest star, then rank).
  const ownedByName = new Map<string, Champ>()
  for (const c of roster) {
    const k = normChampName(c.name)
    const cur = ownedByName.get(k)
    if (!cur || c.stars > cur.stars || (c.stars === cur.stars && c.rank > cur.rank)) ownedByName.set(k, c)
  }

  // ── Instant mode state ──
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [profErr, setProfErr] = useState<string | null>(null)
  const [pick, setPick] = useState("")
  const [picked, setPicked] = useState<Profile | null>(null)
  const [deckOnly, setDeckOnly] = useState(false)

  useEffect(() => {
    if (mode !== "instant" || profiles) return
    fetch("/api/jordan/mcoc/profiles/list")
      .then((r) => r.json())
      .then((d) => setProfiles(Array.isArray(d?.champions) ? d.champions : []))
      .catch(() => setProfErr("Couldn't load the Champion DB."))
  }, [mode, profiles])

  function choose(name: string) {
    setPick(name)
    const norm = normChampName(name)
    const hit = (profiles ?? []).find((p) => normChampName(p.name) === norm) ?? null
    setPicked(hit)
  }

  // ── AI mode state (the original) ──
  const [defender, setDefender] = useState("")
  const [search, setSearch] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  function pickFile(f: File | null) {
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

  const modeBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
      active ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60 hover:opacity-100"
    }`

  // Instant counter list: the defender's stored counters, sorted owned-in-deck
  // first, then owned, then unowned.
  const instantCounters = (() => {
    if (!picked) return []
    const rows = picked.counters.map((n) => {
      const owned = ownedByName.get(normChampName(n))
      return { name: n, owned, inDeck: owned?.bgsDeck === true }
    })
    const filtered = deckOnly ? rows.filter((r) => r.inDeck) : rows
    return filtered.sort((a, b) => Number(b.inDeck) - Number(a.inDeck) || Number(!!b.owned) - Number(!!a.owned))
  })()
  const advClass = picked ? classAdvantageAgainst(picked.class) : ""

  return (
    <div className="flex-1 min-h-0 overflow-y-auto font-mono" style={{ color: GREEN }}>
      <div className="border border-[#1f5c33] rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setMode("instant")} className={modeBtn(mode === "instant")}>⚡ INSTANT (BGS)</button>
          <button onClick={() => setMode("ai")} className={modeBtn(mode === "ai")}>🤖 AI DEEP DIVE</button>
          {mode === "ai" && <span className="ml-auto"><ModelPicker /></span>}
        </div>

        {/* ── INSTANT ── */}
        {mode === "instant" && (
          <div className="space-y-3">
            <p className="text-sm opacity-70">No AI wait — defender info + your counters straight from the Champion DB. Built for mid-draft.</p>
            {profErr && <p className="text-sm text-red-400">✗ {profErr}</p>}
            {!profiles && !profErr && <p className="text-sm opacity-50 animate-pulse">Loading Champion DB…</p>}
            {profiles && profiles.length === 0 && (
              <p className="text-sm text-amber-400">The Champion DB is empty — build it in the 🧬 CHAMPION DB tab first.</p>
            )}
            {profiles && profiles.length > 0 && (
              <>
                <div className="flex gap-2 items-center flex-wrap">
                  <input
                    value={pick}
                    onChange={(e) => choose(e.target.value)}
                    list="mcoc-defender-names"
                    placeholder="Type a defender…"
                    className="flex-1 min-w-[12rem] bg-black border border-[#1f5c33] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"
                    style={{ color: GREEN }}
                  />
                  <datalist id="mcoc-defender-names">
                    {profiles.map((p) => <option key={p.name} value={p.name} />)}
                  </datalist>
                  <label className="inline-flex items-center gap-1.5 text-[11px] opacity-70 cursor-pointer">
                    <input type="checkbox" checked={deckOnly} onChange={(e) => setDeckOnly(e.target.checked)} className="accent-[#33ff66]" />
                    BGS deck only
                  </label>
                </div>

                {pick && !picked && <p className="text-xs opacity-50">Keep typing — pick an exact name from the list.</p>}

                {picked && (
                  <div className="space-y-3">
                    <div className="border-t border-[#1f5c33] pt-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-bold text-white">{picked.name}</span>
                        {picked.class && <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border" style={{ color: CLASS_COL(picked.class), borderColor: CLASS_COL(picked.class) + "88" }}>{picked.class}</span>}
                        {advClass && <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border" style={{ color: CLASS_COL(advClass), borderColor: CLASS_COL(advClass) + "88" }}>bring {advClass} ▲</span>}
                        {!picked.profileAt && <span className="text-[10px] text-amber-400">not profiled yet — build it in the Champion DB tab</span>}
                      </div>
                      {picked.immunities.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {picked.immunities.map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-sky-700/60 text-sky-300">🛡 {t}</span>)}
                        </div>
                      )}
                      {picked.defenderNotes && <p className="text-xs text-amber-300 mt-1.5">⚠ {picked.defenderNotes}</p>}
                    </div>

                    <div>
                      <p className="text-[10px] uppercase tracking-widest opacity-50 mb-1.5">Counters{deckOnly ? " in your BGS deck" : ""}</p>
                      {instantCounters.length === 0 && (
                        <p className="text-xs opacity-60">{deckOnly ? "None of this defender's known counters are in your BGS deck — untick the filter to see all." : "No stored counters for this defender yet — run Update meta in the Champion DB tab, or use AI mode."}</p>
                      )}
                      <div className="space-y-1.5">
                        {instantCounters.map((c, i) => (
                          <div key={i} className={`flex items-center gap-2 border rounded-lg px-2.5 py-1.5 ${c.owned ? "border-[#33ff66]" : "border-[#1f5c33] opacity-60"} ${c.inDeck ? "bg-[#0a2214]/60" : ""}`}>
                            {c.owned?.imageUrl && <img src={c.owned.imageUrl} alt="" width={24} height={24} className="rounded object-cover" style={{ boxShadow: `0 0 0 1.5px ${CLASS_COL(c.owned.class)}` }} />}
                            <span className="text-sm font-bold text-white">{c.name}</span>
                            {c.inDeck
                              ? <span className="text-[10px] font-bold text-[#33ff66]">★ IN DECK · {c.owned!.stars}★ R{c.owned!.rank}</span>
                              : c.owned
                                ? <span className="text-[10px] text-[#33ff66]">✓ owned · {c.owned.stars}★ R{c.owned.rank}</span>
                                : <span className="text-[10px] opacity-50">not owned</span>}
                          </div>
                        ))}
                      </div>
                    </div>

                    {picked.summary && <p className="text-xs opacity-50">{picked.summary}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── AI DEEP DIVE (the original) ── */}
        {mode === "ai" && (
          <div className="space-y-4">
            <p className="text-sm opacity-70">Name the defender (add node / buffs) and/or upload a screenshot — grounded AI, slower but deeper.</p>

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
              onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
            <p className="text-[10px] opacity-40">CTRL/⌘ + ENTER to search</p>
          </div>
        )}
      </div>
    </div>
  )
}
