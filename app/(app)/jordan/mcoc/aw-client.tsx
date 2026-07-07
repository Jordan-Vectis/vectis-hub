"use client"

import { useEffect, useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "../model-picker"
import { classColour, normChampName } from "@/lib/mcoc"
import type { Champ } from "./mcoc-hub"

// 🏰 ALLIANCE WAR — two planners:
//   PATH: pick the defenders on your war path → best 3-champ attack team from
//   your roster, with per-fight assignments.
//   DEFENCE: recommend which of your champs to place on which defence nodes.

const GREEN = "#33ff66"
// AW season reward brackets — passed to the AI as difficulty context.
const AW_TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Challenger", "Master", "Vibranium"]
// localStorage keys — remember the last War inputs between visits.
const TIER_KEY = "mcoc_aw_tier"
const PATH_KEY = "mcoc_aw_path"
const DEF_KEY = "mcoc_aw_defence"

type PathResult = {
  teams: { name: string; summary: string; champions: { champion: string; why: string }[] }[]
  fights: { defender: string; node?: string; nodeBuff?: string; options: { attacker: string; how: string }[] }[]
  risks: string; notes: string
}
type DefResult = { placements: { node: string; champion: string; why: string }[]; notes: string }
// A defender on the path: name + optional AW node number it sits on.
type Def = { name: string; node: string }

export default function AwClient({ roster }: { roster: Champ[] }) {
  const [mode, setMode] = useState<"path" | "defence">("path")
  const [tier, setTier] = useState("")   // AW difficulty bracket, remembered per browser
  const restored = useRef(false)
  const ownedByName = new Map(roster.map((c) => [normChampName(c.name), c]))
  const rosterPayload = () => JSON.stringify(roster.map((c) => ({ name: c.name, stars: c.stars, rank: c.rank })))

  // ── Path planner ──
  const [defenders, setDefenders] = useState<Def[]>([])
  const [defInput, setDefInput] = useState("")
  const [nodes, setNodes] = useState("")
  const [pathBusy, setPathBusy] = useState(false)
  const [pathErr, setPathErr] = useState<string | null>(null)
  const [path, setPath] = useState<PathResult | null>(null)
  // Optional war-map screenshot — lets the AI read the real node buffs.
  const pathMap = useRef<HTMLInputElement>(null)
  const [pathMapFile, setPathMapFile] = useState<File | null>(null)
  const [pathMapPreview, setPathMapPreview] = useState<string | null>(null)
  function pickPathMap(f: File | null) {
    setPathMapFile(f)
    if (pathMapPreview) URL.revokeObjectURL(pathMapPreview)
    setPathMapPreview(f ? URL.createObjectURL(f) : null)
  }

  // Every champion in the DB (owned or not) — powers the defender type-ahead and
  // the class-colour dots. Falls back gracefully to manual typing if unbuilt.
  const [allNames, setAllNames] = useState<string[]>([])
  const [classByName, setClassByName] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    fetch("/api/jordan/mcoc/profiles/list")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !Array.isArray(d?.champions)) return
        setAllNames(d.champions.map((c: { name: string }) => c.name).filter(Boolean).sort())
        const cls: Record<string, string> = {}
        for (const c of d.champions) if (c?.name) cls[normChampName(c.name)] = c.class || ""
        setClassByName(cls)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  function addDefender(raw: string) {
    const d = raw.replace(/\s+/g, " ").trim()
    if (!d || defenders.some((x) => normChampName(x.name) === normChampName(d))) { setDefInput(""); return }
    setDefenders((l) => [...l, { name: d, node: "" }]); setDefInput("")
  }
  function setDefNode(i: number, node: string) {
    setDefenders((l) => l.map((d, j) => (j === i ? { ...d, node: node.replace(/[^0-9]/g, "").slice(0, 3) } : d)))
  }
  function defClass(name: string) { return classByName[normChampName(name)] || "" }

  async function planPath() {
    if (pathBusy || !defenders.length) return
    setPathBusy(true); setPathErr(null); setPath(null)
    try {
      const fd = new FormData()
      fd.append("defenders", JSON.stringify(defenders.map((d) => ({ name: d.name, node: d.node || undefined }))))
      if (nodes.trim()) fd.append("nodes", nodes.trim())
      if (tier) fd.append("tier", tier)
      fd.append("roster", rosterPayload())
      const model = getJordanModel(); if (model) fd.append("model", model)
      if (pathMapFile) fd.append("image", pathMapFile)
      const res = await fetch("/api/jordan/mcoc/aw-path", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Planning failed — try again.")
      setPath(j)
    } catch (e: any) {
      setPathErr(e?.message ?? "Planning failed — try again.")
    } finally { setPathBusy(false) }
  }
  // Node lookup for annotating the fight-by-fight assignments.
  const nodeFor = (defName: string) => defenders.find((d) => normChampName(d.name) === normChampName(defName))?.node || ""

  // ── Defence placer ──
  const defFile = useRef<HTMLInputElement>(null)
  const [mapFile, setMapFile] = useState<File | null>(null)
  const [mapPreview, setMapPreview] = useState<string | null>(null)
  const [defNotes, setDefNotes] = useState("")
  const [defCount, setDefCount] = useState(5)
  const [defBusy, setDefBusy] = useState(false)
  const [defErr, setDefErr] = useState<string | null>(null)
  const [defence, setDefence] = useState<DefResult | null>(null)

  // Remember the last War inputs (tier, path defenders/notes, defence notes/count)
  // between visits. Restore once after mount, then save on change (the `restored`
  // guard stops the initial empty state clobbering the saved values first).
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const t = localStorage.getItem(TIER_KEY); if (t) setTier(t)
        const p = JSON.parse(localStorage.getItem(PATH_KEY) || "null")
        if (p) {
          if (Array.isArray(p.defenders)) setDefenders(p.defenders.filter((x: { name?: unknown }) => typeof x?.name === "string").map((x: { name: string; node?: unknown }) => ({ name: x.name, node: typeof x.node === "string" ? x.node : "" })))
          if (typeof p.nodes === "string") setNodes(p.nodes)
        }
        const d = JSON.parse(localStorage.getItem(DEF_KEY) || "null")
        if (d) {
          if (typeof d.notes === "string") setDefNotes(d.notes)
          if (Number(d.count)) setDefCount(Number(d.count))
        }
      } catch {}
      restored.current = true
    })
  }, [])
  useEffect(() => { if (restored.current) try { localStorage.setItem(TIER_KEY, tier) } catch {} }, [tier])
  useEffect(() => { if (restored.current) try { localStorage.setItem(PATH_KEY, JSON.stringify({ defenders, nodes })) } catch {} }, [defenders, nodes])
  useEffect(() => { if (restored.current) try { localStorage.setItem(DEF_KEY, JSON.stringify({ notes: defNotes, count: defCount })) } catch {} }, [defNotes, defCount])

  function pickMap(f: File | null) {
    setMapFile(f)
    if (mapPreview) URL.revokeObjectURL(mapPreview)
    setMapPreview(f ? URL.createObjectURL(f) : null)
  }

  async function planDefence() {
    if (defBusy) return
    setDefBusy(true); setDefErr(null); setDefence(null)
    try {
      const fd = new FormData()
      if (mapFile) fd.append("image", mapFile)
      if (defNotes.trim()) fd.append("notes", defNotes.trim())
      if (tier) fd.append("tier", tier)
      fd.append("count", String(defCount))
      fd.append("roster", rosterPayload())
      const model = getJordanModel(); if (model) fd.append("model", model)
      const res = await fetch("/api/jordan/mcoc/aw-defence", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Planning failed — try again.")
      setDefence(j)
    } catch (e: any) {
      setDefErr(e?.message ?? "Planning failed — try again.")
    } finally { setDefBusy(false) }
  }

  const modeBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
      active ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60 hover:opacity-100"
    }`
  const input = "bg-black border border-[#1f5c33] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"

  function ChampInline({ name }: { name: string }) {
    const owned = ownedByName.get(normChampName(name))
    return (
      <span className="inline-flex items-center gap-1.5">
        {owned?.imageUrl && <img src={owned.imageUrl} alt="" width={22} height={22} className="rounded object-cover" style={{ boxShadow: `0 0 0 1.5px ${classColour(owned.class)}` }} />}
        <span className="font-bold text-white">{name}</span>
        {owned && <span className="text-[10px] opacity-50">{owned.stars}★ R{owned.rank}</span>}
      </span>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto font-mono" style={{ color: GREEN }}>
      <div className="border border-[#1f5c33] rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setMode("path")} className={modeBtn(mode === "path")}>🗡 ATTACK PATH</button>
          <button onClick={() => setMode("defence")} className={modeBtn(mode === "defence")}>🛡 DEFENCE PLACER</button>
          <label className="inline-flex items-center gap-1.5 text-xs opacity-70 ml-1" title="Your war bracket — the AI factors in the tougher nodes at higher tiers">
            🗺 Tier
            <select value={tier} onChange={(e) => setTier(e.target.value)}
              className="bg-black border border-[#1f5c33] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#33ff66]" style={{ color: GREEN }}>
              <option value="">— any —</option>
              {AW_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <span className="ml-auto"><ModelPicker /></span>
        </div>

        {mode === "path" && (
          <div className="space-y-3">
            <p className="text-sm opacity-70">Add the defenders on your path (in order) — get a few different 3-champ teams from your roster, plus the best attacker options for each fight. Start typing to search every champion; add a node number if you know it.</p>

            <datalist id="mcoc-all-champs">
              {allNames.map((n) => <option key={n} value={n} />)}
            </datalist>
            <div className="flex gap-2 items-center flex-wrap">
              <input value={defInput} onChange={(e) => setDefInput(e.target.value)} list="mcoc-all-champs"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDefender(defInput) } }}
                placeholder={allNames.length ? "Type a defender's name…" : "Defender name + Enter…"}
                className={`${input} flex-1 min-w-[12rem]`} style={{ color: GREEN }} />
              <button onClick={() => addDefender(defInput)} disabled={!defInput.trim()}
                className="px-3 py-2 rounded-lg border border-[#1f5c33] text-xs hover:border-[#33ff66] disabled:opacity-30 transition-colors">ADD</button>
            </div>

            {defenders.length > 0 && (
              <div className="space-y-1.5">
                {defenders.map((d, i) => {
                  const cls = defClass(d.name)
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm border border-[#1f5c33] rounded-lg px-2.5 py-1.5">
                      <span className="opacity-40 w-4 text-right shrink-0">{i + 1}</span>
                      {cls && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: classColour(cls) }} title={cls} />}
                      <span className="text-white flex-1 min-w-0 truncate">{d.name}</span>
                      <label className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest opacity-60 shrink-0">
                        Node
                        <input value={d.node} onChange={(e) => setDefNode(i, e.target.value)} inputMode="numeric"
                          placeholder="–" className="w-12 bg-black border border-[#1f5c33] rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"
                          style={{ color: GREEN }} />
                      </label>
                      <button onClick={() => setDefenders((l) => l.filter((_, j) => j !== i))} className="text-red-400 shrink-0 px-1" title="Remove">×</button>
                    </div>
                  )
                })}
              </div>
            )}

            <textarea value={nodes} onChange={(e) => setNodes(e.target.value)} rows={2}
              placeholder="Optional — path-wide buffs / notes (e.g. global Aggression, node 24 Flow)…"
              className={`${input} w-full resize-none`} style={{ color: GREEN }} />

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => pathMap.current?.click()} disabled={pathBusy}
                className="px-4 py-2 rounded-lg border border-[#1f5c33] text-sm hover:border-[#33ff66] disabled:opacity-40 transition-colors">
                📷 {pathMapFile ? "Change map screenshot" : "Add map screenshot (fix the nodes)"}
              </button>
              {pathMapFile && <button onClick={() => pickPathMap(null)} className="text-xs text-red-400 hover:underline">remove</button>}
              <span className="text-[11px] opacity-50">The AI reads the exact node buffs from your screenshot and corrects its guesses.</span>
            </div>
            {pathMapPreview && <img src={pathMapPreview} alt="War map" className="max-h-48 rounded-lg border border-[#1f5c33]" />}
            <input ref={pathMap} type="file" accept="image/*" className="hidden"
              onChange={(e) => { pickPathMap(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />

            <button onClick={planPath} disabled={pathBusy || !defenders.length}
              className="px-5 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors"
              style={{ background: GREEN }}>
              {pathBusy ? "PLANNING…" : "🗡 PLAN MY PATH"}
            </button>
            {pathErr && <p className="text-sm text-red-400">✗ {pathErr}</p>}

            {path && (
              <div className="space-y-3 border-t border-[#1f5c33] pt-3">
                {path.teams.length > 0 && (
                  <>
                    <p className="text-[10px] uppercase tracking-widest opacity-50">Team options — pick whichever suits you</p>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {path.teams.map((t, i) => (
                        <div key={i} className="border border-[#33ff66] rounded-lg p-3 space-y-2">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0a2214] border border-[#33ff66] shrink-0">{String.fromCharCode(65 + i)}</span>
                            <p className="text-sm font-bold text-white">{t.name || `Team ${i + 1}`}</p>
                          </div>
                          {t.summary && <p className="text-xs opacity-70">{t.summary}</p>}
                          <div className="space-y-1.5 pt-0.5">
                            {t.champions.map((c, j) => (
                              <div key={j}>
                                <ChampInline name={c.champion} />
                                {c.why && <p className="text-[11px] opacity-60 mt-0.5">{c.why}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <p className="text-[10px] uppercase tracking-widest opacity-50">Fight by fight — best options for each</p>
                <div className="grid gap-2 lg:grid-cols-2">
                  {path.fights.map((f, i) => {
                    const node = f.node || nodeFor(f.defender)
                    return (
                      <div key={i} className="border border-[#1f5c33] rounded-lg px-3 py-2 text-sm">
                        <p className="flex items-center gap-1.5 flex-wrap mb-1">
                          {node && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-[#1f5c33] opacity-80 shrink-0">NODE {node}</span>}
                          <span className="text-white font-bold">{f.defender}</span>
                        </p>
                        {f.nodeBuff && <p className="text-[11px] text-amber-300 mb-1.5">⚡ {f.nodeBuff}</p>}
                        <div className="space-y-1.5">
                          {f.options.map((o, j) => (
                            <div key={j} className="flex items-start gap-2">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 shrink-0 ${j === 0 ? "text-black" : "border border-[#1f5c33] opacity-60"}`}
                                style={j === 0 ? { background: GREEN } : undefined}>{j === 0 ? "BEST" : `#${j + 1}`}</span>
                              <div className="min-w-0">
                                <ChampInline name={o.attacker} />
                                {o.how && <p className="text-xs opacity-70 mt-0.5">{o.how}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {path.risks && <p className="text-xs text-amber-300">⚠ {path.risks}</p>}
                {path.notes && <p className="text-xs opacity-60">💡 {path.notes}</p>}
              </div>
            )}
          </div>
        )}

        {mode === "defence" && (
          <div className="space-y-3">
            <p className="text-sm opacity-70">Get your best defence placements — optionally photograph the war map / node screen for node-exact picks.</p>

            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={() => defFile.current?.click()} disabled={defBusy}
                className="px-4 py-2 rounded-lg border border-[#1f5c33] text-sm hover:border-[#33ff66] disabled:opacity-40 transition-colors">
                📷 {mapFile ? "Change map photo" : "Map photo (optional)"}
              </button>
              <label className="text-xs opacity-70 inline-flex items-center gap-1.5">Defenders
                <select value={defCount} onChange={(e) => setDefCount(Number(e.target.value))}
                  className="bg-black border border-[#1f5c33] rounded px-2 py-1 text-xs" style={{ color: GREEN }}>
                  {[5, 6, 7, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button onClick={planDefence} disabled={defBusy || roster.length < defCount}
                className="px-5 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors ml-auto"
                style={{ background: GREEN }}>
                {defBusy ? "PLANNING…" : "🛡 PLACE MY DEFENCE"}
              </button>
            </div>

            <textarea value={defNotes} onChange={(e) => setDefNotes(e.target.value)} rows={2}
              placeholder="Optional — war tier, map style, which nodes you're responsible for…"
              className={`${input} w-full resize-none`} style={{ color: GREEN }} />

            {mapPreview && <img src={mapPreview} alt="War map" className="max-h-48 rounded-lg border border-[#1f5c33]" />}
            {defErr && <p className="text-sm text-red-400">✗ {defErr}</p>}

            {defence && (
              <div className="space-y-1.5 border-t border-[#1f5c33] pt-3">
                {defence.placements.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 border border-[#1f5c33] rounded-lg px-3 py-2">
                    <span className="shrink-0 text-xs font-bold px-2 py-1 rounded border border-[#33ff66] mt-0.5">NODE {p.node}</span>
                    <div className="min-w-0">
                      <ChampInline name={p.champion} />
                      {p.why && <p className="text-xs opacity-70 mt-0.5">{p.why}</p>}
                    </div>
                  </div>
                ))}
                {defence.notes && <p className="text-xs opacity-70 pt-1">{defence.notes}</p>}
              </div>
            )}

            <input ref={defFile} type="file" accept="image/*" className="hidden"
              onChange={(e) => { pickMap(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
          </div>
        )}
      </div>
    </div>
  )
}
